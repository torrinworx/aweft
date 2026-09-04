// What the suites share: module documents from source text, and the two Node runners.

import { createArray, createObject } from '@aweftjs/core';
import { type Runner, type Sandbox, type SandboxOptions, createSandbox, inProcess } from '@aweftjs/sandbox';
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

export const reasonOf = (error: unknown): string => String((error as { reason?: unknown } | null)?.reason);

export const until = async (what: string, ok: () => boolean | Promise<boolean>, ms = 5000): Promise<void> => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await ok()) return;
		await new Promise((done) => setTimeout(done, 10));
	}
	throw new Error(`timed out waiting for ${what}`);
};
