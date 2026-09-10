// The server: builds its loader, loads what the sources list, accepts what the listener hands
// it, asks the gate, and does what the gate said (designs 071, 072, 240, 241).

import { createLoader } from '@aweftjs/modules';
import type { Loader } from '@aweftjs/modules';
import type { SocketLike } from '@aweftjs/sync';

import { openConnection, type Live } from './connection.ts';
import {
	type Accept, type Gate, type Identified, type ListenerHandlers, type Peer, type Server,
	type ServerHandlers, type ServerOptions, serverError,
} from './contract.ts';
import { fallthrough } from './request.ts';
import { routeKey, routeTable } from './routes.ts';

const json = (status: number, body: unknown): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const empty = (status: number): Response => new Response(null, { status });

/** A loaded instance is a gate when it carries the two functions, and nothing else is asked of it. */
const isGate = (instance: unknown): instance is Gate =>
	instance !== null && typeof instance === 'object'
	&& typeof (instance as Gate).identify === 'function' && typeof (instance as Gate).access === 'function';

/**
 * Make a server.
 *
 * Params:
 *   options.sources: where the modules come from; `start` loads every module every source lists
 *   options.store: the application's store, handed to every factory as `store`; nothing else is
 *   options.gate: who may reach what; a `Gate`, or the name of a module that is one. `open` is
 *     the trusted case, and there is no default
 *   options.listener: where connections and requests come from; `node()` ships
 *   options.handlers.failed: where a hook, a route or the gate that threw is reported
 *
 * Returns: `start`, `stop`, and the `loader` this server built. Nothing is loaded and nothing
 * listens until `start`.
 *
 * Throws: a `ServerError` with reason `missing` when `sources`, `gate` or `listener` is absent,
 * so a JavaScript caller cannot start a server with no gate by leaving the field out, or when
 * `gate` is neither a name nor an object carrying `identify` and `access`; and `not-an-option`
 * when `loader` or `props` is present, because this builds its own.
 *
 * Example:
 *   const server = createServer({
 *     sources: [fromDirectory('./modules'), auth],
 *     store,
 *     gate: 'auth/Gate',
 *     listener: node({ port: 8080 }),
 *   });
 *   await server.start();
 */
