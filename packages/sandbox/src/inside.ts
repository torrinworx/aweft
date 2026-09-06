// The far end: the room's own side of the window (design 066).
//
// The same file runs in a frame, a process, a container, or a test. It connects the link,
// waits for the three documents, runs an ordinary loader over the module document with the
// granted names ahead of it, and answers the host's calls. Nothing here knows what the room
// is or what is around it.

import { textIdOf } from '@aweftjs/core';
import { type Channel, type PortLike, connect, fromMessagePort } from '@aweftjs/sync';
import { type Loader, type ModuleExports, type Source, createLoader, follow, fromBundle, fromDocument } from '@aweftjs/modules';

import { type Bridge, createBridge } from './calls.ts';
import { type RoomDocument, sandboxError } from './contract.ts';
import { decode } from './data.ts';
import { methodsOf, stubFor } from './stubs.ts';

/** The room, as the code inside it holds it. */
export interface Room {
	/** Unload everything, dependents first, and close the link. */
	stop(): Promise<void>;
}

const namesOf = (value: unknown, what: string): string[] => {
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
		throw sandboxError('malformed', `${what} is not a list of names`, 'Check that the host runs the same version of this package as the room.');
	}
	return value as string[];
};

/**
 * Run the far end of a room over a channel to the host.
 *
 * Params:
 *   channel: the room's end of the channel the runner made
 *
 * Returns: the room, once the host's documents have arrived. Rejects if the link ends first.
 *
 * Throws: a `SandboxError` with reason `malformed` when the host's documents are not what this
 * version of the package writes, which is what a host and a room on different versions look
 * like from in here.
 *
 * Example, in a child process the `child` runner spawned:
 *   const room = await inside(fromIpc(process));
 */
export const inside = async (channel: Channel): Promise<Room> => {
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

	let bridge: Bridge;

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
	const loader: Loader = createLoader({ sources, props: props as Record<string, unknown> });

	bridge = createBridge(calls, 'room', async (to, method, args) => {
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

	// Opt-in, as in modules. What it reports goes to the host as calls, and only data crosses.
	const stopFollow = room.follow === true
		? follow(loader, modules, {
			applied: (name, action) => { bridge.call('host', 'applied', [name, action]).catch(() => {}); },
			failed: (name, error) => {
				const message = String((error as { message?: unknown } | null)?.message ?? error);
				bridge.call('host', 'failed', [name, message]).catch(() => {});
			},
		})
		: () => {};

	let over = false;
	return {
		stop: async () => {
			if (over) return;
			over = true;
			stopFollow();
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

/**
 * The same, over a `MessagePort`: what a frame calls with the port the host posted to it.
 *
 * Example, in the frame's own script:
 *   addEventListener('message', (event) => { insidePort(event.ports[0]); });
 */
export const insidePort = (port: PortLike): Promise<Room> => inside(fromMessagePort(port));
