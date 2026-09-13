# 268: The notify battery

## Decision

`@aweftjs/notify` is a battery: a source of three server modules that send a notification to a
person over the channels its level picks, keep an inbox per user in the application's own store,
shared live on every connection of theirs, and record what each channel did; and a client half
that hands a page the inbox and registers a device for push. Email and push are delivery attempts;
a channel that fails is written into the record and never loses the message or throws out of the
send. Nothing sends until a module calls `send`, and no route ships. It decides nothing about who
may send to whom.

**The server modules**, configured the way every battery module is (design 240):

- `notify/Send` is the broker. `send(options)` for any module that names it in `deps`. The
  recipient is `to: { user }` or `to: { email }`: a user's address is read off `user:<id>`, the
  auth battery's documented shape, unless the configuration hands in `address(user)`. `title` is
  required and cut at 200, `body` at 2000, `tag` at 64, `url` at 2000; `level` is `info`, `warn`
  or `error`, `info` by default, and picks the channels from `levels` unless `channels` names
  them; `html` and `replyTo` reach the email channel only, and the default html is the escaped
  title and body in two paragraphs; `private` says whether a push carries the text, from the
  configuration by default. The answer is `{ id, at, delivery }`, one delivery entry per channel
  tried: `{ ok: true, ... }`, `{ ok: false, error }` or `{ skipped }` naming why. The inbox and
  push need a user, and the inbox needs a store: an address recipient skips both, a server with no
  store skips the inbox. A channel that throws is recorded as `{ ok: false }` with its message.
  It refuses, in the stack's shape, `invalid-notification` (no title, a level or channel it does
  not know, a recipient of neither shape) and `capped` past `perHour` for one recipient. The
  configuration and defaults: `levels` `{ info: ['inbox'], warn: ['inbox', 'push'], error:
  ['inbox', 'push', 'email'] }`; `email` null, or `{ resend: { key, from, endpoint? } }`, or a
  function taking the mail and answering a delivery; `push` null, or `{ fcm: { account, endpoint?,
  tokenUrl? } }` with the service account as JSON or base64 on one line, or a function taking the
  message and the devices; `perHour` 100, counted in memory per recipient; `outward` true, and
  false refuses every network channel just before the network call so every local step still
  runs and a test sends nothing; `private` true; `address` null; `timeoutMs` 10000 per network
  call. A value of the wrong type is `invalid-config` at load.
- `notify/Inbox` is the keeper. Private. `connection` opens `inbox:<user>` and shares it under
  the topic `inbox`, refusing every commit from the page with `read-only`: the inbox is the
  server's record of what was sent. `append(user, item)` and `delivered(user, id, record)` for
  the broker, the first trimming to `keep` (200) oldest first and the second writing the record
  onto the item once the channels have answered. `call({ read: ids | 'all' }, context)` writes
  `readAt` on the caller's own items and answers `{ marked }`; anything else is `invalid-call`.
  An item is `{ id, at, level, title, body, url, tag, readAt, delivery }`, primitives and
  `delivery` as JSON text. The document is opened once per process and held while a connection or
  a send holds it, and let go `idleMs` (60000) after the last, so a send to a user with no page
  open is one open, one commit and one close.
- `notify/Devices` holds `devices:<user>`. Private. `call({ register: { device, platform,
  transport, endpoint } } | { forget: { device } }, context)`: at most `perUser` (20) devices, a
  `device` id of one to sixty-four letters, digits, dashes and underscores, `platform` one of
  `android`, `ios`, `desktop`, `web`, `transport` one of `fcm`, `none`, `endpoint` at most 1024
  bytes, a `seenAt` stamped on every register. `list(user)` and `forget(user, device)` for the
  broker. The document is never shared on a link: an endpoint is where a person can be reached,
  and a page that can read every endpoint of a user can hand them on.
- **The push adapter** is FCM v1 with no dependency: a JWT signed RS256 with `node:crypto`, the
  access token cached until five minutes before it expires, one POST per device, data-only, at
  `HIGH` priority, with `n` (the id), `p` (private), `t`, `b`, `u`, `l` and `g` (the tag). Under
  `private` the title and body are a generic line and the page reads the text from the inbox. A
  device the service answers `UNREGISTERED`, `SENDER_ID_MISMATCH` or 404 for is forgotten on the
  spot; `INVALID_ARGUMENT` is not among them, because the service answers it for a message too
  large as well as for a malformed token. A sender or pusher of the application's own is awaited
  for `timeoutMs` and no longer, and a pusher answers one entry per device in the order it was
  handed them; a missing entry is that device's failure.
- **The email adapter** is Resend with no dependency: one POST with `from`, `to`, `subject`,
  `text`, `html` and `reply_to`, Resend's own message in the record on a refusal, and a timeout
  named as one.

