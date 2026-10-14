// One connection: one socket, a link on its binary messages, requests on its text, and the
// modules' `connection` hooks behind the gate (designs 071, 072, 073).

import { codecError } from '@aweftjs/codec';
import type { Loader } from '@aweftjs/modules';
import { connect, fromWebSocket, requests } from '@aweftjs/sync';
import type { SocketLike, Unshared, WireReason } from '@aweftjs/sync';

import {
	type Connection, type Ending, type Gate, type GatedLink, type Offer, type Outcome, type ServerModule, serverError,
} from './contract.ts';
import type { Emit } from './observe.ts';

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
	readonly report: (name: string, error: unknown, context?: unknown, soft?: string) => void;
	readonly emit: Emit;
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

type Offering = NonNullable<ServerModule['offer']>;

const offerOf = (instance: unknown): Offering | undefined => {
	if (instance === null || typeof instance !== 'object') return undefined;
	const offer: unknown = (instance as ServerModule).offer;
	return typeof offer === 'function' ? offer as Offering : undefined;
};

// A fault carries a reason and a message, and the receiving end renders them as a refusal again.
// So a refusal in the stack's shape, `reason: detail. fix`, crosses as its detail alone, and the
// page does not read its reason twice.
const detailOf = (error: { reason: string; message?: unknown; fix?: unknown }): string => {
	const message = String(error.message ?? '');
	const head = `${error.reason}: `;
	const tail = typeof error.fix === 'string' ? `. ${error.fix}` : undefined;
	if (!message.startsWith(head) || tail === undefined || !message.endsWith(tail)) return message;
	return message.slice(head.length, message.length - tail.length);
};

/** What an `ask` is refused or fails with; the reason and reasons cross to the asker. */
const asking = (reason: string, detail: string, fix: string, reasons?: readonly unknown[]): Error =>
	reasons === undefined ? codecError(reason, detail, fix) : Object.assign(codecError(reason, detail, fix), { reasons });

/** Thrown on purpose, in the stack's shape: a reason a caller can branch on. */
const isRefusal = (error: unknown): boolean =>
	error !== null && typeof error === 'object' && typeof (error as { reason?: unknown }).reason === 'string';

