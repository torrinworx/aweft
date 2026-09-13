// The far end: the room's own side of the window (designs 066, 280 to 283).
//
// The same file runs in a frame, a process, a container, or a test. `enter` connects the
// link, waits for the host's documents and answers with what a loader is built from; `serve`
// takes the loader and answers the host's calls against it. `inside` is the two in a row,
// which is what a compute room needs. A room with a page in it builds the loader itself
// between the two, so that the loader the host's calls reach is the loader its stage loads
// acts from. Nothing here knows what the room is or what is around it.

import { type Derived, immutable, observer, textIdOf } from '@aweftjs/core';
import { type Channel, type PortLike, type Shared, connect, fromMessagePort } from '@aweftjs/sync';
import { type FollowHandlers, type Loader, type ModuleExports, type Source, createLoader, follow, fromBundle, fromDocument } from '@aweftjs/modules';

import { createBridge } from './calls.ts';
import { type Report, type RoomDocument, sandboxError } from './contract.ts';
import { decode } from './data.ts';
import { forwardConsole, forwardErrors } from './report.ts';
import { ROUTE, type RouteDocument } from './route.ts';
import { methodsOf, stubFor } from './stubs.ts';

export type { Report } from './contract.ts';
export type { RouteDocument } from './route.ts';

/** What the far end may be told about the realm it runs in. */
export interface InsideOptions {
	/**
	 * What this realm forwards to the host as data (design 283): its uncaught errors and
	 * unhandled rejections, and the console levels the host named. Nothing when left off.
	 */
	readonly forward?: { readonly errors?: boolean; readonly console?: boolean } | undefined;
}

/** The room, as the code inside it holds it. */
export interface Room {
	/** Unload everything, dependents first, and close the link. */
	stop(): Promise<void>;
}

/** The far end once the host's documents have arrived, before it has a loader. */
export interface Entered {
	/** Where the loader's modules come from: granted names, the module document, the bundle, in that order. */
	readonly sources: readonly Source[];
	/** The loader's props, as the host wrote them. */
	readonly props: Readonly<Record<string, unknown>>;
	/** The act the room shows, or null in a compute room. */
	readonly page: { readonly act: string } | null;
	/** The route document the tail crosses on (design 282), or null in a compute room. */
	readonly route: RouteDocument | null;
	/**
	 * The document the host shared under a name (design 281). One handle per name for the
	 * room's life, so two askers hold one object.
	 *
	 * Throws: a `SandboxError` with reason `not-shared`, at once, for a name the host did not
	 * share.
	 */
	share<T extends object>(name: string): Shared<T>;
	/**
	 * Ask the host by name. Answered by the host's client when the name is granted, and
	 * rejected with `refused` otherwise; a refusal from further away crosses with its own
	 * reason and message.
	 */
	ask(name: string, args?: unknown): Promise<unknown>;
	/** The host client's status, mirrored; `closed` when the host has none. Read-only. */
	readonly status: Derived<string>;
	/**
	 * Take the loader, answer the host's calls against it, and hand back the room. `handlers`
	 * hear what `follow` applied, beside the host, so the realm that holds a page can rebuild
	 * the act on screen (design 280).
	 */
	serve(loader: Loader, handlers?: FollowHandlers): Room;
}

const namesOf = (value: unknown, what: string): string[] => {
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
		throw sandboxError('malformed', `${what} is not a list of names`, 'Check that the host runs the same version of this package as the room.');
	}
	return value as string[];
};

/**
 * Connect the far end of a room to the host and wait for its documents.
 *
 * Params:
 *   channel: the room's end of the channel the runner made
 *   options.forward: what this realm forwards to the host; nothing when left off
 *
 * Returns: what a loader is built from, the host's shared documents by name, the way to ask
 * the host, and `serve`, which takes the loader and answers the host's calls against it.
 * Rejects if the link ends first.
 *
 * Throws: a `SandboxError` with reason `malformed` when the host's documents are not what
 * this version of the package writes, which is what a host and a room on different versions
 * look like from in here.
 *
 * Example, in a room with a page in it:
 *   const entered = await enter(fromMessagePort(port), { forward: { errors: true, console: true } });
 *   const loader = createLoader({ sources: entered.sources, props: { client } });
 *   const room = entered.serve(loader);
 */
