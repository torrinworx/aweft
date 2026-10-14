// A module offers the document a page asks for by name (design 310).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { codecError } from '@aweftjs/codec';
import { createObject } from '@aweftjs/core';
import type { Refusal } from '@aweftjs/core';

import { createServer, open } from '../src/index.ts';
import type { Connection, Gate, GatedLink, Offer } from '../src/index.ts';

import { asClient, connectTo, fakeListener, instance, settle, sourceOf } from './helpers.ts';

type Doc = Record<string, unknown>;

const started = async (map: Parameters<typeof sourceOf>[0], gate: Gate = open) => {
	const failed: string[] = [];
	const listening = fakeListener();
	const server = createServer({
		sources: [sourceOf(map)], gate, listener: listening.listener,
		handlers: { failed: (name, error) => failed.push(`${name}: ${String((error as Error | undefined)?.message)}`) },
	});
	await server.start();
	const client = asClient(await connectTo(listening.handlers()));
	return { server, client, failed };
};

/** What a promise has done by now: its value, the error it rejected with, or still nothing. */
const state = async <T>(promise: Promise<T>): Promise<{ value: T } | { error: unknown } | 'waiting'> => {
	let held: { value: T } | { error: unknown } | 'waiting' = 'waiting';
	promise.then((value) => { held = { value }; }, (error: unknown) => { held = { error }; });
	await settle();
	return held;
};

const reasonOf = (error: unknown): unknown => (error as { reason?: unknown }).reason;

test('a module offers a document under the name the page shared, with the context, and its accept rules', async () => {
	const note = createObject<Doc>({ title: 'kept' });
	const asked: string[] = [];
	const { server, client } = await started({
		'notes/Open': instance(() => ({
			offer: (name: string, context: unknown): Offer | undefined => {
				asked.push(`${name} ${JSON.stringify(context)}`);
				return name === 'note:1'
					? { document: note, accept: (commit) => (commit.deltas.some((d) => d.type === 'remove') ? [{ code: 'keep', message: 'nothing is removed' }] : []) }
					: undefined;
			},
		})),
	});
	const copy = await client.link.share<Doc>('note:1').ready;
	assert.equal(copy.title, 'kept');
	assert.deepEqual(asked, ['note:1 {}'], 'asked once, with the name and what identify answered');

	copy.title = 'renamed on the page';
	await settle();
	assert.equal(note.title, 'renamed on the page', 'an accepted commit lands');
	delete copy.title;
	await settle();
	assert.equal(note.title, 'renamed on the page', 'a refused one does not');

	client.socket.close();
	await server.stop();
});

test('a module that declines hands the name to the next, in load order', async () => {
	const trace: string[] = [];
	const { server, client } = await started({
		'a/First': instance(() => ({ offer: (name: string) => { trace.push(`first ${name}`); return undefined; } })),
		'b/Second': instance(() => ({
			offer: async (name: string): Promise<Offer> => {
				trace.push(`second ${name}`);
				return { document: createObject<Doc>({ from: 'second' }), ...open };
			},
		})),
		'c/Third': instance(() => ({ offer: () => { trace.push('third'); return undefined; } })),
	});
	assert.equal((await client.link.share<Doc>('board').ready).from, 'second');
	assert.deepEqual(trace, ['first board', 'second board'], 'the first offer ends the walk');
	client.socket.close();
	await server.stop();
});

test('a refusal ends the page\'s share with its reason and its words, said once, and stops the walk', async () => {
	const trace: string[] = [];
	const faults: string[] = [];
	const { server, client, failed } = await started({
		'a/Private': instance(() => ({
			offer: (name: string) => { throw codecError('private', `${name} is not yours`, 'Sign in as its owner.'); },
		})),
		'b/After': instance(() => ({ offer: () => { trace.push('after'); return undefined; } })),
	});
	const share = client.link.share<Doc>('note:2', undefined, { fault: (reason, message) => { faults.push(`${reason} | ${message}`); } });
	await assert.rejects(share.ready, (error: unknown) => reasonOf(error) === 'private'
		&& /note:2 is not yours/.test((error as Error).message)
		&& !/private: private/.test((error as Error).message));
	assert.deepEqual(faults, ['private | note:2 is not yours']);
	assert.deepEqual(trace, [], 'nothing after the refusal is asked');
	assert.deepEqual(failed, [], 'a refusal is an answer, not a defect');
	client.socket.close();
	await server.stop();
});