export const createServer = (options: ServerOptions): Server => {
	const { sources, gate, listener, handlers = {} } = options;
	for (const [what, value] of [['sources', sources], ['gate', gate], ['listener', listener]] as const) {
		if (value === undefined || value === null) {
			throw serverError('missing', `createServer needs ${what}; there is no default`, 'Pass all three: createServer({ sources, gate, listener }).');
		}
	}
	// On the key being present, not on its value: `props: undefined` written out is the same
	// idea as `props: {}`, and both are the habit this shape exists to remove (design 240).
	for (const what of ['loader', 'props'] as const) {
		if (what in options) {
			throw serverError(
				'not-an-option', `createServer builds its own loader, so ${what} is not one of its options`,
				'Pass sources, and make anything you would have passed as a prop a module that others deps on.',
			);
		}
	}
	// A gate that is not a name is checked here rather than at the first request: a value with
	// no `identify` and no `access` booted fine and then turned every call into a 500.
	if (typeof gate !== 'string' && !isGate(gate)) {
		throw serverError(
			'missing', `gate is ${typeof gate === 'object' ? 'an object' : typeof gate} with no identify and no access`,
			'Pass an object with identify and access, open, or the name of a module that is one.',
		);
	}
	const loader: Loader = createLoader(
		options.store === undefined ? { sources } : { sources, props: { store: options.store } },
	);
	const live = new Set<Live>();
	let started = false;

	const report = reporter(handlers);

	// A named gate is one of the modules the sources list, so it exists only once `start` has
	// run the factories (design 241), and it is read off the loader at every use, the way the
	// route table is: a gate module reloaded through `follow` is the policy from then on.
	const asked = (): Gate => {
		if (typeof gate !== 'string') return gate;
		const instance = loader.get(gate);
		if (isGate(instance)) return instance;
		throw serverError(
			'missing', `gate: ${JSON.stringify(gate)} is not a loaded module with identify and access`,
			'Name a module the sources list whose instance is a gate, or pass a Gate object.',
		);
	};

	// What a connection holds instead of an instance, so its checks follow a reload too.
	const perUse: Gate = {
		identify: (request, from) => asked().identify(request, from),
		access: (module, context) => asked().access(module, context),
	};

	const handlersFor = (): ListenerHandlers => {
		const identify = async (request: Request, peer: Peer): Promise<Identified<unknown> | Response> => {
			try {
				return await asked().identify(request, peer);
			} catch (error) {
				report('gate', error);
				return empty(500);
			}
		};

		const onRequest = async (request: Request, peer: Peer): Promise<Response> => {
			const who = await identify(request, peer);
			if (who instanceof Response) return who;
			if ('refused' in who) return json(401, { reasons: who.refused });

			let owned;
			try {
				owned = routeTable(loader).get(routeKey(request));
			} catch (error) {
				report('routes', error);
				return empty(500);
			}
			if (owned === undefined) {
				const fell = await fallthrough({ request, context: who.context, loader, gate: perUse, report });
				if (fell.answer !== undefined) return fell.answer;
				if (fell.failed === true) return empty(500);
				// The 403 at the end keeps a private site from reading as an empty one (design 248).
				return fell.refused === undefined ? empty(404) : json(403, { reasons: fell.refused });
			}

			let settled: Gate;
			try {
				settled = asked();
			} catch (error) {
				// The window where a named gate is being reloaded and nothing is loaded under it.
				report('gate', error);
				return empty(500);
			}

			try {
				const reasons = await settled.access({ name: owned.name, instance: owned.instance }, who.context);
				if (reasons.length > 0) return json(403, { reasons });
				const answer: unknown = await owned.route(request, who.context);
				if (answer instanceof Response) return answer;
				// A route that answered with something else is the module's defect, and it is reported
				// like a throw rather than turned into a bare 500 nobody hears about.
				throw serverError(
					'not-a-response', `${owned.name} answered ${routeKey(request)} with something that is not a Response`,
					'Return a Response from the route.',
				);
			} catch (error) {
				report(owned.name, error);
				return empty(500);
			}
		};

		const onSocket = async (request: Request, peer: Peer): Promise<Response | Accept> => {
			const who = await identify(request, peer);
			if (who instanceof Response) return who;
			if ('refused' in who) return json(401, { reasons: who.refused });
			return (socket: SocketLike): void => {
				const connection = openConnection({ socket, request, context: who.context, loader, gate: perUse, report });
				live.add(connection);
				void connection.ended.then(() => { live.delete(connection); });
			};
		};

		return { request: onRequest, socket: onSocket };
	};

	/** Every name every source lists. Listing evaluates nothing; `load` is what runs the factories. */
	const listed = async (): Promise<string[]> => {
		const names: string[] = [];
		for (const source of sources) for (const candidate of await source.candidates()) names.push(candidate.name);
		return names;
	};

	return {
		loader,
		start: async () => {
			if (started) throw serverError('started', 'this server is already started', 'Call stop before starting it again.');
			// Before the first await, so two starts in flight at once boot one server rather than
			// running the listener twice over one set of instances.
			started = true;
			try {
				// A failure here is the loader's, and reaches the caller as the ModulesError it is,
				// naming the module (design 240). Whatever was made stays loaded, and `stop` lets go.
				await loader.load(await listed());
				asked();
				routeTable(loader);
				await listener.start(handlersFor());
			} catch (error) {
				started = false;
				throw error;
			}
		},
		stop: async () => {
			for (const connection of [...live]) connection.close();
			await Promise.all([...live].map((connection) => connection.ended));
			await listener.stop();
			// Reverse of the order the factories finished, which is a dependency order, so a
			// module stops before the modules it depends on. `unload` runs each module's `stop`.
			for (const name of [...loader.loaded()].reverse()) {
				try {
					await loader.unload(name);
				} catch (error) {
					// One module's `stop` throwing must not strand the modules underneath it, which
					// are the ones it depends on and the ones with sockets and files to let go of.
					report(name, error);
				}
			}
			started = false;
		},
	};
};

const reporter = (handlers: ServerHandlers) => (name: string, error: unknown): void => {
	// Without a handler the error is thrown from a fresh microtask, where nothing catches it
	// and the process reports it as uncaught. A handler that throws is treated the same way.
	const raise = (thrown: unknown): void => queueMicrotask(() => { throw thrown; });
	if (handlers.failed === undefined) { raise(error); return; }
	try {
		handlers.failed(name, error);
	} catch (thrown) {
		raise(thrown);
	}
};
