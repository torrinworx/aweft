// The suite a `sandbox` runner passes rather than claims (design 070).
//
// The window half: what a hostile module can and cannot do from inside a room, whatever the
// room is. Each check is a named function that throws on failure and runs against a runner
// the caller makes, so a runner written outside this repo proves itself the same way. No
// runner, no assert library and no Node import here: this file also runs in a browser page.
//
// Append-only. A case is added for every escape ever found and none is removed.

import { createArray, createObject } from '@aweftjs/core';
import { type Runner, type Sandbox, createSandbox } from '@aweftjs/sandbox';

/** What a check needs: a fresh runner nobody else is using. */
export type MakeRunner = () => Runner;

/** One named obligation the window has to meet behind a runner. */
export interface RoomCheck {
	readonly name: string;
	run(make: MakeRunner): Promise<void>;
}

const check = (ok: boolean, what: string): void => {
	if (!ok) throw new Error(`room check failed: ${what}`);
};

const reasonOf = (error: unknown): string => String((error as { reason?: unknown } | null)?.reason);
const pathOf = (error: unknown): string => String((error as { path?: unknown } | null)?.path);

const failsWith = async (reason: string, what: string, run: () => Promise<unknown>): Promise<unknown> => {
	try {
		await run();
	} catch (error) {
		check(reasonOf(error) === reason, `${what}: expected ${reason}, got ${reasonOf(error)} (${String((error as Error).message)})`);
		return error;
	}
	check(false, `${what}: expected ${reason}, and it answered`);
	return undefined;
};

const entry = (source: string): object => createObject({ source });

/** A module that calls one function of a granted name and hands back what it said. */
const relay = (grant: string, short: string, fn: string): string => `
export const deps = ['${grant}'];
export default ({ imports }) => ({ run: async (...args) => imports.${short}.${fn}(...args) });`;

const room = async (
	make: MakeRunner,
	modules: Record<string, string>,
	grants: readonly string[],
	exposed: Record<string, object>,
): Promise<{ sandbox: Sandbox; grants: string[]; modules: Record<string, unknown> }> => {
	const document = createObject<Record<string, unknown>>(Object.fromEntries(Object.entries(modules).map(([name, source]) => [name, entry(source)])));
	const list = createArray<string>(grants);
	const sandbox = await createSandbox({ runner: make(), modules: document, grants: list, limits: { callMs: 20000 } });
	for (const [name, instance] of Object.entries(exposed)) sandbox.expose(name, instance);
	return { sandbox, grants: list, modules: document };
};

