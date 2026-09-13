// notify/Send: the broker. One send to a person, over the channels its level picks, with what
// each channel did written down; a channel that fails is a line in the record and never a throw
// out of the send (design 268).

import { codecError, createId, idToText } from '@aweftjs/codec';
import type { ModuleProps } from '@aweftjs/modules';
import type { Store } from '@aweftjs/store';

import { type Pusher, type PushData, type PushOutcome, fcm } from '../fcm.ts';
import {
	type Channel, type Delivery, type DeliveryRecord, type Item, type Level, type Recipient,
	CHANNELS, LEVELS, cut, escape,
} from '../item.ts';
import { oneOf, storeOf } from '../props.ts';
import { type Mail, type Sender, resend } from '../resend.ts';
import type { Devices } from './Devices.ts';
import type { Inbox } from './Inbox.ts';

export const deps = ['notify/Inbox', 'notify/Devices'];

export const defaults = {
	levels: {
		info: ['inbox'],
		warn: ['inbox', 'push'],
		error: ['inbox', 'push', 'email'],
	} as Readonly<Record<Level, readonly Channel[]>>,
	email: null as EmailSetting,
	push: null as PushSetting,
	perHour: 100,
	outward: true,
	private: true,
	address: null as ((user: string) => Promise<string | null> | string | null) | null,
	timeoutMs: 10_000,
};

/** How email goes out: Resend with a key, the application's own sender, or not at all. */
export type EmailSetting = { readonly resend: { readonly key: string; readonly from: string; readonly endpoint?: string | undefined } } | Sender | null;

/** How push goes out: FCM with a service account, the application's own pusher, or not at all. */
export type PushSetting = { readonly fcm: { readonly account: string; readonly endpoint?: string | undefined; readonly tokenUrl?: string | undefined } } | Pusher | null;

/** What a module hands `send`. */
export interface SendOptions {
	readonly to: Recipient;
	readonly title: string;
	readonly body?: string | undefined;
	readonly level?: Level | undefined;
	/** The channels to try, in place of the level's. */
	readonly channels?: readonly Channel[] | undefined;
	/** Kept as given; whether it is safe to render as a link is the page's call. */
	readonly url?: string | null | undefined;
	/** A label the application gives: the inbox shows it and a push groups on it. */
	readonly tag?: string | null | undefined;
	/** The mail's HTML; the escaped title and body in two paragraphs by default. */
	readonly html?: string | undefined;
	readonly replyTo?: string | undefined;
	/** Whether a push carries only that something happened; the configuration's `private` by default. */
	readonly private?: boolean | undefined;
}

/** What `send` answers: the item's id and time, and what each channel did. */
export interface Sent {
	readonly id: string;
	readonly at: number;
	readonly delivery: DeliveryRecord;
}

/** The instance: one method, for any module that names this one in `deps`. */
export interface Send {
	/**
	 * Send a notification.
	 *
	 * Throws: `invalid-notification` for a missing title, an unknown level or channel, or a
	 * recipient of neither shape; `capped` when this recipient has had `perHour` already.
	 */
	send(options: SendOptions): Promise<Sent>;
}

const refuse = (detail: string, fix: string): Error => codecError('invalid-config', `notify/Send was given ${detail}`, fix);

const invalid = (detail: string): Error =>
	codecError('invalid-notification', `notify/Send was handed ${detail}`, 'Send { to: { user } | { email }, title, body?, level?: info | warn | error, channels?: [inbox | email | push] }.');

const capped = (): Error =>
	codecError('capped', 'this recipient has had as many notifications this hour as notify/Send allows', 'Send fewer to one person, or raise perHour in the module\'s config.');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

