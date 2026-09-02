// A shared task board, over three different channels, with the same code on top of each.
//
// The job: two people work a board at the same time. One of them tries to write a field the
// policy reserves for an admin. The link under one of them drops mid-edit and comes back.
// Everything has to end up saying the same thing, and the person whose write was refused has
// to be told, with the values they had before it.
//
// Run: node examples/sync/main.ts

import { strict as assert } from 'node:assert';
import { MessageChannel, Worker } from 'node:worker_threads';
import { createConnection, createServer as createTcpServer } from 'node:net';
import type { Socket } from 'node:net';

import { bytesToHex } from '@aweftjs/codec';
import { atomic, createMap, createObject, idOf, kindOf, snapshot, textIdOf } from '@aweftjs/core';
import { ANY, REST, type Actor, type Policy } from '@aweftjs/schema';
import {
	type Channel, type Frame, type Refused,
	connect, decodeFrame, encodeFrame, fromMessagePort, inProcess, mirror, serve,
} from '@aweftjs/sync';

let checks = 0;
const check = (ok: boolean, what: string): void => {
	checks += 1;
	assert.ok(ok, what);
};

const settle = async (rounds = 24): Promise<void> => {
	for (let i = 0; i < rounds; i++) await new Promise((done) => setTimeout(done, 0));
};

/**
 * Two documents say the same thing when their snapshots do, whatever order they were built
 * in. A snapshot's slots are a plain object, so the insertion order is in the string and is
 * not in the document: comparing with `JSON.stringify` compares the order too.
 */
const shape = (document: unknown): string => canonical(snapshot(document));

