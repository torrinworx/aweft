# 289: A person holds names, and a module declares what it needs

Amends designs 071 and 074. Design 057 stands: the core validator knows no actor and no role.
What is added here is a battery module, in the application's `sources` or not, and a word the
auth gate reads.

## Decision

**A name is the one kind of thing a person can hold.** A role and a feature are the same kind:
`admin`, `verified`, `posts.delete`, `products.abc123`. A name is non-empty text with no
whitespace. Names are dotted, and holding a name covers every name under it: holding
`products` covers `products.abc123.read`, holding `products.abc123` covers one product, and
`*` covers everything.

**`auth/Roles`** is a server module in the `auth` source. It keeps `roles:<user>` documents,
`{ names: string[], modifiedAt }`, and offers to any module that names it in `deps`:

- `may(user, name)`: true when the person holds the name, holds a name that covers it, or
  holds a name the table says implies it, transitively. Every call reads the store. There is
  no cache and no per-connection snapshot: a grant or a revoke is seen by the next check.
  Text that is not a name is held by nobody, and the page's `may` answers the same.
- `grant(user, ...names)` and `revoke(user, ...names)`, which write the document; `names(user)`,
  what was granted and nothing implied.
- `first(user)`: grants the configured `first` names to the first person to sign up, and
  `auth/Enter` calls it for a user it creates. A marker document, `auth:first`, says whether
  a first sign-up has been seen: the first call to find it absent writes it, and two calls in
  flight together open the same live document, so one of them is the first. Made on a store
  where people already exist and no marker does, the module writes the marker for nobody, so
  an application that configures `first` after its first users exist hands nothing to the
  next stranger. Two processes over one store can each see a first, as two sign-ups for one
  email can both succeed.
- Config: `implies`, a table from a name to the names it implies (`{ admin: ['*'], member:
  ['products.read'] }`), empty by default and merged over by the application's own
  `modules/auth/Roles.ts` the way every battery module is configured (design 240); `first`,
  the names the first user is granted, empty by default. A table whose keys or values are not
  names is `invalid-config` at load.
- A `call` answering `{ implies }` to any signed-in connection, and a `connection` hook that
  shares `roles:<user>` under the topic `roles`, refusing every commit: the page reads it and
  never writes it.

**The resolver is one pure function**, `holds(granted, implies, name)`, exported from the root,
used by the server module and by the client half. An application that already holds a list
runs the same check over it. The table is built with no prototype, so a name that is also a
property of `Object` is a name in it.

**`auth/Gate` reads one more word.** A module declaring `needs: 'posts.delete'`, or `needs:
['a', 'b']` meaning every name listed, is refused to an anonymous connection with code
`private`, and to a signed-in user who lacks a name with code `needs`, the message naming the
module and the name. `public: true` is not read when `needs` is present: a module that needs a
name needs a person. A `needs` that is neither a name nor a list of names is refused to
everyone, with code `needs` naming the mistake: a word that reads as narrow and admits broadly
is the wrong way to fail. The gate asks `Roles.may` per connection, call and request, so it
`deps` on `auth/Roles`. Anything finer than a module, a row or a button, is a module of the
application asking `imports.Roles.may` itself.

**The page half.** `auth/Session` on the client gains `names`, a read-only cell that reads
`undefined` until the socket has answered, `[]` for an anonymous connection, and the granted
list otherwise, following the shared document while the socket is open; and `may(name)` over
it with the table the `auth/Roles` call answered. Both are for showing and hiding. The server's
gate is the only trust boundary, and a page that hides a button changes nothing about what the
server refuses.

**Verification is a grant.** `auth/Verify` (design 290) grants `verified` once the person has
clicked the link, so a module that wants a verified person says `needs: 'verified'`. There is
no `verified: true`, no `admin: true`, and no second gate word.

**What is never decided here.** Which names exist beyond `verified`, and what any of them
means. Who grants: no route ships, and a grant comes from a module of the application inside
the process, which is where the security suite's V8.2.3 case already says one has to come from.
Whether a name expires. Who reads another person's names: `roles:<user>` is shared with its own
user only.

## Why

Every application on the stack wrote the same administrator gate: a document naming who is
allowed, a composed gate reading a word off the module, a page-side wrapper checking the role
(design 244 counts four of them, two carrying it twice). The word differed (`admin`,
`probeReserved`, `role`), the document differed, and the page half was copied by hand each time.
One module with one word ends the copying without the library deciding anything an application
would want to: it holds the list and reads it, and the application says what goes in it.

One vocabulary rather than two. A role system and a permission system are two tables, two
kinds of grant and two checks, and the join between them is where every such system grows its
special cases. Dotted names with prefix cover give the tree for free: `admin: ['*']` is a
role, `products.read` is a feature, `products.abc123` is one product, and `may` is one
function over all three. The per-product case (a person who may read some products and not
others) is what a separate permission table is usually built for, and it is a grant here.

Live rather than fixed per connection. Identity is fixed per connection (design 074) because
a cookie cannot change under an open socket. A grant can, and a revoke that waits for the
person to reconnect is a revoke that has not happened. A check is one document read; an
application that loads this battery has said the read is worth it.

The page reads the document rather than asking. A cell that follows the share is what makes a
button appear the moment an administrator grants the name, with no reconnect and no poll, and
it is the same shape `state` already has.

## What this costs

One store read per gated check. A module with no `needs` costs nothing new. A route that is
hit hard and gated by a name pays a document read per request; the reversal below is for the
day that read is measured to matter.

The `auth` source is one module longer, and the gate depends on it. A loader that stubs the
gate's imports stubs one more.

A table keyed by exact names. Holding `admin.super` is not holding `admin`, so an application
that wants a hierarchy of roles writes it in the table (`'admin.super': ['admin']`) rather than
expecting the prefix rule to read upward.

## Evidence

`recipes/backend` and the security suite were each carrying the composed gate this replaces,
and the four applications design 244 names carried the page half. The predecessor's role was
one field with one value (`role: 'admin' | null`), and its applications grew per-item rules
beside it as validation code.

## What would reverse this

A measured gate check that costs more than the route it guards on a real driver: then a
document held open per connection, still live through the share, in place of a read per call.
An application whose names cannot be written as dotted text with prefix cover: then a second
vocabulary, as a note of its own. A second word the gate needs to read: that would say `needs`
was not general enough, and the fix is a name, not a word.
