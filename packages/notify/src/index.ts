// The notify battery: a source of three server modules, and the types a module that sends
// reaches for (design 268).

import { fromBundle } from '@aweftjs/modules';
import type { Source } from '@aweftjs/modules';

/**
 * The three modules, for `sources`: `notify/Send` is the broker any module names in `deps`,
 * `notify/Inbox` keeps and shares each user's inbox, `notify/Devices` keeps where a user can be
 * reached for push (design 268).
 *
 * Params: none. It is a value, listed beside the application's own sources.
 *
 * Returns: the source. Put the application's own source first and a module of the same name
 * there wins; a file of that name exporting only `config` configures it instead.
 *
 * Example:
 *   const server = createServer({ sources: [own, notify, auth], store, gate: 'auth/Gate', listener });
 *   // modules/notify/Send.ts, in `own`:
 *   export const config = { email: { resend: { key: process.env.RESEND_KEY, from: 'Acme <hello@acme.test>' } } };
 *   // modules/orders/Ship.ts, in `own`:
 *   export const deps = ['notify/Send'];
 *   export default ({ imports }) => ({
 *     call: async ({ order, user }) => imports.Send.send({ to: { user }, title: `Order ${order} shipped`, level: 'warn' }),
 *   });
 */
export const notify: Source = fromBundle({
	'./notify/Send.ts': () => import('./modules/Send.ts'),
	'./notify/Inbox.ts': () => import('./modules/Inbox.ts'),
	'./notify/Devices.ts': () => import('./modules/Devices.ts'),
});

export type { Channel, Delivery, DeliveryRecord, Device, Item, Level, Recipient } from './item.ts';
export type { EmailSetting, PushSetting, Send, SendOptions, Sent } from './modules/Send.ts';
export type { Inbox } from './modules/Inbox.ts';
export type { Devices } from './modules/Devices.ts';
export type { Mail, Sender } from './resend.ts';
export type { PushData, PushOutcome, Pusher } from './fcm.ts';
