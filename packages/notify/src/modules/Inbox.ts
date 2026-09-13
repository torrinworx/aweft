// notify/Inbox: the keeper. One `inbox:<user>` document per user, shared live on every connection
// of theirs and written only here; the broker appends to it and the page marks items read
// through the one call (design 268).

import { codecError } from '@aweftjs/codec';
import { atomic, createArray, createObject } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';
import type { Connection } from '@aweftjs/server';
import type { Handle, Store } from '@aweftjs/store';

import { type DeliveryRecord, type Item } from '../item.ts';
import { anonymous, noStore, storeOf, userOf } from '../props.ts';

export const defaults = {
	keep: 200,
	idleMs: 60_000,
};

/** The root of an inbox document, as the module writes it. */
interface Root {
	items: Item[];
}

/** A document this module holds open: who holds it, and the timer that lets it go. */
interface Holding {
	readonly handle: Handle;
	refs: number;
	idle: ReturnType<typeof setTimeout> | undefined;
}

/** The instance: the share on a connection, the call, and what the broker calls. */
export interface Inbox {
	connection(connection: Connection): Promise<(() => Promise<void>) | undefined>;
	/**
	 * Mark items read for the connection's user.
	 *
	 * Throws: `anonymous` with no user on the context; `no-store` when the server has none;
	 * `invalid-call` for anything but `{ read: ids | 'all' }`.
	 */
	call(args: unknown, context: unknown): Promise<{ marked: number }>;
	/**
	 * Put an item into a user's inbox, dropping the oldest past `keep`.
	 *
	 * Throws: `no-store` when the server has none.
	 */
	append(user: string, item: Item): Promise<void>;
	/** Write the delivery record onto an item, once the channels have answered. */
	delivered(user: string, id: string, record: DeliveryRecord): Promise<void>;
	stop(): Promise<void>;
}

const refuse = (detail: string, fix: string): Error => codecError('invalid-config', `notify/Inbox was given ${detail}`, fix);

const numberOf = (config: Readonly<Record<string, unknown>>, key: keyof typeof defaults): number => {
	const held: unknown = config[key];
	if (typeof held !== 'number' || !(held > 0)) throw refuse(`${key} ${JSON.stringify(held)}`, 'Give that setting a number above zero.');
	// Over 2^31 - 1 milliseconds Node fires a timer after one millisecond instead.
	if (key === 'idleMs' && held > 2_147_483_647) throw refuse(`idleMs ${String(held)}, more than a timer holds`, 'Give idleMs at most 2147483647 milliseconds, about 24.8 days.');
	return held;
};

const invalidCall = (): Error =>
	codecError('invalid-call', 'notify/Inbox takes { read: ids | \'all\' } and nothing else', 'Ask with { read: [id, ...] } or { read: \'all\' }.');

/** The page's write, refused: the inbox is the record of what was sent, and `readAt` goes through the call. */
const READ_ONLY = { accept: () => [{ code: 'read-only', message: 'the inbox is written by the server; mark an item read with a call to notify/Inbox' }] };

export default (props: ModuleProps): Inbox => {
	const { config } = props;
	const store: Store | undefined = storeOf(props);
	const keep = numberOf(config, 'keep');
	const idleMs = numberOf(config, 'idleMs');

	const held = new Map<string, Holding>();
	// Two first writes to one document in the same tick would each open it, and the store would
	// count two opens against the one close; the second joins the first's open instead.
	const opening = new Map<string, Promise<Holding>>();

	const name = (user: string): string => `inbox:${user}`;

	/** The document, opened once and held; each `hold` is matched by one `release`. */
	const hold = (user: string): Promise<Holding> => {
		if (store === undefined) throw noStore('the inbox');
		const doc = name(user);
		const holding = held.get(doc);
		if (holding !== undefined) {
			holding.refs += 1;
			if (holding.idle !== undefined) { clearTimeout(holding.idle); holding.idle = undefined; }
			return Promise.resolve(holding);
		}
		const inFlight = opening.get(doc);
		if (inFlight !== undefined) return inFlight.then((made) => { made.refs += 1; return made; });
		const building = (async (): Promise<Holding> => {
			const handle = await store.open(doc);
			const root = handle.root as Partial<Root>;
			if (root.items === undefined) root.items = createArray<Item>();
			const made: Holding = { handle, refs: 1, idle: undefined };
			held.set(doc, made);
			return made;
		})();
		opening.set(doc, building);
		void building.then(() => opening.delete(doc), () => opening.delete(doc));
		return building;
	};

	const release = (user: string): void => {
		const doc = name(user);
		const holding = held.get(doc);
		if (holding === undefined) return;
		holding.refs -= 1;
		if (holding.refs > 0) return;
		if (holding.idle !== undefined) clearTimeout(holding.idle);
		holding.idle = setTimeout(() => {
			held.delete(doc);
			void store?.close(holding.handle).catch(() => undefined);
		}, idleMs);
		holding.idle.unref?.();
	};

	/** One write on a user's inbox: hold, change inside one commit, settle, keep the tail to one, let go. */
	const write = async <T>(user: string, change: (root: Root) => T): Promise<T> => {
		const holding = await hold(user);
		try {
			const root = holding.handle.root as Root;
			const out = atomic(() => change(root));
			await store!.settled(holding.handle);
			await store!.truncate(name(user), 1);
			return out;
		} finally {
			release(user);
		}
	};

	const read = (user: string, ids: readonly string[] | 'all'): Promise<number> => write(user, (root) => {
		const wanted = ids === 'all' ? undefined : new Set(ids);
		let marked = 0;
		const now = Date.now();
		for (const item of root.items) {
			if (item.readAt !== null || (wanted !== undefined && !wanted.has(item.id))) continue;
			(item as { readAt: number | null }).readAt = now;
			marked += 1;
		}
		return marked;
	});

	return {
		connection: async ({ link, context }) => {
			const user = userOf(context);
			// Nothing to share: an anonymous connection has no inbox, and a server with no store
			// keeps none. Neither is an error here; the call says so when the page asks.
			if (user === null || store === undefined) return undefined;
			const holding = await hold(user);
			link.share('inbox', holding.handle.root, READ_ONLY);
			return async () => { release(user); };
		},

		call: async (args, context) => {
			const user = userOf(context);
			if (user === null) throw anonymous('the inbox');
			if (store === undefined) throw noStore('the inbox');
			const wanted: unknown = (args as { read?: unknown } | null)?.read;
			if (wanted !== 'all' && !(Array.isArray(wanted) && wanted.every((id) => typeof id === 'string'))) throw invalidCall();
			return { marked: await read(user, wanted as readonly string[] | 'all') };
		},

		append: (user, item) => write(user, (root) => {
			root.items.push(createObject<Item>(item));
			// Oldest first out, so the list a page holds is the newest `keep`.
			if (root.items.length > keep) root.items.splice(0, root.items.length - keep);
		}),

		delivered: (user, id, record) => write(user, (root) => {
			const item = root.items.find((one) => one.id === id);
			// Gone already when `keep` sends arrived in the meantime; the record went back to the caller.
			if (item !== undefined) (item as { delivery: string }).delivery = JSON.stringify(record);
		}),

		stop: async () => {
			for (const [doc, holding] of held) {
				if (holding.idle !== undefined) clearTimeout(holding.idle);
				held.delete(doc);
				await store?.close(holding.handle);
			}
		},
	};
};
