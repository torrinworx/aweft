// The host's side of the window (designs 066 to 068).
//
// The host shares three documents into the room and refuses every commit the room makes to
// two of them. The grants are checked here, against the host's own list, on every call: a
// room's copy of the list is the room's to tamper with and decides nothing.

import { createObject, isObservable, kindOf } from '@aweftjs/core';
import { type ShareHandlers, connect } from '@aweftjs/sync';

import { createBridge } from './calls.ts';
import { type RoomDocument, type Sandbox, type SandboxOptions, type Stub, sandboxError } from './contract.ts';
import { encode } from './data.ts';
import { methodsOf, stubFor } from './stubs.ts';

const READ_ONLY: ShareHandlers = {
	accept: () => [{ code: 'read-only', message: 'the room reads this document and does not write it' }],
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
 *   options.handlers: where `follow` reports
 *   options.limits.callMs: how long a call into the room may wait; none by default
 *
 * Returns: the sandbox, once the runner has made the room. `expose` names before `load`.
 *
 * Throws `not-data` when a prop is not plain data, naming it.
 *
 * Example:
 *   const grants = createArray(['files/Read']);
 *   const sandbox = await createSandbox({ runner: inProcess(), modules: plugins, grants });
 *   sandbox.expose('files/Read', { read: (path) => allowed(path) });
 *   const { 'report/Summarize': summarize } = await sandbox.load(['report/Summarize']);
 */
export const createSandbox = async (options: SandboxOptions): Promise<Sandbox> => {
	const { runner, modules, grants, handlers = {}, limits = {} } = options;
	if (!isObservable(modules) || kindOf(modules) !== 'object') {
		throw sandboxError('malformed', 'modules must be an observable object from createObject');
	}
	if (!isObservable(grants) || kindOf(grants) !== 'array') {
		throw sandboxError('malformed', 'grants must be an observable array from createArray');
	}

	const exposed = new Map<string, object>();
	const room = createObject<RoomDocument>({
		props: encode(options.props ?? {}, 'props'),
		grants,
		bundle: options.bundle ?? null,
		follow: options.follow === true,
		exposed: createObject<Record<string, string>>({}),
	});
	const calls = createObject<Record<string, unknown>>({});

	const channel = await runner.start();
	const link = connect(channel);
	link.share('modules', modules, READ_ONLY);
	link.share('room', room, READ_ONLY);
	link.share('calls', calls);

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
			throw sandboxError('missing', `the host has no ${method}`);
		}
		if (!grants.includes(to)) throw sandboxError('refused', `${to} is not granted to this room`);
		const instance = exposed.get(to);
		if (instance === undefined) throw sandboxError('missing', `${to} is granted but nothing is exposed under it`);
		const fn: unknown = (instance as Record<string, unknown>)[method];
		if (typeof fn !== 'function') throw sandboxError('missing', `${to} has no function ${method}`);
		return await (fn as (...a: unknown[]) => unknown).apply(instance, [...args]);
	}, { callMs: limits.callMs });
	// The room went away, or the transport did: every call still waiting rejects with `closed`
	// rather than waiting for an answer that cannot come.
	channel.closed(() => { bridge.stop(); });

	const stubsOf = (table: unknown): Readonly<Record<string, Stub>> => {
		if (table === null || typeof table !== 'object' || Array.isArray(table)) {
			throw sandboxError('malformed', 'the room answered load with something that is not a table');
		}
		const stubs: Record<string, Stub> = {};
		for (const [name, methods] of Object.entries(table as Record<string, unknown>)) {
			if (!Array.isArray(methods) || methods.some((m) => typeof m !== 'string')) {
				throw sandboxError('malformed', `the room answered load with no function list for ${name}`);
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
				throw sandboxError('malformed', 'the room answered loaded with something that is not a list of names');
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
			bridge.stop();
			link.close();
			await runner.stop();
		},
	};
};
