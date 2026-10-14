// A cell over `ask` that follows its arguments (design 312).
//
// It asks only while something watches it, the way `fromEvent` listens only while watched, so a
// component that stops watching stops it and no cleanup is handed in.

import { type Cell, type EventEmitting, fromEvent } from '@aweftjs/core';

import type { Client } from './client.ts';

/** Where an `asking` cell is: an ask out, the answer, or what it rejected with. */
export type Asked<T> =
	/** An ask is out. `data` is the last answer's, or null before the first. */
	| { readonly state: 'waiting'; readonly data: T | null }
	| { readonly state: 'ready'; readonly data: T }
	| { readonly state: 'failed'; readonly data: null; readonly error: unknown };

/** What `asking` may be told. */
export interface AskingOptions {
	/** Handed the first ask, settled either way: a component passes its own `pending`, so a render on a server waits for it. */
	readonly pending?: ((promise: Promise<unknown>) => void) | undefined;
	/** Each ask's timeout, in milliseconds, as `ask` takes it. */
	readonly timeout?: number | undefined;
}

interface Followed {
	get(): unknown;
	effect(fn: (value: unknown) => void): () => void;
}

const isFollowed = (value: unknown): value is Followed =>
	(typeof value === 'object' || typeof value === 'function') && value !== null
	&& typeof (value as Followed).effect === 'function' && typeof (value as Followed).get === 'function';

/**
 * A read-only cell of the latest answer to `client.ask(name, args)`.
 *
 * Params:
 *   client: the connection to ask over
 *   name: the module's name
 *   args: the arguments, or a cell of them: every value the cell takes asks again
 *   options.pending: handed the first ask, so a component's render waits for it
 *   options.timeout: each ask's timeout
 *
 * Returns: a cell of `{ state, data }`. It is `waiting` while an ask is out, keeping the last
 * answer's `data` so a list dims in place rather than blanking, `ready` with the answer, and
 * `failed` with `data` null and the `error` the ask rejected with. An answer to an ask a newer one replaced is
 * dropped. It asks only while something watches it: the first watcher asks, and when the last
 * one stops, an answer still out is dropped and the next watcher asks again. Writing it throws
 * `read-only`.
 *
 * Example:
 *   const query = mutable('');
 *   const found = asking<Post[]>(client, 'posts/Search', query.map((text) => ({ text })));
 *   <List items={found.map((now) => now.data ?? [])} busy={found.map((now) => now.state === 'waiting')} />
 */
export const asking = <T = unknown>(client: Client, name: string, args?: unknown, options: AskingOptions = {}): Cell<Asked<T>> => {
	let held: Asked<T> = { state: 'waiting', data: null };
	let hear: ((value: Asked<T>) => void) | undefined;
	let stop: (() => void) | undefined;
	// Every ask takes the next number. An answer is kept only while its number is the latest.
	let latest = 0;
	let first = true;

	const put = (next: Asked<T>): void => {
		held = next;
		hear?.(next);
	};

	const ask = (now: unknown): void => {
		latest += 1;
		const mine = latest;
		// The first ask of a watch is made while the watch attaches, and its state is read right
		// after, so it is set and not told.
		if (hear === undefined || held.state !== 'waiting') {
			const waiting: Asked<T> = { state: 'waiting', data: held.data };
			if (hear === undefined) held = waiting;
			else put(waiting);
		}
		const asked = client.ask(name, now, options.timeout === undefined ? {} : { timeout: options.timeout }).then(
			(answer) => { if (mine === latest) put({ state: 'ready', data: answer as T }); },
			(error: unknown) => { if (mine === latest) put({ state: 'failed', data: null, error }); },
		);
		if (first) {
			first = false;
			// The caller's code, run while a watch attaches: a throw is raised as its own on a fresh
			// task, and the watch and the ask go on.
			try {
				options.pending?.(asked);
			} catch (error) {
				queueMicrotask(() => { throw error; });
			}
		}
	};

	const target: EventEmitting<Asked<T>> = {
		addEventListener: (_type, fn) => {
			if (isFollowed(args)) stop = args.effect((now) => { ask(now); });
			else ask(args);
			hear = fn;
		},
		removeEventListener: () => {
			hear = undefined;
			stop?.();
			stop = undefined;
			// Nobody is listening, so the answer to the ask still out is dropped when it comes.
			latest += 1;
		},
	};

	return fromEvent(target, 'answer').map(() => held);
};
