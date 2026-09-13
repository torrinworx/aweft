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
import { type Sliding, sliding } from './limits.ts';
import { type Origins, originRefusal } from './origin.ts';
import { fallthrough } from './request.ts';
import { type Emit, emitter } from './observe.ts';
import { routeKey, routeTable } from './routes.ts';

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// The values every server starts with (design 272). Each is one option away from another.
const REQUESTS = { count: 600, windowMs: 60_000 };

// Every answer says its type is its type (design 276), unless the module already said so. A
// redirect's headers cannot be written, so it is rebuilt with the header; a network error has
// no headers to carry and is answered as it is.
const nosniff = (response: Response): Response => {
	if (response.headers.has('x-content-type-options')) return response;
	try {
		response.headers.set('x-content-type-options', 'nosniff');
		return response;
	} catch {
		if (response.type === 'error') return response;
		const headers = new Headers(response.headers);
		headers.set('x-content-type-options', 'nosniff');
		return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
	}
};

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
 *   options.limits.requests: how many requests one address may make in a window, before the
 *     gate; 600 a minute here, `false` for none
 *   options.origins: where a browser may send a state-changing request or a handshake from;
 *     the request's own host here, a list of origins to add, or `'any'`
 *
 * Returns: `start`, `stop`, and the `loader` this server built. Nothing is loaded and nothing
 * listens until `start`.
 *
 * Throws: a `ServerError` with reason `missing` when `sources`, `gate` or `listener` is absent,
 * so a JavaScript caller cannot start a server with no gate by leaving the field out, or when
 * `gate` is neither a name nor an object carrying `identify` and `access`; `not-an-option`
 * when `loader` or `props` is present, because this builds its own; and `invalid-limit` when
 * `limits.requests` is not `{ count, windowMs }` of positive numbers or `false`.
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

	// Checked before the gate, so a refused request costs no gate work (design 272). The count is
	// made here so a bad number is refused at construction rather than at the first request.
	const requested = options.limits?.requests;
	const requests: Sliding | undefined = requested === false ? undefined : sliding(requested ?? REQUESTS);
	const origins: Origins = options.origins ?? [];
	const before = (request: Request, peer: Peer, handshake: boolean): Response | undefined => {
		if (requests !== undefined) {
			// A listener that knows no address counts everything it delivers as one.
			const taken = requests.take(peer.address ?? 'unknown');
			if (!taken.ok) {
				return json(429, { reasons: [{ code: 'limit', message: `${peer.address ?? 'this address'} has made more requests than the window allows` }] }, {
					'retry-after': String(taken.retryAfter),
				});
			}
		}
		const refused = originRefusal(request, handshake, origins);
		return refused === undefined ? undefined : json(403, { reasons: [refused] });
	};

	// An observer's own throw is reported and never emitted, so the two reporters differ by
	// that one line (design 260).
	const observed = reporter(handlers);
	const emit: Emit = emitter(loader, observed);
	const report = (name: string, error: unknown, context?: unknown, soft = false): void => {
		observed(name, error, soft);
		emit({ kind: 'failed', at: Date.now(), name, error }, context);
	};

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

		/** The answer, with who asked and which module answered, for the event that follows it. */
		interface Answered {
			readonly response: Response;
			readonly context?: unknown;
			readonly name?: string;
		}

		const answerRequest = async (request: Request, peer: Peer): Promise<Answered> => {
			const early = before(request, peer, false);
			if (early !== undefined) return { response: early };
			const who = await identify(request, peer);
			if (who instanceof Response) return { response: who };
			if ('refused' in who) return { response: json(401, { reasons: who.refused }) };
			const context = who.context;

			let owned;
			try {
				owned = routeTable(loader).get(routeKey(request));
			} catch (error) {
				report('routes', error, context);
				return { response: empty(500), context };
			}
			if (owned === undefined) {
				const fell = await fallthrough({ request, context, loader, gate: perUse, report });
				if (fell.answer !== undefined) return { response: fell.answer, context, ...(fell.name === undefined ? {} : { name: fell.name }) };
				if (fell.failed === true) return { response: empty(500), context };
				// The 403 at the end keeps a private site from reading as an empty one (design 248).
				return { response: fell.refused === undefined ? empty(404) : json(403, { reasons: fell.refused }), context };
			}

			let settled: Gate;
			try {
				settled = asked();
			} catch (error) {
				// The window where a named gate is being reloaded and nothing is loaded under it.
				report('gate', error, context);
				return { response: empty(500), context };
			}

			try {
				const reasons = await settled.access({ name: owned.name, instance: owned.instance }, context);
				if (reasons.length > 0) return { response: json(403, { reasons }), context };
				const answer: unknown = await owned.route(request, context);
				if (answer instanceof Response) return { response: answer, context, name: owned.name };
				// A route that answered with something else is the module's defect, and it is reported
				// like a throw rather than turned into a bare 500 nobody hears about.
				throw serverError(
					'not-a-response', `${owned.name} answered ${routeKey(request)} with something that is not a Response`,
					'Return a Response from the route.',
				);
			} catch (error) {
				report(owned.name, error, context);
				return { response: empty(500), context };
			}
		};

		const onRequest = async (request: Request, peer: Peer): Promise<Response> => {
			const at = Date.now();
			const { response, context, name } = await answerRequest(request, peer);
			const { method } = request;
			const path = new URL(request.url).pathname;
			emit({ kind: 'request', at, method, path, status: response.status, ms: Date.now() - at, ...(name === undefined ? {} : { name }) }, context);
			return nosniff(response);
		};

		const onSocket = async (request: Request, peer: Peer): Promise<Response | Accept> => {
			const early = before(request, peer, true);
			if (early !== undefined) return early;
			const who = await identify(request, peer);
			if (who instanceof Response) return who;
			if ('refused' in who) return json(401, { reasons: who.refused });
			return (socket: SocketLike): void => {
				const connection = openConnection({ socket, request, context: who.context, loader, gate: perUse, report, emit });
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

const reporter = (handlers: ServerHandlers) => (name: string, error: unknown, soft = false): void => {
	// Without a handler the error is thrown from a fresh microtask, where nothing catches it
	// and the process reports it as uncaught. A handler that throws is treated the same way.
	// A soft report is a call that threw: any client can reach a public call, and a bug in one
	// is written to the console rather than being a way to end the process (design 272).
	const raise = (thrown: unknown): void => queueMicrotask(() => { throw thrown; });
	if (handlers.failed === undefined) {
		if (soft) console.error(`${name}: a call threw`, error);
		else raise(error);
		return;
	}
	try {
		handlers.failed(name, error);
	} catch (thrown) {
		raise(thrown);
	}
};
