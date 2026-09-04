// The server: accepts what the listener hands it, asks the gate, and does what the gate said
// (designs 071, 072).

import type { SocketLike } from '@aweftjs/sync';

import { openConnection, type Live } from './connection.ts';
import {
	type Identified, type Peer, type Server, type ServerHandlers, type ServerOptions, serverError,
} from './contract.ts';
import { routeKey, routeTable } from './routes.ts';

const json = (status: number, body: unknown): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const empty = (status: number): Response => new Response(null, { status });

/**
 * Make a server.
 *
 * Params:
 *   options.loader: the modules, loaded by the application; the server loads none
 *   options.gate: who may reach what; required, and `open` is the trusted case
 *   options.listener: where connections and requests come from; `node()` ships
 *   options.handlers.failed: where a hook, a route or the gate that threw is reported
 *
 * Returns: `start` and `stop`. Nothing listens until `start`.
 *
 * Throws `missing` when one of the three is absent, so a JavaScript caller cannot start a
 * server with no gate by leaving the field out.
 *
 * Example:
 *   const loader = createLoader({ sources: [fromDirectory('./modules'), auth], props: { store } });
 *   const gate = (await loader.load(['auth/Gate']))['auth/Gate'] as Gate;
 *   const server = createServer({ loader, gate, listener: node({ port: 8080 }) });
 *   await server.start();
 */
export const createServer = (options: ServerOptions): Server => {
	const { loader, gate, listener, handlers = {} } = options;
	for (const [what, value] of [['loader', loader], ['gate', gate], ['listener', listener]] as const) {
		if (value === undefined || value === null) throw serverError('missing', `createServer needs a ${what}; there is no default`);
	}
	const live = new Set<Live>();
	let started = false;

	const report = reporter(handlers);

	const identify = async (request: Request, peer: Peer): Promise<Identified<unknown> | Response> => {
		try {
			return await gate.identify(request, peer);
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
		if (owned === undefined) return empty(404);

		try {
			const reasons = await gate.access({ name: owned.name, instance: owned.instance }, who.context);
			if (reasons.length > 0) return json(403, { reasons });
			const answer: unknown = await owned.route(request, who.context);
			if (answer instanceof Response) return answer;
			// A route that answered with something else is the module's defect, and it is reported
			// like a throw rather than turned into a bare 500 nobody hears about.
			throw serverError('not-a-response', `${owned.name} answered ${routeKey(request)} with something that is not a Response`);
		} catch (error) {
			report(owned.name, error);
			return empty(500);
		}
	};

	const onSocket = async (request: Request, peer: Peer) => {
		const who = await identify(request, peer);
		if (who instanceof Response) return who;
		if ('refused' in who) return json(401, { reasons: who.refused });
		return (socket: SocketLike): void => {
			const connection = openConnection({ socket, request, context: who.context, loader, gate, report });
			live.add(connection);
			void connection.ended.then(() => { live.delete(connection); });
		};
	};

	return {
		start: async () => {
			if (started) throw serverError('started', 'this server is already started');
			routeTable(loader);
			started = true;
			await listener.start({ request: onRequest, socket: onSocket });
		},
		stop: async () => {
			for (const connection of [...live]) connection.close();
			await Promise.all([...live].map((connection) => connection.ended));
			await listener.stop();
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