/** A count per key inside a sliding hour. Past 4096 keys the ones idle for an hour are dropped, so the map holds the hour's distinct recipients and nothing older. */
const perHourWindow = (): { allow(key: string, max: number): boolean } => {
	const seen = new Map<string, number[]>();
	return {
		allow: (key, max) => {
			const now = Date.now();
			const since = now - 3_600_000;
			if (seen.size > 4096) for (const [k, times] of seen) if (times.every((at) => at <= since)) seen.delete(k);
			const kept = (seen.get(key) ?? []).filter((at) => at > since);
			if (kept.length >= max) { seen.set(key, kept); return false; }
			kept.push(now);
			seen.set(key, kept);
			return true;
		},
	};
};

const GENERIC = { title: 'Notification', body: 'You have a new notification' };

/** A sender or pusher awaited for at most `ms`, so one that never answers cannot hold a send open. */
const bounded = <T>(what: string, ms: number, run: () => Promise<T>): Promise<T> => new Promise<T>((settle, fail) => {
	const timer = setTimeout(() => { fail(new Error(`the ${what} did not answer within ${String(ms)} ms`)); }, ms);
	timer.unref?.();
	Promise.resolve().then(run).then(
		(value) => { clearTimeout(timer); settle(value); },
		(error: unknown) => { clearTimeout(timer); fail(error); },
	);
});

