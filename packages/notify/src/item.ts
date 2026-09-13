// What a notification is, on either side: the levels, the channels, the recipient, the item an
// inbox holds and the record of what each channel did (design 268). Nothing here reaches for
// Node or the DOM; the client half imports it into a page bundle.

/** How urgent a notification is, which picks its channels unless the caller names them. */
export type Level = 'info' | 'warn' | 'error';

/** Where a notification can go. */
export type Channel = 'inbox' | 'email' | 'push';

/** Who a notification is for: a user the store knows, or an address. */
export type Recipient = { readonly user: string } | { readonly email: string };

/** What one channel did with one notification. */
export type Delivery =
	| { readonly ok: true; readonly [detail: string]: unknown }
	| { readonly ok: false; readonly error: string }
	| { readonly skipped: string };

/** The record of a send: one entry per channel tried. */
export type DeliveryRecord = Readonly<Partial<Record<Channel, Delivery>>>;

/** One notification as an inbox holds it: primitives only, so a row in the store is a row. */
export interface Item {
	readonly id: string;
	readonly at: number;
	readonly level: Level;
	readonly title: string;
	readonly body: string;
	readonly url: string | null;
	readonly tag: string | null;
	/** When the user marked it read, or null. */
	readonly readAt: number | null;
	/** The delivery record as JSON text, `{}` until the channels have answered. */
	readonly delivery: string;
}

/** A device a user registered for push. */
export interface Device {
	readonly platform: 'android' | 'ios' | 'desktop' | 'web';
	readonly transport: 'fcm' | 'none';
	readonly endpoint: string | null;
	readonly seenAt: number;
}

export const LEVELS: readonly Level[] = ['info', 'warn', 'error'];
export const CHANNELS: readonly Channel[] = ['inbox', 'email', 'push'];
export const PLATFORMS: readonly Device['platform'][] = ['android', 'ios', 'desktop', 'web'];
export const TRANSPORTS: readonly Device['transport'][] = ['fcm', 'none'];

/** A string, trimmed and cut at `max`; anything else is the empty string. */
export const cut = (value: unknown, max: number): string =>
	typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Text made safe inside an HTML element, so a body with a `<` in it reaches the mail whole. */
export const escape = (text: string): string =>
	text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