const checks: RoomCheck[] = [
	{
		name: 'a module reaches no name it was not granted, exposed or not',
		run: async (make) => {
			const { sandbox } = await room(make, { 'evil/Reach': relay('secret/Vault', 'Vault', 'open') }, [], { 'secret/Vault': { open: () => 'the vault' } });
			try {
				await failsWith('missing', 'loading a module that needs an ungranted name', () => sandbox.load(['evil/Reach']));
			} finally {
				await sandbox.stop();
			}
		},
	},
	{
		name: 'a name removed from the grants refuses from the next call, and granted again answers again',
		run: async (make) => {
			const { sandbox, grants } = await room(make, { 'app/Relay': relay('files/Read', 'Read', 'read') }, ['files/Read'], { 'files/Read': { read: (n: string) => `<${n}>` } });
			try {
				const { 'app/Relay': relayStub } = await sandbox.load(['app/Relay']);
				check(await relayStub!.run!('a') === '<a>', 'granted, it answers');
				grants.splice(grants.indexOf('files/Read'), 1);
				await failsWith('refused', 'a call on a revoked name', () => relayStub!.run!('b'));
				grants.push('files/Read');
				check(await relayStub!.run!('c') === '<c>', 'granted again, it answers again');
			} finally {
				await sandbox.stop();
			}
		},
	},
	{
		name: 'a granted name wins over a module of the same name in the document',
		run: async (make) => {
			const { sandbox } = await room(make, {
				'files/Read': 'export default () => ({ read: () => "the impostor" })',
				'app/Relay': relay('files/Read', 'Read', 'read'),
			}, ['files/Read'], { 'files/Read': { read: () => 'the host' } });
			try {
				const { 'app/Relay': relayStub } = await sandbox.load(['app/Relay']);
				check(await relayStub!.run!() === 'the host', 'the document entry did not shadow the grant');
			} finally {
				await sandbox.stop();
			}
		},
	},
	{
		name: 'a function in an argument is refused by name before anything crosses',
		run: async (make) => {
			const calls: unknown[] = [];
			const { sandbox } = await room(make, {
				'evil/Smuggle': `export const deps = ['log/Write']; export default ({ imports }) => ({ run: () => imports.Write.write({ note: 'hi', fn: () => 1 }) });`,
			}, ['log/Write'], { 'log/Write': { write: (v: unknown) => { calls.push(v); return 'ok'; } } });
			try {
				const { 'evil/Smuggle': smuggle } = await sandbox.load(['evil/Smuggle']);
				const error = await failsWith('not-data', 'a function in an argument', () => smuggle!.run!());
				check(pathOf(error) === 'args[0].fn', `named by path, got ${pathOf(error)}`);
				check(calls.length === 0, 'the host function never ran');
				const hostError = await failsWith('not-data', 'a function in an argument from the host', () => smuggle!.run!({ fn: () => 1 }));
				check(pathOf(hostError) === 'args[0].fn', 'named by path from the host too');
				// A symbol and a bigint are not JSON either, and are refused the same way.
				const sym = await failsWith('not-data', 'a symbol in an argument', () => smuggle!.run!(Symbol('x')));
				check(/is a symbol/.test((sym as Error).message), `named as a symbol, not by a class: ${(sym as Error).message}`);
				const big = await failsWith('not-data', 'a bigint in an argument', () => smuggle!.run!(10n));
				check(/is a bigint/.test((big as Error).message), `named as a bigint: ${(big as Error).message}`);
				// A getter that throws while the argument is walked is a refusal to carry it, with a
				// reason, not a bare throw with no reason (the result side already reported one).
				const landmine = Object.defineProperty({}, 'boom', { enumerable: true, get() { throw new Error('do not read me'); } });
				await failsWith('not-data', 'a getter that throws in an argument', () => smuggle!.run!(landmine));
			} finally {
				await sandbox.stop();
			}
		},
	},
	{
		name: 'a function, a non-plain object or an observable in a result is refused by name',
		run: async (make) => {
			const { sandbox } = await room(make, {
				'evil/Leak': `export default () => ({ fn: () => ({ leak: () => 1 }), map: () => new Map(), fine: () => ({ n: [1, 'two', null, { deep: true }] }) });`,
				'app/Relay': relay('bad/Host', 'Host', 'give'),
			}, ['bad/Host'], { 'bad/Host': { give: () => ({ inner: { fn: () => 1 } }) } });
			try {
				const { 'evil/Leak': leak, 'app/Relay': relayStub } = await sandbox.load(['evil/Leak', 'app/Relay']);
				const fromRoom = await failsWith('not-data', 'a function in a room result', () => leak!.fn!());
				check(pathOf(fromRoom) === 'result.leak', `named by path, got ${pathOf(fromRoom)}`);
				await failsWith('not-data', 'a Map in a room result', () => leak!.map!());
				const fromHost = await failsWith('not-data', 'a function in a host result', () => relayStub!.run!());
				check(pathOf(fromHost) === 'result.inner.fn', `named by path, got ${pathOf(fromHost)}`);
				check(JSON.stringify(await leak!.fine!()) === '{"n":[1,"two",null,{"deep":true}]}', 'plain data crosses unchanged');
			} finally {
				await sandbox.stop();
			}
		},
	},
	{
		name: 'an import is a plain object carrying only the functions the instance had, and never its constructor',
		run: async (make) => {
			// A class instance, so the reader that walks the prototype chain must skip the
			// constructor rather than hand the room a callable that reconstructs the class.
			class Files { read(): number { return 1; } secret = 'not a function'; token = 42; }
			const { sandbox } = await room(make, {
				'app/Look': `export const deps = ['files/Read']; export default ({ imports }) => ({
					keys: () => Object.keys(imports.Read).sort(),
					thenable: () => typeof imports.Read.then,
					proto: () => Object.getPrototypeOf(imports.Read) === Object.prototype,
				});`,
			}, ['files/Read'], { 'files/Read': new Files() });
			try {
				const { 'app/Look': look } = await sandbox.load(['app/Look']);
				check(JSON.stringify(await look!.keys!()) === '["read"]', 'only the function crossed, not the fields or the class constructor');
				check(await look!.thenable!() === 'undefined', 'no then, so awaiting the import is safe');
				check(await look!.proto!() === true, 'a plain object, not a Proxy or a class');
				check(!('then' in look!), 'the host stub has no then either');
				check(await look! === look, 'awaiting a stub yields the stub');
			} finally {
				await sandbox.stop();
			}
		},
	},
	{
		name: 'two rooms over one module document share no instance and no state',
		run: async (make) => {
			const document = createObject<Record<string, unknown>>({
				'app/Counter': entry('let n = 0; export default () => ({ bump: () => ++n });'),
			});
			const a = await createSandbox({ runner: make(), modules: document, grants: createArray<string>([]) });
			const b = await createSandbox({ runner: make(), modules: document, grants: createArray<string>([]) });
			try {
				const counterA = (await a.load(['app/Counter']))['app/Counter']!;
				const counterB = (await b.load(['app/Counter']))['app/Counter']!;
				check(await counterA.bump!() === 1 && await counterA.bump!() === 2, 'room A counts');
				check(await counterB.bump!() === 1, 'room B starts from nothing');
			} finally {
				await a.stop();
				await b.stop();
			}
		},
	},
	{
		name: 'a host function that throws answers failed with its message, and the next call still works',
		run: async (make) => {
			let calls = 0;
			const { sandbox } = await room(make, { 'app/Relay': relay('flaky/Thing', 'Thing', 'go') }, ['flaky/Thing'], {
				'flaky/Thing': { go: () => { calls += 1; if (calls === 1) throw new Error('first time hurts'); return 'fine'; } },
			});
			try {
				const { 'app/Relay': relayStub } = await sandbox.load(['app/Relay']);
				const error = await failsWith('failed', 'a throwing host function', () => relayStub!.run!());
				check(String((error as Error).message).includes('first time hurts'), 'the message crossed');
				check(await relayStub!.run!() === 'fine', 'the bridge is still answering');
			} finally {
				await sandbox.stop();
			}
		},
	},
	{
		name: 'a room module that throws answers failed, and a function it does not have is missing',
		run: async (make) => {
			const { sandbox } = await room(make, { 'app/Grumpy': `export default () => ({ go: () => { throw new Error('no'); } });` }, [], {});
			try {
				const { 'app/Grumpy': grumpy } = await sandbox.load(['app/Grumpy']);
				const error = await failsWith('failed', 'a throwing room function', () => grumpy!.go!());
				check(String((error as Error).message).includes('no'), 'the message crossed');
				check(!('nope' in grumpy!), 'a function the instance lacks is not on the stub');
			} finally {
				await sandbox.stop();
			}
		},
	},
	{
		name: 'a call after stop rejects with closed rather than waiting',
		run: async (make) => {
			const { sandbox } = await room(make, { 'app/Echo': `export default () => ({ echo: (x) => x });` }, [], {});
			const { 'app/Echo': echo } = await sandbox.load(['app/Echo']);
			check(await echo!.echo!('x') === 'x', 'answers while running');
			await sandbox.stop();
			await failsWith('closed', 'a call after stop', () => echo!.echo!('y'));
			await failsWith('closed', 'a load after stop', () => sandbox.load(['app/Echo']));
		},
	},
	{
		name: 'a module the document does not hold is missing, and what loaded before stays loaded',
		run: async (make) => {
			const { sandbox } = await room(make, { 'app/Echo': `export default () => ({ echo: (x) => x });` }, [], {});
			try {
				await sandbox.load(['app/Echo']);
				await failsWith('missing', 'a name in no source', () => sandbox.load(['nope/Thing']));
				check((await sandbox.loaded()).includes('app/Echo'), 'the earlier module is still loaded');
				check(await sandbox.unload('app/Echo') === true && await sandbox.unload('app/Echo') === false, 'unload answers true then false');
			} finally {
				await sandbox.stop();
			}
		},
	},
];

/**
 * The window half of the escape suite: what a hostile module cannot do from inside a room,
 * whatever runner made the room.
 *
 * Returns: the checks, each named, each taking a function that makes a fresh runner.
 *
 * Example:
 *   for (const c of roomChecks()) test(c.name, () => c.run(() => inProcess()));
 */
export const roomChecks = (): RoomCheck[] => [...checks];