test('a refusal that is not in the stack\'s shape crosses with its message whole', async () => {
	const { server, client } = await started({
		'a/Private': instance(() => ({
			offer: (name: string) => {
				if (name !== 'club') return undefined;
				throw Object.assign(new Error('members only'), { reason: 'private' });
			},
		})),
		// A fix on it, and a message that does not open with the reason, is still not the shape.
		'b/Odd': instance(() => ({
			offer: (name: string) => {
				if (name !== 'odd') return undefined;
				throw Object.assign(new Error('closed for now. Ask an admin.'), { reason: 'private', fix: 'Ask an admin.' });
			},
		})),
	});
	const faults: string[] = [];
	client.link.share<Doc>('club', undefined, { fault: (reason, message) => { faults.push(`${reason} | ${message}`); } }).ready.catch(() => {});
	await settle();
	assert.deepEqual(faults, ['private | members only']);
	const odd = client.link.share<Doc>('odd', undefined, { fault: (reason, message) => { faults.push(`${reason} | ${message}`); } });
	odd.ready.catch(() => {});
	await settle();
	assert.deepEqual(faults, ['private | members only', 'private | closed for now. Ask an admin.']);
	client.socket.close();
	await server.stop();
});

test('a refusal that names closed is reported, and the page hears failed', async () => {
	// A client answers `closed` with its next socket and tells the page nothing, so a module's
	// refusal under that reason would leave the page waiting for good.
	const { server, client, failed } = await started({
		'a/Shut': instance(() => ({ offer: () => { throw codecError('closed', 'the room is shut', 'Open the room first.'); } })),
	});
	const share = client.link.share<Doc>('room:shut');
	await assert.rejects(share.ready, (error: unknown) => reasonOf(error) === 'failed');
	assert.equal(failed.length, 1);
	assert.match(failed[0]!, /^a\/Shut: .*the room is shut/);
	client.socket.close();
	await server.stop();
});

test('an offer that throws anything else is reported, and the page hears failed and nothing of the error', async () => {
	const { server, client, failed } = await started({
		'a/Broken': instance(() => ({ offer: () => { throw new TypeError('cannot read /srv/notes/secret.json'); } })),
		'b/After': instance(() => ({ offer: () => { throw new Error('never asked'); } })),
	});
	const faults: string[] = [];
	const share = client.link.share<Doc>('note:3', undefined, { fault: (reason, message) => { faults.push(`${reason} | ${message}`); } });
	await assert.rejects(share.ready, (error: unknown) => reasonOf(error) === 'failed' && !(error as Error).message.includes('/srv'));
	assert.deepEqual(faults, ['failed | note:3 could not be offered']);
	assert.deepEqual(failed, ['a/Broken: cannot read /srv/notes/secret.json']);
	client.socket.close();
	await server.stop();
});

test('an offer with no accept is refused as a share is, reported, and the page hears failed', async () => {
	const { server, client, failed } = await started({
		'a/Careless': instance(() => ({ offer: () => ({ document: createObject<Doc>({}) }) })),
	});
	await assert.rejects(client.link.share<Doc>('board').ready, (error: unknown) => reasonOf(error) === 'failed');
	assert.equal(failed.length, 1);
	assert.match(failed[0]!, /^a\/Careless: no-accept: board/);
	client.socket.close();
	await server.stop();
});

test('an offer whose document is not an observable is reported, and the name is offered again on the next share', async () => {
	let good = false;
	const { server, client, failed } = await started({
		'a/Sloppy': instance(() => ({
			offer: () => ({ document: good ? createObject<Doc>({ fixed: true }) : { plain: true }, ...open }),
		})),
	});
	await assert.rejects(client.link.share<Doc>('board').ready, (error: unknown) => reasonOf(error) === 'failed');
	assert.equal(failed.length, 1);
	assert.match(failed[0]!, /^a\/Sloppy: not-observable/);
	good = true;
	assert.equal((await client.link.share<Doc>('board').ready).fixed, true, 'the failed share left nothing behind on the link');
	client.socket.close();
	await server.stop();
});

test('a module the gate refuses is skipped, and a page every module skips is left waiting', async () => {
	const trace: string[] = [];
	const refusal: Refusal = { code: 'signed-out', message: 'sign in first' };
	const gate: Gate = {
		identify: () => ({ context: {} }),
		access: ({ name }) => (name.startsWith('private/') ? [refusal] : []),
	};
	const { server, client } = await started({
		'private/Notes': instance(() => ({ offer: () => { trace.push('private'); return { document: createObject<Doc>({}), ...open }; } })),
		'public/Board': instance(() => ({
			offer: (name: string) => { trace.push(`public ${name}`); return name === 'board' ? { document: createObject<Doc>({ open: true }), ...open } : undefined; },
		})),
	}, gate);
	assert.equal((await client.link.share<Doc>('board').ready).open, true);
	const waiting = client.link.share<Doc>('note:4');
	assert.equal(await state(waiting.ready), 'waiting', 'a skip refuses nothing: the share waits, as it always has');
	assert.deepEqual(trace, ['public board', 'public note:4']);
	client.socket.close();
	await server.stop();
});