export const enter = async (channel: Channel, options: InsideOptions = {}): Promise<Entered> => {
	const link = connect(channel);
	const [modules, room, calls] = await Promise.all([
		link.share<Record<string, unknown>>('modules').ready,
		link.share<RoomDocument>('room').ready,
		link.share<Record<string, unknown>>('calls').ready,
	]);

	const props = decode(room.props, 'props');
	if (props === null || typeof props !== 'object' || Array.isArray(props)) {
		throw sandboxError('malformed', 'props is not an object', 'Pass props to createSandbox as a plain object.');
	}
	const page = room.page === null || room.page === undefined ? null : { act: String(room.page.act) };
	const route = page === null ? null : await link.share<RouteDocument>(ROUTE).ready;

	// The loader arrives with `serve`. A call the host writes before then waits for it rather
	// than failing, which is how the first `load` reaches a room that was still starting.
	let handLoader: (loader: Loader) => void = () => {};
	const loaderReady = new Promise<Loader>((settle) => { handLoader = settle; });

	const bridge = createBridge(calls, 'room', async (to, method, args) => {
		const loader = await loaderReady;
		if (to === 'sandbox') {
			if (method === 'load') {
				const out = await loader.load(namesOf(args[0], 'names'));
				const table: Record<string, string[]> = {};
				for (const [name, instance] of Object.entries(out)) table[name] = methodsOf(instance);
				return table;
			}
			if (method === 'unload') return await loader.unload(String(args[0]));
			if (method === 'loaded') return [...loader.loaded()];
			throw sandboxError('missing', `the room has no ${method}`, 'Call one of the three the room answers: load, unload and loaded.');
		}
		const instance = loader.get(to);
		if (instance === undefined) {
			throw sandboxError('missing', `${to} is not loaded in this room`, 'Load the module in the room before calling it.');
		}
		const fn: unknown = (instance as Record<string, unknown>)[method];
		if (typeof fn !== 'function') {
			throw sandboxError('missing', `${to} has no function ${method}`, 'Call a function the loaded module has.');
		}
		return await (fn as (...a: unknown[]) => unknown).apply(instance, [...args]);
	});
	// When the transport reports its end (a socket, a process pipe), an ask still waiting rejects
	// with `closed` rather than never. A MessagePort reports no close, so a frame the page removes
	// is simply gone, with whatever it was waiting on.
	channel.closed(() => { bridge.stop(); });

	// A granted name is a module whose one export is a stub. Listed ahead of the module
	// document, so a module of the same name in the document cannot shadow it (design 067).
	const grants: Source = {
		candidates: async () => [...room.grants]
			.filter((name) => typeof room.exposed[name] === 'string')
			.map((name) => ({
				name,
				exports: async () => {
					const methods = namesOf(decode(room.exposed[name], `exposed ${name}`), `exposed ${name}`);
					const stub = stubFor(methods, (method, args) => bridge.call(name, method, args));
					return { default: () => stub };
				},
			})),
	};

	// Each room compiles its sources apart from every other room's. The runtime caches a data
	// URL module by its text, so without this two rooms in one process loading one source would
	// share that module's state, and a room is a room.
	const salt = encodeURIComponent(`\n// room ${textIdOf(room)}`);
	const compile = async (source: string): Promise<ModuleExports> =>
		await import(`data:text/javascript,${encodeURIComponent(source)}${salt}`) as ModuleExports;

	const sources: Source[] = [grants, fromDocument(modules, { compile })];
	if (typeof room.bundle === 'string') {
		const imported = await import(room.bundle) as { default?: unknown };
		sources.push(fromBundle((imported.default ?? imported) as Parameters<typeof fromBundle>[0]));
	}

	// Reports are one call per tick, not one per line: a module that logs in a loop would
	// otherwise write a row per line, and the host walks every open row on every commit. A
	// microtask rather than a timer, so a synchronous burst is one row and a hidden page's
	// throttled timers never hold an error back.
	let queued: Report[] = [];
	const flush = (): void => {
		const batch = queued;
		queued = [];
		bridge.call('host', 'report', [batch]).catch(() => {});
	};
	const report = (entry: Report): void => {
		if (queued.length === 0) queueMicrotask(flush);
		queued.push(entry);
	};
	const moduleNow = (): string | undefined => page?.act;
	const stopErrors = options.forward?.errors === true ? forwardErrors(report, moduleNow) : () => {};
	const stopConsole = options.forward?.console === true ? forwardConsole([...room.console], report, moduleNow) : () => {};

	const shared = new Map<string, Shared<object>>();
	const share = <T extends object>(name: string): Shared<T> => {
		if (!room.documents.includes(name)) {
			throw sandboxError('not-shared', `the host did not share a document named ${name}`, 'Name the document in documents on Room, or in documents to createSandbox.');
		}
		let held = shared.get(name);
		if (held === undefined) shared.set(name, held = link.share<object>(name));
		return held as Shared<T>;
	};

	const status = immutable(observer(room).path('status').map((value) => String(value)));

	const serve = (loader: Loader, handlers: FollowHandlers = {}): Room => {
		handLoader(loader);

		// Opt-in, as in modules. What it reports goes to the host as calls, and only data crosses.
		const stopFollow = room.follow === true
			? follow(loader, modules, {
				applied: (name, action) => {
					bridge.call('host', 'applied', [name, action]).catch(() => {});
					handlers.applied?.(name, action);
				},
				failed: (name, error) => {
					const message = String((error as { message?: unknown } | null)?.message ?? error);
					bridge.call('host', 'failed', [name, message]).catch(() => {});
					handlers.failed?.(name, error);
				},
			})
			: () => {};

		let over = false;
		return {
			stop: async () => {
				if (over) return;
				over = true;
				stopFollow();
				stopErrors();
				stopConsole();
				bridge.stop();
				for (const name of [...loader.loaded()].reverse()) {
					try {
						await loader.unload(name);
					} catch {
						// A module's stop that throws is that module's own error; the room still stops.
					}
				}
				link.close();
			},
		};
	};

	return {
		sources, props: props as Record<string, unknown>, page, route,
		share, ask: (name, args) => bridge.call('host', 'ask', args === undefined ? [name] : [name, args]), status, serve,
	};
};

