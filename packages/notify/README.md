# @aweftjs/notify

The notify battery: one `send` to a person, over the channels its level picks. An inbox per user
in the application's own store, shared live on every connection of theirs; email through Resend;
push through Firebase Cloud Messaging; what each channel did written into the answer and onto the
item, and a channel that fails never losing the message. `@aweftjs/notify/client` is the browser
half: the inbox as a live list, an unread count, marking read, and registering the device.

It decides nothing about who may send to whom. That rule, and every cap on a sender, is the
application's, in the module that calls `send`.

## Quickstart

The server side is three modules in one source, configured by a file of the same name in your
own source:

```ts
import { auth, paths } from '@aweftjs/auth';
import { fromDirectory } from '@aweftjs/modules/node';
import { notify } from '@aweftjs/notify';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';

const store = createStore({ driver: memoryDriver(), declare: { ...paths } });

const server = createServer({
	sources: [fromDirectory('./modules'), notify, auth],
	store,
	gate: 'auth/Gate',
	listener: node({ port: 8080 }),
});

await server.start();
```

```ts
// modules/notify/Send.ts, in your own source: where email and push go out
export const config = {
	email: { resend: { key: process.env.RESEND_KEY, from: 'Acme <hello@acme.test>' } },
	push: { fcm: { account: process.env.FCM_ACCOUNT } },
};
```

Any module of yours sends by naming the broker in `deps`:

```ts
// modules/orders/Ship.ts
export const deps = ['notify/Send'];

export default ({ imports }) => ({
	call: async ({ order }, context) => imports.Send.send({
		to: { user: context.user },
		title: `Order ${order} shipped`,
		body: 'It is on its way.',
		level: 'warn',
		url: `/orders/${order}`,
		tag: 'orders',
	}),
});
```

The page hands its client to `createInbox` once it knows who it is:

```ts
import { createAuth } from '@aweftjs/auth/client';
import { createClient } from '@aweftjs/client';
import { createInbox } from '@aweftjs/notify/client';

const client = createClient();
const auth = createAuth(client);

auth.user.effect((who) => {
	if (typeof who !== 'string') return;
	const inbox = createInbox(client);
	inbox.unread.effect((n) => { badge.textContent = n === 0 ? '' : String(n); });
	inbox.ready.then((items) => render(items));      // the list is live from here on
	openButton.onclick = () => inbox.read();          // every item read
});
```

## What `send` takes and answers

```ts
const sent = await imports.Send.send({
	to: { user: id },              // or { email: 'someone@example.com' }
	title: 'Backup stopped',       // required, cut at 200
	body: 'Nothing has run for 3 days.',   // cut at 2000
	level: 'error',                // info (the default), warn or error
	channels: ['inbox', 'email'],  // in place of the level's; omit to let the level pick
	url: '/settings/backups',      // kept as given; whether it is a safe link is the page's call
	tag: 'backups',                // a label of yours: the inbox shows it, a push groups on it
	html: '<p>...</p>',            // the mail's html; the escaped title and body in two paragraphs by default
	replyTo: 'visitor@example.com',
	private: false,                // let the push carry the text; the configuration's private by default
});
// sent: { id, at, delivery: { inbox: { ok: true }, email: { ok: true, id }, push: { ok: true, devices: 2 } } }
```

**The level picks the channels** unless `channels` names them: `info` is the inbox, `warn` adds
push, `error` adds email. The map is configuration (below).

**The recipient is a user or an address.** `{ user }` is the id the gate put on the context; the
user's address is read off `user:<id>`, where the auth battery keeps it, unless the configuration
hands in `address`. `{ email }` is for a server with no users, such as a site whose contact form
mails its owner: the inbox and push need a user, so both are skipped for an address and the
answer says so.

**Each channel checks in a fixed order, and the record names the first thing that stopped it.**
The inbox: a user, then a store. Email: the user's address, then the `email` setting, then
`outward`. Push: a user, then a store, then a device registered with an endpoint, then the `push`
setting, then `outward`. So a send with no device registered says `no device is registered for
push` even when push is not configured, and `outward: false` is only reached once everything
local has passed, which is what keeps a test from hiding a bug in those steps.

