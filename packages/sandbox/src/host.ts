// The host's side of the window (designs 066 to 068, 278 to 280).
//
// The host shares three documents into the room and refuses every commit the room makes to
// two of them; beside them it shares the documents the application named, and the route
// document when the room has a page. The grants are checked here, against the host's own
// list, on every call: a room's copy of the list is the room's to tamper with and decides
// nothing.

import { createArray, createObject, isObservable, kindOf } from '@aweftjs/core';
import { type ShareHandlers, connect } from '@aweftjs/sync';

import { createBridge } from './calls.ts';
import {
	type Report, type RoomDocument, type Sandbox, type SandboxOptions, type Stub, sandboxError,
} from './contract.ts';
import { encode } from './data.ts';
import { ROUTE, routeGuard } from './route.ts';
import { methodsOf, stubFor } from './stubs.ts';

// An answer from the room that is not the shape asked for is not the application's mistake.
const SAME_VERSION = 'Check that the room runs the same version of this package as the host.';

const READ_ONLY: ShareHandlers = {
	accept: () => [{ code: 'read-only', message: 'the room reads this document and does not write it' }],
};

/** The names the package's own topics take (design 066), which a document may not be shared under. */
const RESERVED: readonly string[] = ['modules', 'room', 'calls', ROUTE];

const DEFAULT_CONSOLE: readonly string[] = ['error', 'warn'];

const KINDS: readonly string[] = ['error', 'rejection', 'console'];

/** A report as the room sent it, or null when it is not one (design 280). */
const reportOf = (value: unknown): Report | null => {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const { kind, level, message, stack, module } = value as Record<string, unknown>;
	if (typeof kind !== 'string' || !KINDS.includes(kind)) return null;
	if (typeof message !== 'string' || typeof stack !== 'string') return null;
	if (kind === 'console' ? typeof level !== 'string' : level !== undefined) return null;
	if (module !== undefined && typeof module !== 'string') return null;
	const entry: Report = { kind: kind as Report['kind'], message, stack };
	return Object.assign(entry, level === undefined ? {} : { level }, module === undefined ? {} : { module });
};

/**
 * Make a room and the host's side of it.
 *
 * Params:
 *   options.runner: what makes the room; used by this sandbox alone
 *   options.modules: the module document the room loads from; the room never writes it
 *   options.grants: the names the room may reach, an observable array; change it any time
 *   options.props: plain data, spread into every factory's props inside the room
 *   options.bundle: a module specifier the room imports for a library bundle map
 *   options.follow: reload a module inside the room when its source changes; off by default
 *   options.handlers: where `follow`, errors and console lines report
 *   options.limits.callMs: how long a call into the room may wait; none by default
 *   options.documents: documents shared into the room under their keys, writable both ways
 *   options.console: the console levels the room forwards; `error` and `warn` by default
 *   options.client: what answers the room's asks on granted names; none refuses every ask
 *   options.page: the act the room shows and the route document its tail crosses on
 *
 * Returns: the sandbox, once the runner has made the room. `expose` names before `load`.
 *
 * Throws: a `SandboxError`. `malformed` when `modules` is not an observable object,
 * `grants` is not an observable array, a document or the route is not an observable, or
 * `page.act` is not a name; `reserved` when a document is named `modules`, `room`, `calls` or
 * `route`; and `not-data` when a prop is not plain data, with `path` naming it.
 *
 * Example:
 *   const grants = createArray(['files/Read']);
 *   const sandbox = await createSandbox({ runner: inProcess(), modules: plugins, grants });
 *   sandbox.expose('files/Read', { read: (path) => allowed(path) });
 *   const { 'report/Summarize': summarize } = await sandbox.load(['report/Summarize']);
 */