/**
 * Run the far end of a room over a channel to the host: `enter`, a loader over what it found,
 * and `serve`.
 *
 * Params:
 *   channel: the room's end of the channel the runner made
 *   options.forward: what this realm forwards to the host; nothing when left off
 *
 * Returns: the room, once the host's documents have arrived. Rejects if the link ends first.
 *
 * Throws: a `SandboxError` with reason `malformed` when the host's documents are not what this
 * version of the package writes, which is what a host and a room on different versions look
 * like from in here.
 *
 * Example, in a child process the `child` runner spawned:
 *   const room = await inside(fromIpc(process), { forward: { console: true } });
 */
export const inside = async (channel: Channel, options: InsideOptions = {}): Promise<Room> => {
	const entered = await enter(channel, options);
	return entered.serve(createLoader({ sources: entered.sources, props: entered.props }));
};

/**
 * The same, over a `MessagePort`: what a frame calls with the port the host posted to it. A
 * frame forwards its uncaught errors, unhandled rejections and the named console levels.
 *
 * Example, in the frame's own script:
 *   addEventListener('message', (event) => { insidePort(event.ports[0]); });
 */
export const insidePort = (port: PortLike): Promise<Room> =>
	inside(fromMessagePort(port), { forward: { errors: true, console: true } });
