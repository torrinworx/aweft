// A Node process as the room (design 069).
//
// The process runs under Node's permission model with code generation from strings off, an
// empty environment unless one is given, read access to this package's own tree and whatever
// `read` names, and nothing else. That is what Node stops, and Node says it is a seat belt
// rather than a boundary; `wrap` is where the operator's wall goes, as one argument list in
// front of the command.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type { Runner } from './contract.ts';
import { fromIpc } from './ipc.ts';

export interface ChildOptions {
	/** None ship. */
	readonly limits?: { readonly memoryMB?: number | undefined } | undefined;
	/** A command and its arguments put in front of the Node command: a jail, a user switch. */
	readonly wrap?: readonly string[] | undefined;
	/** Paths the room may read besides this package's own tree: a bundle, a directory of modules. */
	readonly read?: readonly string[] | undefined;
	/** The room's environment. Empty unless given. */
	readonly env?: Readonly<Record<string, string>> | undefined;
}

const bootstrap = fileURLToPath(new URL('./child-bootstrap.ts', import.meta.url));
// What the bootstrap has to read to import the stack: the packages it and its imports live
// in, and the node_modules those resolve through. Granting the workspace root instead would
// hand a room `.git`, `docs` and every sibling's source, which the room has no need of; the
// operator's wall is what truly contains a room, but the seat belt need not be loose.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const stack = [`${root}packages/`, `${root}node_modules/`];

/**
 * A runner whose room is a child Node process.
 *
 * Params:
 *   options.limits.memoryMB: the process's heap limit
 *   options.wrap: a command prefix, such as a bubblewrap invocation
 *   options.read: extra read-only paths
 *   options.env: the process's environment; empty by default
 *
 * The room may read the stack's `packages` and `node_modules` (so it can import the framework
 * and its dependencies) and whatever `read` adds, and nothing else on disk. What it cannot do
 * is what Node's permission model denies: files outside those paths, the network, spawning,
 * worker threads, native addons, and `eval`. Node calls this a seat belt, not a boundary: it
 * does not deny a determined escape, so put a wall around it with `wrap`.
 *
 * Example:
 *   const runner = child({ limits: { memoryMB: 256 }, wrap: ['bwrap', '--unshare-all', ...] });
 */
export const child = (options: ChildOptions = {}): Runner => {
	let proc: ReturnType<typeof spawn> | undefined;
	let exited: Promise<void> | undefined;

	const flags = [
		'--permission',
		...stack.map((path) => `--allow-fs-read=${path}*`),
		...(options.read ?? []).map((path) => `--allow-fs-read=${path}`),
		'--disallow-code-generation-from-strings',
		'--disable-warning=ExperimentalWarning',
		...(options.limits?.memoryMB === undefined ? [] : [`--max-old-space-size=${options.limits.memoryMB}`]),
	];

	return {
		start: async () => {
			const wrap = options.wrap ?? [];
			const command = wrap.length > 0 ? wrap[0]! : process.execPath;
			const args = wrap.length > 0 ? [...wrap.slice(1), process.execPath, ...flags, bootstrap] : [...flags, bootstrap];
			const started = spawn(command, args, {
				stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
				serialization: 'advanced',
				env: { ...(options.env ?? {}) },
			});
			proc = started;
			exited = new Promise<void>((resolve) => { started.on('exit', () => resolve()); });
			started.on('error', () => {});
			return fromIpc(started as unknown as Parameters<typeof fromIpc>[0]);
		},
		stop: async () => {
			if (proc === undefined || proc.exitCode !== null || proc.signalCode !== null) return;
			proc.kill('SIGTERM');
			const timer = setTimeout(() => { proc?.kill('SIGKILL'); }, 1000);
			await exited;
			clearTimeout(timer);
		},
	};
};