const canonical = (value: unknown): string => {
	if (value instanceof Uint8Array) return `b[${[...value].join(',')}]`;
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;

	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
		.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
		.join(',')}}`;
};

// --- the board ---------------------------------------------------------------------------

interface Task extends Record<string, unknown> {
	title: string;
	done: boolean;
	/**
	 * Absent until an admin sets it. Building a task with it, even set to false, would put a
	 * delta at an admin-only path in the same commit as the attach, and a commit is authorized
	 * whole: nobody but an admin could create a task at all. A field with its own authority is
	 * a field the actors who cannot write it do not construct.
	 */
	flagged?: boolean;
}

interface Board extends Record<string, unknown> {
	title: string;
	tasks: ReturnType<typeof createMap<Task>>;
}

/** Anyone may work the board. Only an admin may flag a task. */
const POLICY: Policy = [
	{ effect: 'allow', path: ['title'] },
	{ effect: 'allow', path: ['tasks', ANY] },
	{ effect: 'allow', path: ['tasks', ANY, 'title'] },
	{ effect: 'allow', path: ['tasks', ANY, 'done'] },
	{ effect: 'allow', path: ['tasks', ANY, 'flagged'], roles: ['admin'] },
];

const newBoard = (): Board => {
	const board = createObject<Board>();
	atomic(() => {
		board.title = 'this week';
		board.tasks = createMap<Task>();
	});
	return board;
};

const task = (title: string): Task => createObject<Task>({ title, done: false });

// --- a channel over a TCP socket, written the way a user would write one ------------------

/**
 * Frames over a stream, length prefixed. This is the whole of what a new transport takes:
 * turn a frame into bytes, put them on the wire, and hand back what comes off it.
 */
const fromSocket = (socket: Socket): Channel => {
	const listeners = new Set<(frame: Frame) => void>();
	const enders = new Set<() => void>();
	let held = Buffer.alloc(0);
	let over = false;

	const end = (): void => {
		if (over) return;
		over = true;
		for (const ender of [...enders]) ender();
	};

	socket.on('data', (chunk) => {
		held = Buffer.concat([held, chunk]);
		for (;;) {
			if (held.length < 4) return;
			const size = held.readUInt32BE(0);
			if (held.length < 4 + size) return;

			let frame: Frame;
			try {
				frame = decodeFrame(new Uint8Array(held.subarray(4, 4 + size)));
			} catch {
				// `spec/replication.md` 6: bytes that are not a frame end the link. Raising here
				// would take the process instead, which is the one thing a transport must not do.
				end();
				socket.destroy();
				return;
			}

			held = held.subarray(4 + size);
			for (const listener of [...listeners]) listener(frame);
		}
	});

	socket.on('close', end);
	socket.on('error', end);

	return {
		send: (frame) => {
			if (over) return;
			const bytes = encodeFrame(frame);
			const head = Buffer.alloc(4);
			head.writeUInt32BE(bytes.length, 0);
			socket.write(Buffer.concat([head, Buffer.from(bytes)]));
		},
		receive: (fn) => {
			listeners.add(fn);
			return () => { listeners.delete(fn); };
		},
		closed: (fn) => {
			if (over) {
				queueMicrotask(fn);
				return () => {};
			}
			enders.add(fn);
			return () => { enders.delete(fn); };
		},
		close: () => { socket.destroy(); },
	};
};

// --- the scenario, run over whatever pair of channels it is handed -------------------------

type Open = (actor: Actor) => Promise<Channel> | Channel;

const scenario = async (name: string, host: ReturnType<typeof serve>, board: Board, open: Open) => {
	const refusals: Refused[] = [];

	const kim = connect(() => open({ id: 'kim' }), { retry: () => false });
	const alex = connect(() => open({ id: 'alex' }), { retry: () => false });

	const kimBoard = kim.join<Board>('board');
	const alexBoard = alex.join<Board>('board', { refused: (group) => refusals.push(...group) });

	const mine = await kimBoard.ready;
	const theirs = await alexBoard.ready;
	check(mine.title === 'this week', `${name}: a replica with nothing was handed the board`);
	check(shape(mine) === shape(board), `${name}: and it says what the host says`);

	// Both work at once, on the same board and on the same task.
	const write = task('write it up');
	mine.tasks.add(write);
	await settle(4);

	const theirCopy = theirs.tasks.get(textIdOf(write))!;
	check(theirCopy !== undefined, `${name}: the new task reached the other person`);

	mine.title = 'this week, revised';
	theirCopy.done = true;
	mine.tasks.add(task('book the room'));
	await settle();

	check(board.title === 'this week, revised', `${name}: the host took the title`);
	check(shape(mine) === shape(board), `${name}: one replica is in step`);
	check(shape(theirs) === shape(board), `${name}: the other replica is in step`);

	// Alex is not an admin, and flagging is an admin's job. The write shows locally, then goes.
	theirCopy.flagged = true;
	check(theirCopy.flagged === true, `${name}: the write showed before the host had seen it`);
	await settle();

	check(theirCopy.flagged === undefined, `${name}: and was rolled back once it was refused`);
	check(refusals.length === 1, `${name}: one refusal, reported once`);
	check(refusals[0]!.reasons[0]!.code === 'unauthorized', `${name}: named unauthorized`);
	check(refusals[0]!.undo !== undefined, `${name}: with the values held before it`);
	check(
		(board.tasks.get(textIdOf(write)) as Task).flagged === undefined,
		`${name}: and never reached the host`,
	);
	check(shape(mine) === shape(theirs), `${name}: both replicas still agree`);

	// An edit made while the link is down is held, not lost.
	const before = board.title;
	kim.close();
	await settle(2);
	theirs.title = 'edited while the other side was away';
	await settle();
	check(board.title !== before, `${name}: work carried on for whoever was still up`);

	alex.close();
	return { mine, theirs };
};

// --- run it on three transports ------------------------------------------------------------

const overInProcess = async (): Promise<void> => {
	const board = newBoard();
	const host = serve(() => ({ document: board, policy: POLICY }));
	await scenario('in process', host, board, (actor) => {
		const [there, here] = inProcess();
		host.accept(there, actor);
		return here;
	});
	host.close();
};

const overMessagePort = async (): Promise<void> => {
	const board = newBoard();
	const host = serve(() => ({ document: board, policy: POLICY }));
	const ports: MessageChannel[] = [];
	await scenario('message port', host, board, (actor) => {
		const pair = new MessageChannel();
		ports.push(pair);
		host.accept(fromMessagePort(pair.port1 as unknown as Parameters<typeof fromMessagePort>[0]), actor);
		return fromMessagePort(pair.port2 as unknown as Parameters<typeof fromMessagePort>[0]);
	});
	host.close();
	for (const pair of ports) {
		pair.port1.close();
		pair.port2.close();
	}
};

const overTcp = async (): Promise<void> => {
	const board = newBoard();
	const host = serve(() => ({ document: board, policy: POLICY }));

	// The host takes whoever connects; the test's own handshake is one line of who they are.
	const waiting: Actor[] = [];
	const server = createTcpServer((socket) => {
		socket.setNoDelay(true);
		host.accept(fromSocket(socket), waiting.shift() ?? { id: 'unknown' });
	});
	await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
	const port = (server.address() as { port: number }).port;

	await scenario('tcp socket', host, board, async (actor) => {
		waiting.push(actor);
		const socket = createConnection({ port, host: '127.0.0.1' });
		socket.setNoDelay(true);
		await new Promise<void>((ready, fail) => {
			socket.once('connect', () => ready());
			socket.once('error', fail);
		});
		return fromSocket(socket);
	});

	host.close();
	await new Promise<void>((done) => server.close(() => done()));
};

// A second document in the same process, kept in step with the first.
const overMirror = async (): Promise<void> => {
	const board = newBoard();
	const editing = mirror(board);
	await settle(4);

	const copy = editing.document as Board;
	check(shape(copy) === shape(board), 'mirror: the second document was built from the first');

	board.tasks.add(task('written on the stored side'));
	await settle(4);
	check(shape(copy) === shape(board), 'mirror: a change on one side reaches the other');

	copy.title = 'written on the editing side';
	await settle(4);
	check(board.title === 'written on the editing side', 'mirror: and back the other way');

	editing.stop();
	board.title = 'after the mirror stopped';
	await settle(4);
	check(copy.title === 'written on the editing side', 'mirror: stopping it stops it');
};

// A replica in another thread, over the port adapter, with a real thread boundary between
// the two. This is the shape a sandboxed module takes: the same protocol, a different medium.
const overWorker = async (): Promise<void> => {
	const board = newBoard();
	const host = serve(() => ({ document: board, policy: POLICY }));
	const pair = new MessageChannel();
	host.accept(
		fromMessagePort(pair.port1 as unknown as Parameters<typeof fromMessagePort>[0]),
		{ id: 'worker' },
	);

	// The port is handed over on the way in, and it is the only thing the worker gets besides
	// which document it is joining.
	const worker = new Worker(new URL('./worker.ts', import.meta.url), {
		workerData: { root: bytesToHex(idOf(board)), kind: kindOf(board), port: pair.port2 },
		transferList: [pair.port2],
	});

	const added = await new Promise<string>((done, fail) => {
		worker.on('message', (message: { added?: string; refused?: number }) => {
			if (message.added !== undefined) done(message.added);
		});
		worker.on('error', fail);
		worker.on('exit', (code) => { if (code !== 0) fail(new Error(`worker exited ${code}`)); });
	});

	await settle();
	const task = board.tasks.get(added);
	check(task !== undefined, 'worker: the task written in another thread reached the host');
	check((task as Task).title === 'written in a worker', 'worker: with the title it was given');

	await worker.terminate();
	host.close();
	pair.port1.close();
};

await overInProcess();
await overMessagePort();
await overTcp();
await overWorker();
await overMirror();

console.log(
	`sync proof: ${checks} checks, three transports, a worker thread and an in-process mirror`,
);
