// What the suites share: module documents from source text, and the two Node runners.

import { type Derived, createArray, createObject, mutable } from '@aweftjs/core';
import { type ClientLike, type Runner, type Sandbox, type SandboxOptions, createSandbox, inProcess } from '@aweftjs/sandbox';
import { child } from '@aweftjs/sandbox/node';

export const document = (modules: Record<string, string>): Record<string, unknown> =>
	createObject<Record<string, unknown>>(Object.fromEntries(Object.entries(modules).map(([name, source]) => [name, createObject({ source })])));

export const grantsOf = (names: readonly string[] = []): string[] => createArray<string>(names);

/** The two runners that run under Node, by name, so a suite runs once per runner. */
export const runners: Record<string, () => Runner> = {
	'in process': () => inProcess(),
	'child process': () => child(),
};

export const open = async (
	make: () => Runner,
	modules: Record<string, string>,
	names: readonly string[] = [],
	rest: Partial<SandboxOptions> = {},
): Promise<{ sandbox: Sandbox; modules: Record<string, unknown>; grants: string[] }> => {
	const doc = document(modules);
	const grants = grantsOf(names);
	const sandbox = await createSandbox({ runner: make(), modules: doc, grants, limits: { callMs: 20000 }, ...rest });
	return { sandbox, modules: doc, grants };
};

/**
 * A client whose `status` counts what is watching it: `live` is the number of effects and
 * watchers taken out and not yet given back, so a test can tell whether the sandbox let go of
 * the cell. `set` writes the cell underneath.
 */
export const countingClient = (answer: (name: string, args: unknown) => unknown, status = 'connecting'): ClientLike & { set(status: string): void; readonly live: number } => {
	const cell = mutable(status);
	let live = 0;
	const counted = (take: (fn: (value: string) => void) => () => void) => (fn: (value: string) => void): () => void => {
		live += 1;
		const stop = take(fn);
		let given = false;
		return () => {
			if (!given) live -= 1;
			given = true;
			stop();
		};
	};
	const seen = new Proxy(cell, {
		get: (target, prop) => {
			if (prop === 'effect') return counted((fn) => target.effect(fn));
			if (prop === 'watch') return counted((fn) => target.watch(fn));
			const held: unknown = Reflect.get(target, prop);
			return typeof held === 'function' ? (held as (...a: unknown[]) => unknown).bind(target) : held;
		},
	}) as Derived<string>;
	return { status: seen, ask: async (name, args) => answer(name, args), set: (value) => { cell.set(value); }, get live() { return live; } };
};

export const reasonOf = (error: unknown): string => String((error as { reason?: unknown } | null)?.reason);

export const until = async (what: string, ok: () => boolean | Promise<boolean>, ms = 5000): Promise<void> => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await ok()) return;
		await new Promise((done) => setTimeout(done, 10));
	}
	throw new Error(`timed out waiting for ${what}`);
};
