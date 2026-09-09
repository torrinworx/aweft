// What a gate is (design 071), what a listener and a connection are (design 072), and
// what a module may carry for the server to run. Types, plus the one error shape.

import { codecError } from '@aweftjs/codec';
import type { Refusal } from '@aweftjs/core';
import type { Loader, Source } from '@aweftjs/modules';
import type { Commit, ShareHandlers, Shared, SocketLike, WireReason } from '@aweftjs/sync';

/** Where a request or a connection came from, as far as the listener can tell. */
export interface Peer {
	readonly address: string | undefined;
}

/**
 * What `identify` answers: the context every hook receives for this connection or request,
 * or the reasons the caller is turned away. The server interprets neither.
 */
export type Identified<C> =
	| { readonly context: C }
	| { readonly refused: readonly Refusal[] };

/** A loaded module, as the gate is asked about it. */
export interface Named {
	readonly name: string;
	readonly instance: unknown;
}

/**
 * Who may reach a module. Required by `createServer`; nothing ships as a default.
 *
 * Any object with these two functions is a gate, so a module instance is one, and so is an
 * object literal ten lines long. `open` is the trusted case.
 */
export interface Gate<C = unknown> {
	/**
	 * Once per connection and once per HTTP request, before anything else.
	 *
	 * Params:
	 *   request: the web-standard request; for a connection, the handshake
	 *   peer: `{ address }`, as far as the listener could tell
	 *
	 * Returns: `{ context }` with whatever this connection is, or `{ refused: reasons }`, which
	 * answers 401 and, for a connection, opens no socket. May be asynchronous. A throw is a
	 * defect and answers 500.
	 */
	identify(request: Request, peer: Peer): Identified<C> | Promise<Identified<C>>;
	/**
	 * Before a module sees a connection, a call or a request.
	 *
	 * Params:
	 *   module: its name and its instance, as the loader holds them
	 *   context: what `identify` answered
	 *
	 * Returns: the reasons to refuse; empty allows. May be asynchronous.
	 */
	access(module: Named, context: C): readonly Refusal[] | Promise<readonly Refusal[]>;
}

/**
 * Share handlers that say who may write. On a connection's link, `accept` is required, so no
 * module shares a document writable by omission (design 071).
 */
export interface Accepting extends ShareHandlers {
	readonly accept: (commit: Commit) => readonly WireReason[];
}

/** The link a `connection` hook receives: a sync link whose every share says who may write. */
export interface GatedLink {
	/**
	 * Share a document on this connection.
	 *
	 * Params:
	 *   name: the topic, which the other end shares under the same name
	 *   document: the document, or `undefined` to take the other end's
	 *   handlers: with `accept`, always; pass `open` for the trusted case
	 *
	 * Returns: the share, as `@aweftjs/sync` hands it back.
	 *
	 * Throws: a `ServerError` with reason `no-accept` when the handlers carry no `accept`.
	 */
	share<T extends object>(name: string, document: T | undefined, handlers: Accepting): Shared<T>;
}

/** What a `connection` hook is handed. */
export interface Connection<C = unknown> {
	readonly link: GatedLink;
	/** The handshake request. */
	readonly request: Request;
	/** What the gate's `identify` answered. */
	readonly context: C;
	/** End this connection. */
	close(): void;
}

export interface Progress {
	/** Send a progress report to the caller, before the result. Reports after it are dropped. */
	progress(value: unknown): void;
}

/** An HTTP route: `(request, context)` to a `Response`. */
export type Route<C = unknown> = (request: Request, context: C) => Response | Promise<Response>;

/** What a `connection` hook returns: nothing, or the function run when the connection ends. */
export type Ending = (() => unknown) | undefined | void;

/**
 * What the server reads off a loaded module's instance. Every field is optional; a module
 * with none of them is never asked about.
 *
 * Nothing about who is on the other end is decided here: `context` is what the gate said.
 */
