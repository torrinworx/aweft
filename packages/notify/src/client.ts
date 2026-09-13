// The browser half: a user's inbox over a connection the page already has, and the device the
// page registers for push (design 268).
//
// Every import here is a type or one of the values `core` and `codec` hand out, so a page bundle
// that reaches for it carries no server module, no store and no Node module. Everything goes
// over the socket: the inbox is a shared document, and marking read and registering a device are
// asks.

import type { Client, Handle } from '@aweftjs/client';
import { codecError } from '@aweftjs/codec';
import { type Derived, immutable, mutable, observer } from '@aweftjs/core';

import type { Device, Item } from './item.ts';

export type { Channel, Delivery, DeliveryRecord, Device, Item, Level } from './item.ts';

/** What a page registers: the device's own id, what it is, and how it can be woken. */
export interface Registration {
	/** Stable across launches, minted by the page and kept in its own storage. */
	readonly device: string;
	readonly platform: Device['platform'];
	readonly transport: Device['transport'];
	/** The push token the transport issued, or null for a device that cannot be woken. */
	readonly endpoint?: string | null | undefined;
}

/** A user's inbox over one connection. */
export interface InboxView {
	/**
	 * The inbox's items, oldest first, once `ready` has settled; undefined before. The list is
	 * the shared document's own, so a component that follows it hears every send live.
	 */
	readonly items: readonly Item[] | undefined;
	/** The items, once the server has shared them. Rejects the way `client.ask` does when the gate refuses, and with `anonymous` when there is no user. */
	readonly ready: Promise<readonly Item[]>;
	/** How many items have no `readAt`, as a read-only cell. Zero until `ready`. */
	readonly unread: Derived<number>;
	/**
	 * Mark items read.
	 *
	 * Params:
	 *   ids: the items to mark; every item when omitted
	 *
	 * Returns: how many changed. Rejects as `client.ask` does, and with `stopped` after `stop()`.
	 *
	 * Example:
	 *   await inbox.read();
	 */
	read(ids?: readonly string[]): Promise<number>;
	/**
	 * Register this device for push, or refresh its token.
	 *
	 * Returns: how many devices the user has. Rejects with the server's `invalid-device` or
	 * `capped`, and with `stopped` after `stop()`.
	 *
	 * Example:
	 *   await inbox.register({ device: id, platform: 'android', transport: 'fcm', endpoint: token });
	 */
	register(registration: Registration): Promise<number>;
	/** Forget a device. Returns how many the user has left. */
	forget(device: string): Promise<number>;
	/**
	 * Stop following the connection. The share stops and the client is left open, because it is
	 * not this half's to close. Calling it twice is not an error.
	 */
	stop(): void;
}

interface Root { readonly items: Item[] }

const STOPPED_FIX = 'Make a new view with createInbox; a stopped one follows no connection.';

const halted = (): Error => codecError('stopped', 'the inbox view is stopped', STOPPED_FIX);

// One connection carries one inbox: the server offers the topic once per socket, so a second
// share of the name would wait forever. A client has one live view, handed back again until it
// is stopped or refused, the way `auth.state()` hands back one handle (design 185).
const views = new WeakMap<Client, InboxView>();

/**
 * A user's inbox over a connection.
 *
 * Params:
 *   client: the connection, from `createClient`, signed in as the user whose inbox this is
 *
 * Returns: `items`, `ready`, `unread`, `read`, `register`, `forget` and `stop`. `ready` asks
 * `notify/Inbox` first, so an anonymous page hears the gate's refusal at once rather than
 * waiting for a topic the server never offers; a page that follows `auth.user` opens the view
 * once it reads a string. One client carries one live view: calling this again hands back the
 * same one until it is stopped or its `ready` was refused. Stop it before `enter` or `leave`,
 * because the connection after either is another user's, and make a new one after; a view
 * stopped on a socket still open pairs again on the next socket, which `enter` and `leave` open.
 *
 * Example:
 *   const inbox = createInbox(client);
 *   inbox.unread.effect((n) => badge.textContent = n === 0 ? '' : String(n));
 *   const items = await inbox.ready;
 *   await inbox.read();
 */
export const createInbox = (client: Client): InboxView => {
	const live = views.get(client);
	if (live !== undefined) return live;
	const unread = mutable(0);
	let stopped = false;
	let off: (() => void) | undefined;
	let handle: Handle<Root> | undefined;

	const recount = (items: readonly Item[]): void => {
		let n = 0;
		for (const item of items) if (item.readAt === null) n += 1;
		unread.set(n);
	};

	// The share is made now, and the ask beside it is what turns a topic the server will never
	// offer into an answer: the gate refuses the ask for an anonymous page, and the module
	// refuses it under a gate that lets one through.
	handle = client.share<Root>('inbox');
	const ready = client.ask('notify/Inbox', { read: [] }).then(
		() => {
			// Stopped while the ask was out: the share is gone, and so is the answer.
			if (handle === undefined) throw halted();
			return handle.ready;
		},
		(error: unknown) => { handle?.stop(); handle = undefined; views.delete(client); throw error; },
	).then((root) => {
		if (stopped) throw halted();
		recount(root.items);
		off = observer(root).path('items').skip(Infinity).watch(() => { recount(root.items); });
		return root.items as readonly Item[];
	});
	// A page that renders `unread` and never reads this promise is not killed by a refusal.
	ready.catch(() => {});

	const ask = async <T>(name: string, args: unknown, field: string): Promise<T> => {
		if (stopped) throw halted();
		const answer = await client.ask(name, args) as Record<string, T>;
		return answer[field]!;
	};

	const view: InboxView = {
		get items() { return handle?.document?.items as readonly Item[] | undefined; },
		ready,
		unread: immutable(unread),
		read: (ids) => ask('notify/Inbox', { read: ids ?? 'all' }, 'marked'),
		register: (registration) => ask('notify/Devices', { register: registration }, 'devices'),
		forget: (device) => ask('notify/Devices', { forget: { device } }, 'devices'),
		stop: () => {
			stopped = true;
			off?.();
			off = undefined;
			handle?.stop();
			handle = undefined;
			if (views.get(client) === view) views.delete(client);
		},
	};
	views.set(client, view);
	return view;
};