test('the walk waits for every connection hook, and a hook that shares the name pairs first', async () => {
	const trace: string[] = [];
	let release: () => void = () => {};
	const { server, client } = await started({
		'a/Slow': instance(() => ({
			connection: async ({ link }: Connection) => {
				trace.push('hook start');
				await new Promise<void>((done) => { release = done; });
				link.share('board', createObject<Doc>({ from: 'hook' }), open);
				trace.push('hook end');
			},
		})),
		'b/Offers': instance(() => ({
			offer: (name: string) => { trace.push(`offer ${name}`); return { document: createObject<Doc>({ from: 'offer' }), ...open }; },
		})),
	});
	const board = client.link.share<Doc>('board');
	const other = client.link.share<Doc>('other');
	await settle();
	assert.deepEqual(trace, ['hook start'], 'no module is asked while a hook is still running');
	release();
	assert.equal((await board.ready).from, 'hook', 'the hook\'s share paired with the page\'s');
	assert.equal((await other.ready).from, 'offer');
	assert.deepEqual(trace, ['hook start', 'hook end', 'offer other'], 'and the name the hook shared was never offered');
	client.socket.close();
	await server.stop();
});

test('a decline leaves the page\'s share for a call to pair with later, as before', async () => {
	const links = new WeakMap<object, GatedLink>();
	const { server, client } = await started({
		'a/Declines': instance(() => ({ offer: () => undefined })),
		'b/State': instance(() => ({
			connection: ({ link, context }: Connection) => { links.set(context as object, link); },
			call: (_args: unknown, context: unknown) => {
				links.get(context as object)!.share('state', createObject<Doc>({ from: 'call' }), open);
				return 'shared';
			},
		})),
	});
	const share = client.link.share<Doc>('state');
	assert.equal(await state(share.ready), 'waiting');
	assert.equal(await client.asks.ask('b/State'), 'shared');
	assert.equal((await share.ready).from, 'call');
	client.socket.close();
	await server.stop();
});

test('an offer that arrives after the page stopped asking is not shared, and its fault hears left', async () => {
	let answer: (offer: Offer) => void = () => {};
	const faults: string[] = [];
	const { server, client } = await started({
		'a/Slow': instance(() => ({ offer: () => new Promise<Offer>((done) => { answer = done; }) })),
	});
	const share = client.link.share<Doc>('board');
	await settle();
	share.stop();
	await settle();
	answer({ document: createObject<Doc>({}), ...open, fault: (reason) => { faults.push(reason); } });
	await settle();
	assert.deepEqual(faults, ['left']);
	client.socket.close();
	await server.stop();
});

test('a page that stops asking while the gate decides is never offered the name', async () => {
	let decide: () => void = () => {};
	let asked = 0;
	const gate: Gate = {
		identify: () => ({ context: {} }),
		access: () => new Promise((done) => { decide = () => { done([]); }; }),
	};
	const { server, client } = await started({
		'a/Board': instance(() => ({ offer: (): Offer => { asked += 1; return { document: createObject<Doc>({}), ...open }; } })),
	}, gate);
	const share = client.link.share<Doc>('board');
	await settle();
	share.stop();
	await settle();
	decide();
	await settle();
	assert.equal(asked, 0, 'a module is asked only for a share still waiting when its turn comes');
	client.socket.close();
	await server.stop();
});

test('an offer that arrives after a share of the module\'s own paired with the page does not say the page left', async () => {
	let answer: (offer: Offer) => void = () => {};
	let link: GatedLink | undefined;
	const faults: string[] = [];
	const { server, client } = await started({
		'a/Slow': instance(() => ({
			connection: (connection: Connection) => { link = connection.link; },
			offer: () => new Promise<Offer>((done) => { answer = done; }),
		})),
	});
	const share = client.link.share<Doc>('board');
	await settle();
	link!.share('board', createObject<Doc>({ from: 'direct' }), open);
	assert.equal((await share.ready).from, 'direct');
	answer({ document: createObject<Doc>({}), ...open, fault: (reason, message) => { faults.push(`${reason}: ${message}`); } });
	await settle();
	assert.deepEqual(faults, ['left: nothing was waiting for board when this offer came']);
	client.socket.close();
	await server.stop();
});