export interface ServerModule<C = unknown> {
	/** Run once per connection the gate allows this module to see. May return the function run when it ends. */
	connection?(connection: Connection<C>): Ending | Promise<Ending>;
	/**
	 * Answer an `ask` naming this module, after the gate allowed it.
	 *
	 * Throws: the asks this never sees are refused for the caller instead, with reason
	 * `closed` when the connection has ended, `missing` when the module is not loaded or has
	 * no `call`, and `refused` when the gate answered with reasons.
	 */
	call?(args: unknown, context: C, tools: Progress): unknown;
	/** HTTP routes keyed by exact `METHOD /path`, such as `POST /api/session`. */
	readonly routes?: Readonly<Record<string, Route<C>>>;
}

/** What `socket` answers to accept an upgrade: the function the listener hands the opened socket to. */
export type Accept = (socket: SocketLike) => void;

/** What a listener calls. */
export interface ListenerHandlers {
	/** An HTTP request. Always answered. */
	request(request: Request, peer: Peer): Promise<Response>;
	/** A WebSocket handshake. A `Response` refuses it, with that status; a function accepts it. */
	socket(request: Request, peer: Peer): Promise<Response | Accept>;
}

/**
 * Where connections and requests come from. `node` on `@aweftjs/server/node` ships; a
 * listener for another runtime is proven by `listenerChecks()` from `@aweftjs/testing`.
 */
export interface Listener {
	/** Start accepting, handing every request and handshake to the handlers. */
	start(handlers: ListenerHandlers): Promise<void>;
	/** Stop accepting and end every open connection. Calling it twice is not an error. */
	stop(): Promise<void>;
}

export interface ServerHandlers {
	/**
	 * A module's `connection` hook or end function threw, a route threw, the gate threw, or a
	 * route conflict was met by a request. `name` is the module, or `gate` or `routes`.
	 * Without a handler the error is raised where nothing catches it.
	 */
	readonly failed?: ((name: string, error: unknown) => void) | undefined;
}

export interface ServerOptions {
	/** Where the modules come from. `start` loads every module every source lists (design 240). */
	readonly sources: readonly Source[];
	/**
	 * The application's store, handed to every module's factory as `store`, and the only thing
	 * this package hands one. Typed `unknown` because `server` may not import `@aweftjs/store`;
	 * a module that reads it types it itself. Left out, no factory is handed a `store` at all.
	 */
	readonly store?: unknown;
	/** Who may reach what: a `Gate`, or the name of a module that is one (design 241). */
	readonly gate: Gate | string;
	readonly listener: Listener;
	readonly handlers?: ServerHandlers | undefined;
}

export interface Server {
	/**
	 * Load every module the sources list, resolve a gate named as a string, check the routes,
	 * then start the listener.
	 *
	 * Throws: whatever the loader raised, unwrapped, when a module fails to load, leaving the
	 * server not started; a `ServerError` with reason `missing` when `gate` names a module that
	 * is not loaded or is not a gate, `route-conflict` when two loaded modules declare the same
	 * `METHOD /path`, naming both, and `started` when this server is already started.
	 */
	start(): Promise<void>;
	/**
	 * End every connection, stop the listener, then unload every loaded module in reverse load
	 * order, so each module's `stop` runs after nothing can reach it. Safe after a `start` that
	 * failed part way: what was made is still let go of.
	 */
	stop(): Promise<void>;
	/**
	 * The loader this server built from `sources`. Read an instance off it, `follow` a module
	 * document with it, or load and unload while the server runs.
	 */
	readonly loader: Loader;
}

/**
 * An error this package raises, with a reason a caller can branch on.
 *
 * Reasons: `missing` (`createServer` without one of its three, a gate named that is not a
 * loaded gate, or an ask naming a module that is not loaded or has no `call`),
 * `not-an-option` (`loader` or `props` passed to `createServer`, which builds its own),
 * `route-conflict`, `no-accept` (a share on a connection without `accept`), `not-a-response`
 * (a route answered with something else; reported, never thrown to a caller), `started`,
 * `over-bound` (a request body past the listener's `maxPayload`), `refused` (the gate refused
 * an ask) and `closed` (an ask on a connection that has ended).
 */
export interface ServerError extends Error {
	readonly reason: string;
}

export const serverError = (reason: string, detail: string, fix: string): ServerError =>
	codecError(reason, detail, fix);
