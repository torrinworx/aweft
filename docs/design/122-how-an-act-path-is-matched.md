# 122: How an act path is matched

## Decision

An act key is a path with no leading slash. `''` is the index. A segment is either literal text, a
`:name` that takes one segment, or a `*name` that takes the rest. At most one `*name`, and it is
last. Nothing else: no optional segments, no regular expressions, no type constraints.

Matching a path against the declared keys runs in this order.

1. **The exact key wins.** A key whose whole text equals the whole path is the match, with no
   parameters and no tail. So `acts['posts/new']` beats `acts['posts/:id']` at `/posts/new`
   whatever the second rule would say, and a key with a slash in it can be written flat.
2. **Otherwise both are split on `/` and compared segment by segment.** A literal segment must be
   equal. A `:name` takes any one segment that is there. A `*name` takes every segment left, none
   included.
3. **The best candidate wins**, comparing two candidates in this order:
   - the class of each segment in turn, literal beating `:name` beating `*name`, on the first
     position where they differ;
   - then the pattern with more segments, which is the more specific of the two.
4. **`fallback` is matched last.** It is a name in `acts`, not a component prop and not a second
   concept. When no key matched a path that had something in it, `current` is the `fallback` name.
   An empty path with nothing declared for it gets `initial` instead, because a stage whose parent
   consumed the whole URL has not failed to match anything.

**What a match hands back.** The act's name; `params`, a plain object of the `:name` and `*name`
values, each one `decodeURIComponent`ed; and the tail, the segments the pattern did not take,
joined with `/`. The tail is design 123's business.

**A key that cannot match is refused where it is declared**, not left to fail silently at run time.
Refused: a leading slash, a trailing slash, an empty segment (`a//b`), a `:` or `*` with no name
after it, more than one `*rest`, and a `*rest` that is not last. Refused as well: two keys that
match exactly the same paths, meaning the same literal segments with the same kind of segment in
every other position, `a/:x` beside `a/:y`. One of those two can never win, and the assert names
both keys, because neither one is the wrong one on its own.

**A query value is text.** Writing the query cell with anything else is an assert naming the fix.
A number written into the URL comes back as text on the next navigation, so a cell that held a
number would quietly stop agreeing with the URL it is supposed to be.

**The query is not matched on.** It is a cell on the stage value, holding the current query as a
plain object of strings. An act writing that cell writes the query into the URL with `replace`, so
a filter a user changes ten times leaves one history entry and back leaves the page rather than
walking the filter backwards. The path, the parameters and the hash are untouched by a query write.

## Why

The exact-key rule first, because a path is a string before it is a list of segments, and a key
that is written out in full is an author saying exactly which URL they mean. Without it,
`posts/new` and `posts/:id` are decided by the class comparison alone, which gets the same answer
here and does not get it when the literal sits further along.

Literal over `:name` over `*name` is the order of how much the author said. Comparing position by
position rather than counting classes, because a total is not an order: `:a/x` and `x/:a` have the
same counts and mean different things, and the one that is specific earlier is the one that should
win.

More segments as the tiebreak, so `posts/:id/edit` wins over `posts/:id` at `/posts/3/edit` rather
than leaving `edit` parked for a child stage that does not exist.

`replace` for the query rather than `push`, because a query is usually the state of a control on
the page rather than a place the user went to.

## What this costs

An application that wants an optional segment declares both keys. An application that wants a
pattern does the test inside the act and calls `open` itself. Both were considered against a
matcher that grows syntax and rejected: syntax in a route table is a language nobody asked to
learn, and every rule in it is a rule the static walk has to reproduce.

## What would reverse this

A real application whose URL shape cannot be written in these three segment kinds without
declaring more keys than a person can hold in their head.

## Amended

An act key may end in a bare `*` (design 279). It matches any path, takes no segment and no
parameter, and parks everything from it as the tail for the stage below: `*` alone at
`/a/b` hands back no parameters, `''` taken and `a/b` as the tail; `docs/*` at
`/docs/guide` takes `docs` and parks `guide`. Its class is the `*name` class, so a literal or
a `:name` beats it, and `*` beside `*name` (or `a/*` beside `a/*rest`) is refused as two keys
that match the same paths. A `*` that is not last is refused like a `*name` that is not last.
`''` still matches `/` only, and at `/` it is the exact key, so it wins over `*` when both are
declared.

An earlier amendment had a `*name` park its rest as the tail while still taking it as its
parameter. It was withdrawn: the room's stage keyed its act on `*rest`, the rest was a
parameter, and a parameter change rebuilds the act (design 123), so every navigation inside
the room built the act again and its component state went with it. A `*name` takes every
segment left and leaves an empty tail, exactly as written above. Only a bare `*` parks.