export const createSandbox = async (options: SandboxOptions): Promise<Sandbox> => {
	const { runner, modules, grants, handlers = {}, limits = {}, documents = {}, client, page } = options;
	if (!isObservable(modules) || kindOf(modules) !== 'object') {
		throw sandboxError('malformed', 'modules must be an observable object from createObject', 'Build the module document with createObject from @aweftjs/core.');
	}
	if (!isObservable(grants) || kindOf(grants) !== 'array') {
		throw sandboxError('malformed', 'grants must be an observable array from createArray', 'Build the grants with createArray from @aweftjs/core.');
	}
	for (const [name, document] of Object.entries(documents)) {
		if (RESERVED.includes(name)) {
			throw sandboxError('reserved', `${name} is one of the room's own topics and cannot be shared under`, 'Share the document under another name; modules, room, calls and route are the room\'s own.');
		}
		if (!isObservable(document)) {
			throw sandboxError('malformed', `documents.${name} is not an observable`, 'Build each document in documents with createObject, createArray or createMap from @aweftjs/core.');
		}
	}
	if (page !== undefined) {
		if (typeof page.act !== 'string') {
			throw sandboxError('malformed', 'page.act is not a module name', 'Name the act the room shows as a string, the way an acts map names a module.');
		}
		if (!isObservable(page.route) || kindOf(page.route) !== 'object') {
			throw sandboxError('malformed', 'page.route is not an observable object', 'Build the route document with createObject from @aweftjs/core, holding url, key, move and seq.');
		}
	}

	const exposed = new Map<string, object>();
	const room = createObject<RoomDocument>({
		props: encode(options.props ?? {}, 'props'),
		grants,
		bundle: options.bundle ?? null,
		follow: options.follow === true,
		exposed: createObject<Record<string, string>>({}),
		documents: createArray<string>(Object.keys(documents)),
		console: createArray<string>(options.console ?? DEFAULT_CONSOLE),
		status: 'closed',
		page: page === undefined ? null : createObject<{ act: string }>({ act: page.act }),
	});
	const calls = createObject<Record<string, unknown>>({});

	// The mirror is written before the room starts, so the far end reads a status on arrival.
	const stopStatus = client === undefined
		? () => {}
		: client.status.effect((status) => { room.status = String(status); });

	let channel: Awaited<ReturnType<typeof runner.start>>;
	try {
		channel = await runner.start();
	} catch (error) {
		stopStatus();
		throw error;
	}
	const link = connect(channel);
	link.share('modules', modules, READ_ONLY);
	link.share('room', room, READ_ONLY);
	link.share('calls', calls);
	for (const [name, document] of Object.entries(documents)) link.share(name, document);
	if (page !== undefined) link.share(ROUTE, page.route, routeGuard);

	/** Hand a report to its handler; a handler that throws costs the room nothing. */
	const handle = (entry: Report): void => {
		try {
			if (entry.kind === 'console') handlers.console?.(entry.level!, entry.message, entry.stack);
			else handlers.error?.(entry);
		} catch {
			// The host's own handler failed, and the room is not the one to hear about it.
		}
	};

	const bridge = createBridge(calls, 'host', async (to, method, args) => {
		if (to === 'host') {
			if (method === 'applied') {
				const action = args[1] === 'unloaded' ? 'unloaded' : 'reloaded';
				handlers.applied?.(String(args[0]), action);
				return null;
			}
			if (method === 'failed') {
				handlers.failed?.(String(args[0]), String(args[1]));
				return null;
			}
			if (method === 'ask') {
				const name = String(args[0]);
				if (!grants.includes(name)) {
					throw sandboxError('refused', `${name} is not granted to this room`, 'Add the name to the sandbox grants, or call it from the host instead.');
				}
				if (client === undefined) {
					throw sandboxError('refused', `${name} is granted but the host has no client to ask`, 'Pass client to createSandbox, or client to Room, so the room\'s asks have somewhere to go.');
				}
				return await client.ask(name, args[1]);
			}
			if (method === 'report') {
				// One call carries the tick's reports (design 280). Each is handed on in order, and
				// one that is not a report is dropped without costing the ones beside it.
				if (!Array.isArray(args[0])) return null;
				for (const item of args[0] as unknown[]) {
					const entry = reportOf(item);
					if (entry !== null) handle(entry);
				}
				return null;
			}
			throw sandboxError('missing', `the host has no ${method}`, 'Call one of the four the host answers: applied, failed, ask and report.');
		}
		if (!grants.includes(to)) {
			throw sandboxError('refused', `${to} is not granted to this room`, 'Add the name to the sandbox grants, or call it from the host instead.');
		}
		const instance = exposed.get(to);
		if (instance === undefined) {
			throw sandboxError('missing', `${to} is granted but nothing is exposed under it`, 'Expose the name on the host with sandbox.expose first.');
		}
		const fn: unknown = (instance as Record<string, unknown>)[method];
		if (typeof fn !== 'function') {
			throw sandboxError('missing', `${to} has no function ${method}`, 'Call a function the exposed instance has.');
		}
		return await (fn as (...a: unknown[]) => unknown).apply(instance, [...args]);
	}, { callMs: limits.callMs });
	// The room went away, or the transport did: every call still waiting rejects with `closed`
	// rather than waiting for an answer that cannot come.
	channel.closed(() => { bridge.stop(); });

	const stubsOf = (table: unknown): Readonly<Record<string, Stub>> => {
		if (table === null || typeof table !== 'object' || Array.isArray(table)) {
			throw sandboxError('malformed', 'the room answered load with something that is not a table', SAME_VERSION);
		}
		const stubs: Record<string, Stub> = {};
		for (const [name, methods] of Object.entries(table as Record<string, unknown>)) {
			if (!Array.isArray(methods) || methods.some((m) => typeof m !== 'string')) {
				throw sandboxError('malformed', `the room answered load with no function list for ${name}`, SAME_VERSION);
			}
			stubs[name] = stubFor(methods as string[], (method, args) => bridge.call(name, method, args));
		}
		return stubs;
	};

	let over = false;
	return {
		load: async (names) => stubsOf(await bridge.call('sandbox', 'load', [[...names]])),
		unload: async (name) => (await bridge.call('sandbox', 'unload', [name])) === true,
		loaded: async () => {
			const names = await bridge.call('sandbox', 'loaded', []);
			if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) {
				throw sandboxError('malformed', 'the room answered loaded with something that is not a list of names', SAME_VERSION);
			}
			return names as string[];
		},
		expose: (name, instance) => {
			exposed.set(name, instance);
			room.exposed[name] = JSON.stringify(methodsOf(instance));
			return () => {
				if (exposed.get(name) !== instance) return;
				exposed.delete(name);
				delete room.exposed[name];
			};
		},
		stop: async () => {
			if (over) return;
			over = true;
			stopStatus();
			bridge.stop();
			link.close();
			await runner.stop();
		},
	};
};