test('an offer that arrives after the connection ended is not shared, and its fault hears closed', async () => {
	let answer: (offer: Offer) => void = () => {};
	const faults: string[] = [];
	const { server, client } = await started({
		'a/Slow': instance(() => ({ offer: () => new Promise<Offer>((done) => { answer = done; }) })),
	});
	client.link.share<Doc>('board').ready.catch(() => {});
	await settle();
	client.socket.close();
	await settle();
	answer({ document: createObject<Doc>({}), ...open, fault: (reason) => { faults.push(reason); } });
	await settle();
	assert.deepEqual(faults, ['closed']);
	await server.stop();
});

test('the offered share\'s fault hears left when the page stops it, and closed when the connection ends', async () => {
	const faults: string[] = [];
	const { server, client } = await started({
		'a/Offers': instance(() => ({ offer: (name: string) => ({ document: createObject<Doc>({}), ...open, fault: (reason: string) => { faults.push(`${name} ${reason}`); } }) })),
	});
	const first = client.link.share<Doc>('first');
	await first.ready;
	await client.link.share<Doc>('second').ready;
	first.stop();
	await settle();
	assert.deepEqual(faults, ['first left']);
	client.socket.close();
	await settle();
	assert.deepEqual(faults, ['first left', 'second closed']);
	await server.stop();
});

test('an offered share\'s fault or refused that throws is reported under the module\'s name, and nothing escapes', async () => {
	const { server, client, failed } = await started({
		'a/Clumsy': instance(() => ({
			offer: (): Offer => ({
				document: createObject<Doc>({ n: 1 }),
				accept: () => [{ code: 'no', message: 'nothing is written here' }],
				refused: () => { throw new Error('refused handler blew up'); },
				fault: () => { throw new Error('fault handler blew up'); },
			}),
		})),
	});
	const share = client.link.share<Doc>('board');
	const copy = await share.ready;
	copy.n = 2;
	await settle();
	share.stop();
	await settle();
	assert.deepEqual(failed, ['a/Clumsy: refused handler blew up', 'a/Clumsy: fault handler blew up']);
	client.socket.close();
	await server.stop();
});

test('a module is asked once per share still waiting: a second share of the name takes the first one\'s place', async () => {
	const asked: string[] = [];
	const { server, client } = await started({
		'a/Counts': instance(() => ({ offer: (name: string) => { asked.push(name); return undefined; } })),
	});
	client.link.share<Doc>('board').ready.catch(() => {});
	client.link.share<Doc>('board').ready.catch(() => {});
	await settle();
	assert.deepEqual(asked, ['board'], 'the first share was replaced before its turn, so only the second is asked about');

	// A share made once the first has been answered is asked about on its own.
	client.link.share<Doc>('other').ready.catch(() => {});
	await settle();
	client.link.share<Doc>('other').ready.catch(() => {});
	await settle();
	assert.deepEqual(asked, ['board', 'other', 'other']);
	client.socket.close();
	await server.stop();
});

test('an application with no offer hook sends nothing for a name nobody shares, as before', async () => {
	const { server, client } = await started({ 'a/Plain': instance(() => ({ call: () => 'x' })) });
	const share = client.link.share<Doc>('board');
	assert.equal(await state(share.ready), 'waiting');
	client.socket.close();
	await server.stop();
});

test('without a failed handler an offer that throws is written to the console and the process goes on', () => {
	const helpers = new URL('./helpers.ts', import.meta.url).href;
	const script = `
		import { createServer, open } from '@aweftjs/server';
		import { asClient, connectTo, fakeListener, instance, sourceOf } from '${helpers}';
		const source = sourceOf({ 'app/Broken': instance(() => ({ offer: () => { throw new Error('module blew up'); } })) });
		const listening = fakeListener();
		const server = createServer({ sources: [source], gate: open, listener: listening.listener });
		await server.start();
		const client = asClient(await connectTo(listening.handlers()));
		const heard = await client.link.share('board').ready.catch((e) => e.reason);
		console.log('page heard ' + heard);
		setTimeout(() => { console.log('still alive'); process.exit(0); }, 200);
	`;
	const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
		cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 20_000,
	});
	assert.equal(run.status, 0, `the process should have lived: ${run.stdout} ${run.stderr}`);
	assert.match(run.stdout, /page heard failed/);
	assert.match(run.stdout, /still alive/);
	assert.match(run.stderr, /app\/Broken: an offer threw/);
	assert.match(run.stderr, /module blew up/);
});
