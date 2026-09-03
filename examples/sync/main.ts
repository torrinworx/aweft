// A shared task board, over four different channels, with the same code on top of each.
//
// The job: two people work one board at the same time. Both ends run the same program: there
// is no end that decides, and the only thing either of them can do about a change it will not
// take is refuse it and say why. They both add tasks at once, they both rename the board at
// once, and one of them yields. Then three of them in a chain, and finally a board that is
// both shared over a link and kept in a store, where a change made by the other person is
// what the store writes down.
//
// Run: node examples/sync/main.ts

import { strict as assert } from 'node:assert';
import { MessageChannel, Worker } from 'node:worker_threads';
import { createConnection, createServer as createTcpServer } from 'node:net';
import type { Socket } from 'node:net';

import { atomic, createMap, createObject, observer, snapshot, textIdOf } from '@aweftjs/core';
import { createStore, memoryDriver } from '@aweftjs/store';
import {
	type Channel, type Frame, type Refused,
	connect, decodeFrame, encodeFrame, fromMessagePort, inProcess, mirror,
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
}

interface Board extends Record<string, unknown> {
	title: string;
	tasks: ReturnType<typeof createMap<Task>>;
}

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
				// Bytes that are not a frame end the link. Raising here would take the process
				// instead, which is the one thing a transport must not do.
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

const scenario = async (name: string, pair: () => Promise<[Channel, Channel]>): Promise<void> => {
	const board = newBoard();
	const [there, here] = await pair();

	// Both ends run the same two lines. One of them happens to hold the board already.
	const kim = connect(there);
	const alex = connect(here);
	const refusals: Refused[] = [];
	const mine = kim.share<Board>('board', board, { refused: (report) => refusals.push(report) });
	const theirs = alex.share<Board>('board', undefined, { refused: (report) => refusals.push(report) });

	const copy = await theirs.ready;
	await settle();
	check(copy.title === 'this week', `${name}: the end with nothing was handed the board`);
	check(shape(copy) === shape(board), `${name}: and it says what the other end says`);

	// Both work at once. Two people filing different tasks is not a conflict and must not
	// behave like one.
	const write = task('write it up');
	board.tasks.add(write);
	copy.tasks.add(task('book the room'));
	await settle();

	check(board.tasks.size === 2, `${name}: both tasks survived`);
	check(shape(copy) === shape(board), `${name}: and the two ends agree`);

	// Both rename the board in the same breath. Neither end decides, so they end up swapped.
	board.title = 'this week, revised';
	copy.title = 'the week ahead';
	await settle();
	check(board.title === 'the week ahead', `${name}: a same-slot conflict leaves them swapped`);
	check(copy.title === 'this week, revised', `${name}: each holding the other's word for it`);
	check(refusals.length === 0, `${name}: with nothing refused, because nothing was refused`);

	// One of them yields. That is a handler an application writes, not something the link did.
	theirs.resync();
	await settle();
	check(copy.title === 'the week ahead', `${name}: the end that yielded took the other's state`);
	check(shape(copy) === shape(board), `${name}: and the two agree again`);

	// A task written after the yield still crosses, so yielding is not leaving.
	copy.tasks.get(textIdOf(write))!.done = true;
	await settle();
	check(board.tasks.get(textIdOf(write))!.done === true, `${name}: and the link is still live`);

	mine.stop();
	kim.close();
	alex.close();
};

// --- the four transports --------------------------------------------------------------------

const overInProcess = (): Promise<void> =>
	scenario('in process', async () => inProcess());

const ports: MessageChannel[] = [];
const overMessagePort = (): Promise<void> =>
	scenario('message port', async () => {
		const pair = new MessageChannel();
		ports.push(pair);
		return [
			fromMessagePort(pair.port1 as unknown as Parameters<typeof fromMessagePort>[0]),
			fromMessagePort(pair.port2 as unknown as Parameters<typeof fromMessagePort>[0]),
		];
	});

const overTcp = async (): Promise<void> => {
	let arrived: ((channel: Channel) => void) | undefined;
	const server = createTcpServer((socket) => {
		socket.setNoDelay(true);
		arrived!(fromSocket(socket));
	});
	await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
	const port = (server.address() as { port: number }).port;

	await scenario('tcp socket', async () => {
		const accepted = new Promise<Channel>((done) => { arrived = done; });
		const socket = createConnection({ port, host: '127.0.0.1' });
		socket.setNoDelay(true);
		await new Promise<void>((ready, fail) => {
			socket.once('connect', () => ready());
			socket.once('error', fail);
		});
		return [await accepted, fromSocket(socket)];
	});

	await new Promise<void>((done) => server.close(() => done()));
};