**The client half.** `createInbox(client)` answers `{ items, unread, ready, read, register,
forget, stop }`. `ready` asks `notify/Inbox` first, so an anonymous page hears the gate's
`refused` at once rather than waiting for a topic the server never offers; then it settles with
the shared document. One client has one live view, handed back again until it is stopped or its
`ready` was refused, because the server offers the topic once per socket and a second share of
the name would wait forever; a page stops its view before `enter` or `leave` and makes a new one
on the socket they open. `items` is the document's list, `unread` a derived count of items with no
`readAt`, `read(ids?)` marks those or all, `register` and `forget` reach `notify/Devices`, and
`stop` stops following the connection and leaves the client open.

**What is stored.** `inbox:<user>` `{ items }` and `devices:<user>` `{ devices }`, ordinary
documents through the ordinary store, reached by name so no path is declared; the battery
truncates its own documents' tails, since nothing replays them.

**What it never does.** Decide who may send to whom: an application's wall, its consent and its
per-sender caps sit in the module that calls `send`. Decide whether a `url` is safe to render as a
link. Own a template. Send without being asked. Pick a URL. Store a password, a provider key or a
service account in a document. Share a device endpoint with a page.

## Why

Two applications carry a notification system of their own and both have the same broker at the
centre: one send, a record per channel, a channel that never throws, an inbox that is the
notification and channels that are attempts at delivering it. What differs is the policy around
it, who may reach whom and how often, and that is the part a library cannot know. So the battery
is the broker and the policy stays in the application, which is the rule every battery keeps.

The inbox is a document rather than a table because the live half is then free: the store hands
every opener in a process the same document, `sync` carries a commit to every connection sharing
it, and a page that opens later reads it from the store. A table would need a fan-out of its own
and a seed on every connect. The page cannot write it because the inbox is the record of what
was sent, and `readAt` goes through a call so the one write a page may make is the one the module
checks.

The inbox is a channel and not a rule, unlike the applications' own brokers, because a
verification mail and a contact form both need email with no inbox at all, and a server with no
store has nowhere to put one.

The recipient is a user or an address because one of the two applications has no users: its
notification goes to whoever runs the site. A user's address is read off the auth battery's user
document because that is where the stack keeps it, and `address` in the configuration is for an
application whose users live elsewhere.

Push and email are inside the package rather than optional peers because neither needs a
dependency: both are `fetch`, and the push token is `node:crypto`. Design 140 is for a package
the stack can use but must not require, and there is none here. A second email provider that
needs one, SMTP over a mailer, is that case and goes on a subpath.

The one cap is per recipient because that is the promise a library can make to a person, that no
send reaches them more than so many times an hour, whoever asked. A cap per sender needs to know
who the sender is, an agent's module or a stranger's address, and that is the application's.

## What this costs

A send is one document open, one commit and one truncation on the inbox, plus one network call
per network channel, in turn, each bounded by `timeoutMs`; a send to a user with three devices is
three push calls. A module awaiting `send` waits for all of them.

The cap is in memory, so a restart clears it, and a second process has its own count. This stack
runs one process per store, and a cap that survived a restart would need a document of its own.

An inbox holds `keep` items; the oldest fall off and nothing keeps them. An application that wants
every notification kept writes them somewhere of its own.

A push under `private` says nothing but that something happened, so a phone with the app closed
shows a generic line. That is the default because the alternative sends the text through the push
service.

The service account is parsed on every send rather than once, so a rotated key takes effect on
the next send; the token exchange is cached, which is the expensive half.

## Evidence

`packages/notify/tests/`: `send.test.ts` (the level map, a named channel list, the inbox skipped
for an address and for a server with no store, the delivery record on the item, a channel that
throws recorded and the send resolving, the cap and a second recipient under it, `outward` off
reaching no network, `invalid-notification` and `invalid-config` with their fixes), `inbox.test.ts`
(two connections of one user hearing a send live, a page's commit refused with `read-only`,
`read` marking the caller's own items and answering `{ marked }`, the trim to `keep`, the
document let go after `idleMs`), `devices.test.ts` (register, the caps, forget, never shared),
`adapters.test.ts` (each adapter against a server on localhost: the request body, the error
message carried, the timeout, which answers mark a device stale, the token cached), `client.test.ts`
(`ready` refused for an anonymous page, `unread`, `read`, `register`, one live view per client, a
stop before `ready`), `surface.test.ts`. The stale token forgotten by a send, the private swap, a
sender or pusher of the application's own bounded and its answers counted per device are in
`send.test.ts`. `recipes/notify` drives two pages of one user in Chromium
against a fake Resend and a fake FCM and asserts the whole path.

## What would reverse this

A second process sharing one store, which needs the cap and the inbox open in one place. A
provider that needs a dependency, which is a subpath and an optional peer (design 140), not a
change here. A need for the history past `keep`, which is a document per notification found by a
declared path, and this note would say why the inbox moved.