export const openConnection = ({ socket, request, context, loader, gate, report, emit }: Wiring): Live => {
	const channel = fromWebSocket(socket);
	// Called once the frame that asked has arrived, which is after this function returned, so
	// `offering` below is defined by then.
	const link = connect(channel, { unshared: (request) => { void offering(request); } });
	const asks = requests(socket);
	const ends: Array<{ readonly name: string; readonly end: () => unknown }> = [];
	const opened = Date.now();
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
			// The module's rule, with the server told each time it refused (design 260). Sync reads
			// nothing back as accepted and a throw as a refusal, and both still mean that here.
			const accept = handlers.accept;
			return link.share(name, document, {
				...handlers,
				accept: (commit) => {
					let reasons: readonly WireReason[];
					try {
						reasons = accept(commit) ?? [];
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						emit({ kind: 'refused', at: Date.now(), topic: name, reasons: [{ code: 'accept-threw', message }] }, context);
						throw error;
					}
					if (reasons.length > 0) emit({ kind: 'refused', at: Date.now(), topic: name, reasons }, context);
					return reasons;
				},
			});
		},
	};

	// The end functions run in reverse, so a module's runs before its dependencies'. One that
	// throws is reported and the rest still run.
	const runEnd = (name: string, end: () => unknown): void => {
		try {
			const outcome = end();
			if (outcome instanceof Promise) outcome.catch((error: unknown) => report(name, error, context));
		} catch (error) {
			report(name, error, context);
		}
	};

	// A call is answered once the hooks have run, so a module that sets connection state up in
	// `connection` finds it in `call`. The client's first ask can be on the wire before the
	// handshake's hooks have finished.
	let hooked: () => void = () => {};
	const ready = new Promise<void>((done) => { hooked = done; });

	const answer = async (name: string, args: unknown, progress: (value: unknown) => void): Promise<unknown> => {
		if (over) throw asking('closed', 'the connection has ended', 'Open a new connection and ask again.');
		const instance = loader.get(name);
		const call = callOf(instance);
		if (call === undefined) throw asking('missing', `${name} is not loaded or has no call`, 'Load the module, and give it a call function.');
		const reasons = await gate.access({ name, instance }, context);
		if (reasons.length > 0) throw asking('refused', `${name} refused the call`, 'Sign in, or ask for something the gate allows.', reasons);
		return await call.call(instance, args, context, { progress });
	};

	asks.answer(async (name, args, progress) => {
		await ready;
		const at = Date.now();
		let outcome: Outcome;
		try {
			outcome = { result: await answer(name, args, progress) };
		} catch (error) {
			outcome = { error };
		}
		const instance = loader.get(name);
		emit({ kind: 'call', at, name, ...(instance === undefined ? {} : { instance }), args, outcome, ms: Date.now() - at }, context);
		if ('error' in outcome) {
			// A refusal was thrown for the caller and crosses whole. Anything else is the module's
			// own bug, whose message names things the caller has no business reading; the operator
			// hears it and the caller hears that it failed (design 272).
			if (isRefusal(outcome.error)) throw outcome.error;
			report(name, outcome.error, context, 'a call threw');
			throw asking('failed', 'the call failed', 'Read what handlers.failed was told under the module\'s name.');
		}
		return outcome.result;
	});

	// A page shared a name nothing here shares (design 310). The modules that declare `offer` are
	// asked in load order, behind the gate. They are asked after the `connection` hooks, so a hook
	// that shares the same name pairs with the page first. When every module declines or the gate
	// skips them all, nothing is sent. The page's share then waits for a `call` to share the name,
	// as it did before this hook existed.
	const offering = async (request: Unshared): Promise<void> => {
		if (!loader.loaded().some((name) => offerOf(loader.get(name)) !== undefined)) return;
		await ready;
		for (const name of loader.loaded()) {
			if (over || !request.held()) return;
			const instance = loader.get(name);
			const hook = offerOf(instance);
			if (hook === undefined) continue;
			let offer: Offer | undefined;
			try {
				const reasons = await gate.access({ name, instance }, context);
				if (reasons.length > 0) continue;
				if (over || !request.held()) return;
				offer = await hook.call(instance, request.name, context);
			} catch (error) {
				if (isRefusal(error)) {
					request.refuse((error as { reason: string }).reason, detailOf(error as { reason: string }));
					return;
				}
				report(name, error, context, 'an offer threw');
				request.refuse('failed', `${request.name} could not be offered`);
				return;
			}
			if (offer === undefined) continue;
			if (over || !request.held()) {
				// The document is not shared, but the module may have opened it. Its `fault` is told
				// `left` or `closed`, as it would be if the share had begun and then ended.
				try {
					offer.fault?.(over ? 'closed' : 'left', `the page stopped asking for ${request.name} before it was offered`);
				} catch (error) {
					report(name, error, context, 'an offer threw');
				}
				return;
			}
			// The module's handlers run inside the link's own frames, where a throw would escape
			// uncaught. One that throws is reported under the module's name instead.
			const reported = <A extends unknown[]>(handler: ((...args: A) => void) | undefined) => (handler === undefined
				? undefined
				: (...args: A): void => {
					try {
						handler(...args);
					} catch (error) {
						report(name, error, context, 'an offer threw');
					}
				});
			try {
				gated.share(request.name, offer.document, { ...offer, refused: reported(offer.refused), fault: reported(offer.fault) });
			} catch (error) {
				report(name, error, context, 'an offer threw');
				request.refuse('failed', `${request.name} could not be offered`);
			}
			return;
		}
	};

	// The connection is over when its link is over. The socket closing ends the link, and a
	// link that ended on bytes it could not read closes the socket itself (the adapter's rule),
	// so the other end never goes on asking a connection that answers nothing.
	const ended = new Promise<void>((done) => {
		channel.closed(() => {
			over = true;
			asks.stop();
			for (const { name, end } of ends.splice(0).reverse()) runEnd(name, end);
			emit({ kind: 'closed', at: Date.now(), ms: Date.now() - opened }, context);
			done();
		});
	});

	// Hooks in load order, for the modules the gate allows. A hook that throws ends the
	// connection: a connection half set up is the state nothing else can reason about.
	void (async () => {
		emit({ kind: 'connection', at: opened, request }, context);
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
					report(name, error, context);
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
