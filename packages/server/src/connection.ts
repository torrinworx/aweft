// One connection: one socket, a link on its binary messages, requests on its text, and the
// modules' `connection` hooks behind the gate (designs 071, 072, 073).

import { codecError } from '@aweftjs/codec';
import type { Loader } from '@aweftjs/modules';
import { connect, fromWebSocket, requests } from '@aweftjs/sync';
import type { SocketLike } from '@aweftjs/sync';

import { type Connection, type Ending, type Gate, type GatedLink, type ServerModule, serverError } from './contract.ts';

export interface Live {
	/** End the connection. */
	close(): void;
	/** Settles once the socket has ended and every end function has run. */
	readonly ended: Promise<void>;
}

interface Wiring {
	readonly socket: SocketLike;
	readonly request: Request;
	readonly context: unknown;
	readonly loader: Loader;
	readonly gate: Gate;
	readonly report: (name: string, error: unknown) => void;
}

type Hook = NonNullable<ServerModule['connection']>;
type Call = NonNullable<ServerModule['call']>;

const hookOf = (instance: unknown): Hook | undefined => {
	if (instance === null || typeof instance !== 'object') return undefined;
	const hook: unknown = (instance as ServerModule).connection;
	return typeof hook === 'function' ? hook as Hook : undefined;
};

const callOf = (instance: unknown): Call | undefined => {
	if (instance === null || typeof instance !== 'object') return undefined;
	const call: unknown = (instance as ServerModule).call;
	return typeof call === 'function' ? call as Call : undefined;
};

/** What an `ask` is refused or fails with; the reason and reasons cross to the asker. */
const asking = (reason: string, detail: string, fix: string, reasons?: readonly unknown[]): Error =>
	reasons === undefined ? codecError(reason, detail, fix) : Object.assign(codecError(reason, detail, fix), { reasons });

export const openConnection = ({ socket, request, context, loader, gate, report }: Wiring): Live => {
	const channel = fromWebSocket(socket);
	const link = connect(channel);
	const asks = requests(socket);
	const ends: Array<{ readonly name: string; readonly end: () => unknown }> = [];
	let over = false;

	const close = (): void => { socket.close(); };

	const gated: GatedLink = {
		share: (name, document, handlers) => {
			if (typeof handlers?.accept !== 'function') {
				throw serverError(
					'no-accept', `${name}: a share on a connection says who may write; pass open for the trusted case`,
					'Pass accept in the share handlers, or open for the trusted case.',
				);
			}
			return link.share(name, document, handlers);
		},
	};

	// The end functions run in reverse, so a module's runs before its dependencies'. One that
	// throws is reported and the rest still run.
	const runEnd = (name: string, end: () => unknown): void => {
		try {
			const outcome = end();
			if (outcome instanceof Promise) outcome.catch((error: unknown) => report(name, error));
		} catch (error) {
			report(name, error);
		}
	};

	// A call is answered once the hooks have run, so a module that sets connection state up in
	// `connection` finds it in `call`. The client's first ask can be on the wire before the
	// handshake's hooks have finished.
	let hooked: () => void = () => {};
	const ready = new Promise<void>((done) => { hooked = done; });

	asks.answer(async (name, args, progress) => {
		await ready;
		if (over) throw asking('closed', 'the connection has ended', 'Open a new connection and ask again.');
		const instance = loader.get(name);
		const call = callOf(instance);
		if (call === undefined) throw asking('missing', `${name} is not loaded or has no call`, 'Load the module, and give it a call function.');
		const reasons = await gate.access({ name, instance }, context);
		if (reasons.length > 0) throw asking('refused', `${name} refused the call`, 'Sign in, or ask for something the gate allows.', reasons);
		return await call.call(instance, args, context, { progress });
	});

	// The connection is over when its link is over. The socket closing ends the link, and a
	// link that ended on bytes it could not read closes the socket itself (the adapter's rule),
	// so the other end never goes on asking a connection that answers nothing.
	const ended = new Promise<void>((done) => {
		channel.closed(() => {
			over = true;
			asks.stop();
			for (const { name, end } of ends.splice(0).reverse()) runEnd(name, end);
			done();
		});
	});

	// Hooks in load order, for the modules the gate allows. A hook that throws ends the
	// connection: a connection half set up is the state nothing else can reason about.
	void (async () => {
		try {
			for (const name of loader.loaded()) {
				if (over) return;
				const instance = loader.get(name);
				const hook = hookOf(instance);
				if (hook === undefined) continue;
				let ending: Ending;
				try {
					const reasons = await gate.access({ name, instance }, context);
					if (reasons.length > 0) continue;
					if (over) return;
					const connection: Connection = { link: gated, request, context, close };
					ending = await hook.call(instance, connection);
				} catch (error) {
					report(name, error);
					close();
					return;
				}
				if (typeof ending !== 'function') continue;
				if (over) runEnd(name, ending);
				else ends.push({ name, end: ending });
			}
		} finally {
			hooked();
		}
	})();

	return { close, ended };
};