// The far end in another thread, with a real thread boundary between the two. This is the
// shape a sandboxed module takes: the same protocol, a different medium.
const overWorker = async (): Promise<void> => {
	const board = newBoard();
	const pair = new MessageChannel();
	const link = connect(fromMessagePort(pair.port1 as unknown as Parameters<typeof fromMessagePort>[0]));
	link.share('board', board);

	const worker = new Worker(new URL('./worker.ts', import.meta.url), {
		workerData: { port: pair.port2 },
		transferList: [pair.port2],
	});

	const added = await new Promise<string>((done, fail) => {
		worker.on('message', (message: { added?: string }) => {
			if (message.added !== undefined) done(message.added);
		});
		worker.on('error', fail);
		worker.on('exit', (code) => { if (code !== 0) fail(new Error(`worker exited ${code}`)); });
	});

	await settle();
	const written = board.tasks.get(added);
	check(written !== undefined, 'worker: the task written in another thread reached this one');
	check(written!.title === 'written in a worker', 'worker: with the title it was given');

	await worker.terminate();
	link.close();
	pair.port1.close();
};

// --- three ends in a chain, and two documents in one process ---------------------------------

// Design 055: a node holding one document at the end of two links forwards between them,
// and nothing in it knows it is in the middle of anything.
const overChain = async (): Promise<void> => {
	const first = newBoard();
	const [leftThere, leftHere] = inProcess();
	const [rightThere, rightHere] = inProcess();

	const one = connect(leftThere);
	const two = connect(leftHere);
	const three = connect(rightThere);
	const four = connect(rightHere);

	one.share('board', first);
	const middle = await two.share<Board>('board').ready;
	await settle();
	three.share('board', middle);
	const last = await four.share<Board>('board').ready;
	await settle();

	first.tasks.add(task('written at one end'));
	last.title = 'renamed at the other';
	await settle();

	check(shape(first) === shape(last), 'chain: the two ends of a chain of three agree');
	check(shape(middle) === shape(last), 'chain: and so does the one in the middle');
	check(last.tasks.size === 1, 'chain: a task written at one end reached the other');
	check(first.title === 'renamed at the other', 'chain: and a rename came back the other way');

	for (const link of [one, two, three, four]) link.close();
};

const overMirror = async (): Promise<void> => {
	const board = newBoard();
	const editing = mirror(board);
	await settle();

	const copy = editing.document as Board;
	check(shape(copy) === shape(board), 'mirror: the second document was built from the first');

	board.tasks.add(task('written on the stored side'));
	await settle();
	check(shape(copy) === shape(board), 'mirror: a change on one side reaches the other');

	copy.title = 'written on the editing side';
	await settle();
	check(board.title === 'written on the editing side', 'mirror: and back the other way');

	editing.stop();
	board.title = 'after the mirror stopped';
	await settle();
	check(copy.title === 'written on the editing side', 'mirror: stopping it stops it');
};

// --- a link and a store on one document -------------------------------------------------------

// The thing design 055 is for: a board being worked on over a link, and written down by a
// store, with neither of the two knowing the other exists. A change the other person made is
// an ordinary local change to the store, so it is what the store writes down.
const overStoreAndLink = async (): Promise<void> => {
	const store = createStore({ driver: memoryDriver() });
	const held = await store.open('board:42');
	const board = held.root as Board;
	atomic(() => {
		board.title = 'kept';
		board.tasks = createMap<Task>();
	});

	// Anything watching the document hears both, which is what makes the two compose.
	const seen: string[] = [];
	observer(board).path('title').watch(() => seen.push(String(board.title)));

	const [there, here] = inProcess();
	const kept = connect(there);
	const other = connect(here);
	kept.share('board', board);
	const copy = await other.share<Board>('board').ready;
	await settle();
	check(shape(copy) === shape(board), 'store: the stored board crossed the link');

	// The other person renames it. Nothing here asked the store to write anything.
	copy.title = 'renamed by the other end';
	await settle();
	await store.settled(held);

	check(board.title === 'renamed by the other end', 'store: the change arrived over the link');
	check(seen.includes('renamed by the other end'), 'store: and a watcher heard it as a change');

	const history = await store.since('board:42', 0);
	const wrote = history.filter((entry) => entry.commit.deltas.some((delta) =>
		delta.ref.kind === 'object' && delta.ref.key === 'title'
		&& delta.type === 'replace' && delta.value === 'renamed by the other end'));
	check(wrote.length === 1, 'store: and the store wrote it down, once');
	check(wrote[0]!.seq > 0, 'store: under a sequence of its own');

	// Reopening from the rows says the same thing, so what the link landed really is stored.
	await store.close(held);
	const again = await store.open('board:42');
	check((again.root as Board).title === 'renamed by the other end',
		'store: and it is there when the document is opened again');

	kept.close();
	other.close();
	await store.close(again);
	await store.stop();
};

await overInProcess();
await overMessagePort();
await overTcp();
await overWorker();
await overChain();
await overMirror();
await overStoreAndLink();

for (const pair of ports) {
	pair.port1.close();
	pair.port2.close();
}

console.log(
	`sync proof: ${checks} checks, four transports, a chain of three, a mirror and a store`,
);
