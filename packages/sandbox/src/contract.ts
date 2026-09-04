// What a room is (design 066), what a grant is (design 067), and what a runner is
// (design 069). Types only; nothing here runs code.

import type { Channel } from '@aweftjs/sync';

/**
 * Makes a room and the channel to it.
 *
 * A runner decides what the room is: the same process, a browser frame, a child process, a
 * container. The package decides what crosses the channel. A runner is used by one sandbox.
 */
export interface Runner {
	/** Make the room and hand back this end of the channel to it. */
	start(): Promise<Channel>;
	/** End the room. Calling it twice is not an error. */
	stop(): Promise<void>;
}

/** Where a room's modules and its libraries come from, and what it is told. */
export interface SandboxOptions {
	readonly runner: Runner;
	/** The module document: an observable object keyed by module name whose entries carry `source`. The room reads it and never writes it. */
	readonly modules: object;
	/** The names the room may reach, as an observable array from `createArray`. Change it whenever you like. */
	readonly grants: string[];
	/** Spread into every factory's props inside the room. Plain data only. */
	readonly props?: Readonly<Record<string, unknown>> | undefined;
	/** A module specifier the room can import whose default export is a bundle map for `fromBundle`. */
	readonly bundle?: string | undefined;
	/** Reload a module inside the room when its source changes. Off unless you say so. */
	readonly follow?: boolean | undefined;
	/** Where `follow` reports. */
	readonly handlers?: SandboxHandlers | undefined;
	/** Limits the host keeps. None ship. */
	readonly limits?: SandboxLimits | undefined;
}

export interface SandboxHandlers {
	/** A module inside the room was reloaded or unloaded by `follow`. */
	readonly applied?: ((name: string, action: 'reloaded' | 'unloaded') => void) | undefined;
	/** A reload inside the room failed. `error` is the message, because only data crosses. */
	readonly failed?: ((name: string, error: string) => void) | undefined;
}

export interface SandboxLimits {
	/** A call into the room the host has not heard back from in this many milliseconds errors with `timeout`. */
	readonly callMs?: number | undefined;
}

/** A loaded module inside the room, as the host sees it: one function per function the instance had. */
export type Stub = Readonly<Record<string, (...args: unknown[]) => Promise<unknown>>>;

/** The host's side of a room. */
export interface Sandbox {
	/**
	 * Load these modules and what they need inside the room, and hand back a stub for each.
	 *
	 * Params:
	 *   names: the modules wanted, by name
	 *
	 * Returns: one stub per name. Calling a stub's function is a call across the boundary,
	 * answered by the loaded instance; the arguments and the result must be plain data.
	 *
	 * Throws a `SandboxError` with the loader's reason when the room could not load them, or
	 * `closed` when the room has stopped.
	 *
	 * Example:
	 *   const { 'report/Summarize': summarize } = await sandbox.load(['report/Summarize']);
	 *   const text = await summarize.run('2026-09');
	 */
	load(names: readonly string[]): Promise<Readonly<Record<string, Stub>>>;
	/** Unload one module inside the room, calling its `stop` if it has one. True when it was loaded. */
	unload(name: string): Promise<boolean>;
	/** The names loaded inside the room right now, in the order they were instantiated. */
	loaded(): Promise<readonly string[]>;
	/**
	 * Put a trusted instance behind a name the room may be granted.
	 *
	 * Params:
	 *   name: the name a module inside the room puts in `deps`
	 *   instance: the object whose functions the room may call. Only its functions cross
	 *
	 * Returns: the function that withdraws the name. A call after that is `missing`.
	 *
	 * The name is reachable only while it is also in `grants`. Exposing it grants nothing.
	 *
	 * Example:
	 *   const withdraw = sandbox.expose('files/Read', { read: (path) => allowed(path) });
	 */
	expose(name: string, instance: object): () => void;
	/** End the room. Every call still waiting rejects with `closed`. */
	stop(): Promise<void>;
}

/**
 * An error this package raises, with a reason a caller can branch on.
 *
 * Reasons: `not-data` (an argument, a result or a prop that is not plain data; `path` names
 * it), `refused` (a name that is not granted), `missing` (a name that is granted but not
 * exposed, or a function the instance does not have), `malformed` (a row the other end wrote
 * that is not a call), `timeout`, `closed`, `failed` (the function threw; `message` carries
 * what it said), and the loader's own reasons passed through unchanged.
 */
export interface SandboxError extends Error {
	readonly reason: string;
	readonly path?: string;
}

export const sandboxError = (reason: string, detail: string, path?: string): SandboxError =>
	Object.assign(new Error(`sandbox: ${detail}`), path === undefined ? { reason } : { reason, path });

/** The two ends, as a row names them. */
export type Side = 'host' | 'room';

/** What the control document holds. Strings where the value is data, because a slot holds a primitive or an observable. */
export interface RoomDocument extends Record<string, unknown> {
	/** JSON text of the loader's props. */
	props: string;
	grants: string[];
	bundle: string | null;
	follow: boolean;
	/** By exposed name, JSON text of the instance's function names. */
	exposed: Record<string, string>;
}
