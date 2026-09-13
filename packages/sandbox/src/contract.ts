// What a room is (design 066), what a grant is (design 067), and what a runner is
// (design 069). Types only; nothing here runs code.

import { codecError } from '@aweftjs/codec';
import type { Derived } from '@aweftjs/core';
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
	/**
	 * Documents shared into the room under their keys, writable both ways (design 278). Each is
	 * an observable; `modules`, `room`, `calls` and `route` are reserved names.
	 */
	readonly documents?: Readonly<Record<string, object>> | undefined;
	/** The console levels the room forwards to `handlers.console`. `['error', 'warn']` unless given. */
	readonly console?: readonly string[] | undefined;
	/** What answers the room's asks: the page's client. With none, every ask is refused. */
	readonly client?: ClientLike | undefined;
	/** The page in the room: the act it shows and the route document the tail crosses on (design 279). */
	readonly page?: PageOptions | undefined;
}

/** What the host holds that a room's `ask` goes through. Shaped on the page's client, without naming it. */
export interface ClientLike {
	ask(name: string, args?: unknown): Promise<unknown>;
	readonly status: Derived<string>;
}

/** What a room with a page in it is told. */
export interface PageOptions {
	/** The act the room's stage shows, by module name. */
	readonly act: string;
	/** The host's copy of the route document, an observable object from `createObject`. */
	readonly route: object;
}

/**
 * One line that left the room as data (design 280): an uncaught error, an unhandled rejection
 * or a console call on a level the host named.
 */
export interface Report {
	readonly kind: 'error' | 'rejection' | 'console';
	/** The console method, for `console`. */
	readonly level?: string;
	readonly message: string;
	/** Taken in the room's realm; `''` when there was none. */
	readonly stack: string;
	/** The act on screen, when the room knows it. */
	readonly module?: string;
}

export interface SandboxHandlers {
	/** A module inside the room was reloaded or unloaded by `follow`. */
	readonly applied?: ((name: string, action: 'reloaded' | 'unloaded') => void) | undefined;
	/** A reload inside the room failed. `error` is the message, because only data crosses. */
	readonly failed?: ((name: string, error: string) => void) | undefined;
	/** An uncaught error or an unhandled rejection inside the room, as data. */
	readonly error?: ((entry: Report) => void) | undefined;
	/** A console call inside the room on a level named in `console`. */
	readonly console?: ((level: string, text: string, stack: string) => void) | undefined;
}

export interface SandboxLimits {
	/** A call into the room the host has not heard back from in this many milliseconds errors with `timeout`. */
	readonly callMs?: number | undefined;
}

/**
 * A loaded module inside the room, as the host sees it: one function per function the instance
 * had.
 *
 * Throws: a `SandboxError` from the promise a stub function returns. `not-data` when an
 * argument or the result is not plain data, with `path` naming it; `missing` when the room has
 * no such module or the instance has no such function; `timeout` when the room did not answer
 * within `limits.callMs`; `closed` when the room stopped with the call still waiting; and,
 * when the function itself threw, whatever it refused for, with its own message unchanged.
 */
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
	 * Throws: a `SandboxError`. The loader's own reason when the room could not load them,
	 * `closed` when the room has stopped, `timeout` when the room did not answer within
	 * `limits.callMs`, and `malformed` when the room answered with something that is not a
	 * table of stubs.
	 *
	 * Example:
	 *   const { 'report/Summarize': summarize } = await sandbox.load(['report/Summarize']);
	 *   const text = await summarize.run('2026-09');
	 */
	load(names: readonly string[]): Promise<Readonly<Record<string, Stub>>>;
	/**
	 * Unload one module inside the room, calling its `stop` if it has one. True when it was
	 * loaded.
	 *
	 * Throws: a `SandboxError` with reason `closed` when the room has stopped, `timeout` when
	 * it did not answer within `limits.callMs`, and `malformed` when it answered with
	 * something that is not an answer to this question.
	 */
	unload(name: string): Promise<boolean>;
	/**
	 * The names loaded inside the room right now, in the order they were instantiated.
	 *
	 * Throws: a `SandboxError` with reason `closed` when the room has stopped, `timeout` when
	 * it did not answer within `limits.callMs`, and `malformed` when it answered with
	 * something that is not a list of names.
	 */
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
 * it), `refused` (a name that is not granted, or an ask with no client to answer it),
 * `missing` (a name that is granted but not exposed, or a function the instance does not
 * have), `malformed` (a row the other end wrote that is not a call), `reserved` (a document
 * named as one of the room's own topics), `not-shared` (a document the host did not share),
 * `timeout`, `closed`, `failed` (the function threw; `message` carries what it said),
 * `no-page` (the iframe runner found no document and no MessageChannel), and the loader's
 * own reasons passed through unchanged.
 */
export interface SandboxError extends Error {
	readonly reason: string;
	readonly path?: string;
}

export const sandboxError = (reason: string, detail: string, fix: string, path?: string): SandboxError =>
	path === undefined ? codecError(reason, detail, fix) : Object.assign(codecError(reason, detail, fix), { path });

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
	/** The names the host shared beside the room's own (design 278). */
	documents: string[];
	/** The console levels that cross (design 280). */
	console: string[];
	/** The host client's status, mirrored; `closed` when the host has no client. */
	status: string;
	/** The act on screen, or null in a compute room. */
	page: { act: string } | null;
}