export default (props: ModuleProps): Send => {
	const { config, imports } = props;
	const store: Store | undefined = storeOf(props);
	const inbox = imports.Inbox as Inbox;
	const devices = imports.Devices as Devices;

	// The configuration, refused at load where it cannot be used rather than at the first send.
	if (!isPlainObject(config.levels)) throw refuse(`levels ${JSON.stringify(config.levels)}`, 'Give levels an object of level to channel list, such as { info: [\'inbox\'] }.');
	const levels: Record<Level, readonly Channel[]> = { info: [], warn: [], error: [] };
	for (const level of LEVELS) {
		const listed: unknown = config.levels[level];
		if (!Array.isArray(listed) || !listed.every((c) => oneOf(c, CHANNELS))) {
			throw refuse(`levels.${level} ${JSON.stringify(listed)}`, 'Give each level a list drawn from inbox, email and push.');
		}
		levels[level] = [...new Set(listed as Channel[])];
	}
	for (const key of ['perHour', 'timeoutMs'] as const) {
		if (typeof config[key] !== 'number' || !(config[key] > 0)) throw refuse(`${key} ${JSON.stringify(config[key])}`, 'Give that setting a number above zero.');
	}
	const perHour = config.perHour as number;
	const timeoutMs = config.timeoutMs as number;
	for (const key of ['outward', 'private'] as const) {
		if (typeof config[key] !== 'boolean') throw refuse(`${key} ${JSON.stringify(config[key])}`, 'Give that setting true or false.');
	}
	const outward = config.outward as boolean;
	const privateByDefault = config.private as boolean;
	if (config.address !== null && typeof config.address !== 'function') throw refuse(`address ${JSON.stringify(config.address)}`, 'Give address a function from a user id to their email, or null to read user documents.');
	const address = config.address as typeof defaults.address;

	let sender: Sender | null = null;
	if (typeof config.email === 'function') sender = config.email as Sender;
	else if (isPlainObject(config.email) && isPlainObject(config.email.resend)) {
		const { key, from, endpoint } = config.email.resend;
		if (typeof key !== 'string' || key === '' || typeof from !== 'string' || from === '') throw refuse('email.resend without a key and a from', 'Give email.resend a key and a from address.');
		sender = resend({ key, from, endpoint: typeof endpoint === 'string' ? endpoint : undefined }, timeoutMs);
	} else if (config.email !== null) throw refuse(`email ${JSON.stringify(config.email)}`, 'Give email { resend: { key, from } }, a function taking the mail, or null.');

	let pusher: Pusher | null = null;
	if (typeof config.push === 'function') pusher = config.push as Pusher;
	else if (isPlainObject(config.push) && isPlainObject(config.push.fcm)) {
		const { account, endpoint, tokenUrl } = config.push.fcm;
		if (typeof account !== 'string' || account === '') throw refuse('push.fcm without an account', 'Give push.fcm the service account key file as JSON or base64 on one line.');
		pusher = fcm({ account, endpoint: typeof endpoint === 'string' ? endpoint : undefined, tokenUrl: typeof tokenUrl === 'string' ? tokenUrl : undefined }, timeoutMs);
	} else if (config.push !== null) throw refuse(`push ${JSON.stringify(config.push)}`, 'Give push { fcm: { account } }, a function taking the data and the endpoints, or null.');

	const window = perHourWindow();

	/** The recipient's address: given, configured, or read off the user document the auth battery keeps. */
	const addressOf = async (to: Recipient): Promise<string | null> => {
		if ('email' in to) return to.email;
		if (address !== null) {
			const answered: unknown = await address(to.user);
			if (answered === null) return null;
			if (typeof answered !== 'string' || answered.trim() === '') throw new Error(`the address function answered ${JSON.stringify(answered)} rather than an email address or null`);
			return answered.trim();
		}
		if (store === undefined) throw new Error('there is no store to read the user\'s address from; give notify/Send an address function');
		const handle = await store.open(`user:${to.user}`);
		try {
			const email: unknown = (handle.root as { email?: unknown }).email;
			return typeof email === 'string' && email !== '' ? email : null;
		} finally {
			await store.close(handle);
		}
	};

	/** A channel's outcome, however it ended: a throw is a line in the record, not a throw out of the send. */
	const attempt = async (run: () => Promise<Delivery>): Promise<Delivery> => {
		try {
			return await run();
		} catch (error) {
			const reason: unknown = (error as { reason?: unknown } | null)?.reason;
			if (reason === 'no-store') return { skipped: 'no store' };
			return { ok: false, error: (error as Error).message };
		}
	};

	const viaInbox = (to: Recipient, item: Item): Promise<Delivery> => attempt(async () => {
		if (!('user' in to)) return { skipped: 'no user' };
		await inbox.append(to.user, item);
		return { ok: true };
	});

	const viaEmail = (to: Recipient, item: Item, html: string | undefined, replyTo: string | undefined): Promise<Delivery> => attempt(async () => {
		const address = await addressOf(to);
		if (address === null) return { ok: false, error: 'the user has no email address' };
		if (sender === null) return { ok: false, error: 'email is not configured: give notify/Send an email setting' };
		const mail: Mail = {
			to: address,
			subject: item.title,
			text: item.body,
			html: html ?? `<p><strong>${escape(item.title)}</strong></p><p>${escape(item.body)}</p>`,
			replyTo,
		};
		if (!outward) return { ok: false, error: 'outward delivery is off (outward: false)' };
		return await bounded('sender', timeoutMs, () => sender!(mail));
	});

	const viaPush = (to: Recipient, item: Item, isPrivate: boolean): Promise<Delivery> => attempt(async () => {
		if (!('user' in to)) return { skipped: 'no user' };
		const registered = Object.entries(await devices.list(to.user)).filter(([, d]) => d.transport === 'fcm' && d.endpoint !== null);
		if (registered.length === 0) return { ok: false, error: 'no device is registered for push' };
		if (pusher === null) return { ok: false, error: 'push is not configured: give notify/Send a push setting' };
		const data: PushData = {
			n: item.id,
			p: isPrivate ? '1' : '0',
			t: isPrivate ? GENERIC.title : item.title,
			b: isPrivate ? GENERIC.body : item.body,
			u: item.url ?? '',
			l: item.level,
			g: item.tag ?? '',
		};
		if (!outward) return { ok: false, error: 'outward delivery is off (outward: false)' };
		const answered: unknown = await bounded('pusher', timeoutMs, () => pusher!(data, registered.map(([, d]) => d.endpoint!)));
		// One answer per device, in the order they were handed over; a pusher that answers fewer
		// leaves the rest unanswered, and one that answers more is not believed about devices it
		// was not given.
		const outcomes: readonly unknown[] = Array.isArray(answered) ? answered : [];
		let sent = 0;
		const errors: string[] = [];
		for (const [index, [id]] of registered.entries()) {
			const outcome = outcomes[index] as PushOutcome | undefined;
			if (outcome !== null && typeof outcome === 'object' && 'ok' in outcome && outcome.ok === true) { sent += 1; continue; }
			errors.push(`${id}: ${outcome === null || typeof outcome !== 'object' ? 'no answer from the pusher' : 'error' in outcome ? String(outcome.error) : 'skipped' in outcome ? String(outcome.skipped) : 'no answer from the pusher'}`);
			// A dead endpoint would otherwise make every later send a partial failure for good.
			if (outcome !== null && typeof outcome === 'object' && 'stale' in outcome && outcome.stale === true) await devices.forget(to.user, id);
		}
		return sent > 0
			? { ok: true, devices: sent, ...(errors.length > 0 ? { errors } : {}) }
			: { ok: false, error: errors.join('; ') };
	});

	const send = async (options: SendOptions): Promise<Sent> => {
		if (!isPlainObject(options)) throw invalid('something that is not an options object');
		const to: unknown = options.to;
		const held = isPlainObject(to) ? to : {};
		const toUser = typeof held.user === 'string' && held.user !== '';
		const toEmail = typeof held.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(held.email);
		if (!toUser && !toEmail) throw invalid(`a recipient of ${JSON.stringify(to)}`);
		const recipient: Recipient = toUser ? { user: held.user as string } : { email: (held.email as string).trim().toLowerCase() };
		const title = cut(options.title, 200);
		if (title === '') throw invalid('no title');
		const level = options.level === undefined ? 'info' : options.level;
		if (!oneOf(level, LEVELS)) throw invalid(`a level of ${JSON.stringify(level)}`);
		let channels: readonly Channel[] = levels[level];
		if (options.channels !== undefined) {
			if (!Array.isArray(options.channels) || !options.channels.every((c) => oneOf(c, CHANNELS))) throw invalid(`channels of ${JSON.stringify(options.channels)}`);
			channels = [...new Set(options.channels)];
		}
		for (const key of ['body', 'html', 'replyTo'] as const) {
			if (options[key] !== undefined && typeof options[key] !== 'string') throw invalid(`${key} that is not a string`);
		}
		for (const key of ['url', 'tag'] as const) {
			if (options[key] !== undefined && options[key] !== null && typeof options[key] !== 'string') throw invalid(`${key} that is not a string or null`);
		}
		if (options.private !== undefined && typeof options.private !== 'boolean') throw invalid('private that is not true or false');

		if (!window.allow('user' in recipient ? `user:${recipient.user}` : `email:${recipient.email}`, perHour)) throw capped();

		const item: Item = {
			id: idToText(createId()),
			at: Date.now(),
			level,
			title,
			body: cut(options.body, 2000),
			url: options.url === undefined || options.url === null ? null : cut(options.url, 2000),
			tag: options.tag === undefined || options.tag === null ? null : cut(options.tag, 64) || null,
			readAt: null,
			delivery: '{}',
		};
		const isPrivate = options.private ?? privateByDefault;

		// The inbox first, so the item is there before any network call and a push carries an id
		// the page can find; the record goes onto it once the other channels have answered.
		const delivery: Partial<Record<Channel, Delivery>> = {};
		if (channels.includes('inbox')) delivery.inbox = await viaInbox(recipient, item);
		if (channels.includes('email')) delivery.email = await viaEmail(recipient, item, options.html, options.replyTo);
		if (channels.includes('push')) delivery.push = await viaPush(recipient, item, isPrivate);
		if (delivery.inbox !== undefined && 'ok' in delivery.inbox && delivery.inbox.ok && 'user' in recipient) {
			await attempt(async () => { await inbox.delivered(recipient.user, item.id, delivery); return { ok: true }; });
		}
		return { id: item.id, at: item.at, delivery };
	};

	return { send };
};