**`delivery` is one entry per channel tried.** `{ ok: true, ... }` (email carries the
provider's `id`, push how many `devices` took it and any `errors`), `{ ok: false, error }` with
the provider's own message where there was one, or `{ skipped }` with the reason: `no user` for
the inbox and push on an address recipient, `no store` for both on a server with no store. A
sender or pusher that throws is `{ ok: false, error }` with its message, and one that does not
answer within `timeoutMs` is the same with a line saying so. `send` itself throws only for a
notification out of shape (`invalid-notification`: a missing title, a field of the wrong type, an
unknown level or channel, a recipient of neither shape) or a recipient over the cap (`capped`).

**The inbox is written first**, before any network call, so the item is on the page while the
mail goes out, and the record is written onto it once every channel has answered. A push carries
the item's id and, by default, no text: the phone shows that something happened and the page
reads the text from the inbox. `private: false` on a send, or `private: false` in the
configuration, sends the title and body through the push service.

## The inbox on the page

`createInbox(client)` answers `{ items, ready, unread, read, register, forget, stop }`.

- `ready` settles with the items once the server shares them. It asks `notify/Inbox` first, so an
  anonymous page hears the gate's `refused` at once rather than waiting for a topic the server
  never offers, and a gate with no users answers `anonymous`. While the socket is still opening it
  waits, and a client made with `timeout` bounds that wait. Make the view once `auth.user` reads
  a string. **One client has one live view**: calling `createInbox` again hands back the same one
  until it is stopped or refused, because the server offers the topic once per socket. Stop the
  view before `enter` or `leave`, whose connection is another user's, and make a new one after:
  it pairs on the socket they open.
- `items` is the shared document's own list, oldest first, so a component that follows it hears
  every send live. **It is read only.** The server refuses a commit from the page with
  `read-only`, and a page that writes into it anyway holds its own version until the next
  connection, when the server's state wins (design 184). Mark items read with `read`.
- `unread` is a read-only cell counting the items with no `readAt`.
- `read(ids?)` marks those items, or every item when omitted, and answers how many changed.
- `register({ device, platform, transport, endpoint })` records this browser or app as a place
  the user can be reached: `device` is an id the page mints once and keeps in its own storage,
  `platform` is `android`, `ios`, `desktop` or `web`, `transport` is `fcm` with the token as
  `endpoint`, or `none` for a device that cannot be woken. Register on every launch: a token can
  change between them. `forget(device)` drops one.
- `stop()` stops following the connection and leaves the client open.

## What is stored

Two kinds of document, reached by name, so nothing is declared on the store:

- `inbox:<user>`: `{ items }`, the last `keep` (200) items, oldest first. An item is `{ id, at,
  level, title, body, url, tag, readAt, delivery }`, primitives and `delivery` as JSON text.
  `notify/Inbox` shares it under the topic `inbox` on every connection of the user and refuses
  every commit from the page.
- `devices:<user>`: `{ devices: { <id>: { platform, transport, endpoint, seenAt } } }`, at most
  `perUser` (20). Never shared on a link: an endpoint is where a person can be reached.

The battery truncates its own documents' tails, since nothing replays them.

## Configuring it

Each module is configured the way any battery module is (design 240): a same-named file
exporting `config` in a source before this one. `notify/Send` holds the channels:

```ts
// modules/notify/Send.ts
export const config = {
	levels: { info: ['inbox'], warn: ['inbox', 'push'], error: ['inbox', 'push', 'email'] },
	email: { resend: { key: process.env.RESEND_KEY, from: 'Acme <hello@acme.test>' } },
	push: { fcm: { account: process.env.FCM_ACCOUNT } },
	perHour: 100,        // sends one recipient may get in an hour; the next is refused `capped`
	outward: true,       // false refuses email and push just before the sender or pusher is called, your own function included
	private: true,       // a push carries no text unless the send says otherwise
	address: null,       // (user) => email, for users kept somewhere other than user:<id>
	timeoutMs: 10_000,   // per network call
};
```

`email` is `{ resend: { key, from } }`, or your own `(mail) => Promise<Delivery>` taking
`{ to, subject, text, html, replyTo }`, or `null`, in which case the channel answers `{ ok:
false }` naming the setting. `push` is `{ fcm: { account } }` with the service account key file
as JSON or base64 on one line (base64 survives an environment file that eats backslashes; JSON
does not), or your own `(data, endpoints) => Promise<PushOutcome[]>` answering one entry per
endpoint in the order given (an entry with `stale: true` forgets that device), or `null`. Your own
function is awaited for `timeoutMs` and no longer. The FCM adapter forgets a device the service
answers `UNREGISTERED`, `SENDER_ID_MISMATCH` or 404 for, and keeps one it answers
`INVALID_ARGUMENT` for, since that is also what a message too large gets. A level given
in `levels` merges over the defaults for the others. A value of the wrong type is
`invalid-config` at load.

`notify/Inbox` takes `keep` (200) and `idleMs` (60000, how long an inbox is held open after
the last connection or send). `notify/Devices` takes `perUser` (20) and `endpointBytes` (1024).

## What it never does

Decide who may send to whom: an application with users who install other people's apps writes
its wall, its consent and its per-sender caps in the module that calls `send`. Cap a sender: the
one cap is per recipient, a promise to the person, and the battery cannot know who asked. Own a
template. Decide whether a `url` is a safe link. Send without being asked. Answer a route. Share a
device endpoint with a page. Store a provider key or a service account anywhere but the
configuration.

## Known limits

- One process. The per-recipient cap is counted in memory, so a restart clears it and a second
  process has its own count, and the inbox is held open in one process; two processes over one
  store need a note of their own.
- The inbox keeps `keep` items and the oldest fall off; an application that wants every
  notification kept writes them somewhere of its own.
- A page cannot yield after a refused write: the client's handle offers no resync, so a page
  that wrote into `items` holds its own version until the next connection. Do not write into it.
- Resend and FCM are the two adapters that ship. Another provider is a function in the
  configuration today; one that needs a dependency, SMTP over a mailer for one, is a subpath and
  an optional peer when it is built (design 140).
- The FCM adapter sends a data-only message the application's own service on the device draws.
  A device with no such service shows nothing for it; `message.notification`, which the system
  draws, is deliberately never sent.

The design note is in
[`docs/design/`](https://github.com/torrinworx/aweft/tree/main/docs/design), 268.
[`recipes/notify`](https://github.com/torrinworx/aweft/tree/main/recipes/notify) is the whole
thing in one small application, two pages of one user in a browser against two fake services.
