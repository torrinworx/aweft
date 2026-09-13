# 121: The router is a `dom` subpath with one history path

## Decision

`@aweftjs/dom/router` is a second entry on `dom`'s exports map. It carries `createRouter`, the
`Router` it returns, `RouterOptions`, `ScrollPosition` and `LinkRoot`, and nothing else. A page
that never routes never loads the file.

**One history path.** `popstate`, `pushState` and `replaceState`. The Navigation API is not used,
though the Chromium the gate installs has it. Both paths would have to be kept working and tested
for one feature neither the router nor `Stage` asks for.

**The seam.** Everything the router does to a browser goes through one internal interface: read
the current URL and entry state, push, replace, go back, listen for an entry change, read and
write a scroll position, read and write session storage, and take over clicks under a root. Two
implementations sit behind it. The browser one is built from `globalThis.window`, read once when
`createRouter` runs. The other keeps a stack in memory.

So the router with no `window` is not a router with its effects switched off; it is the same
router over a different implementation of the same interface. `push`, `replace` and `back` all
move the `url` cell, which is what lets a static render open the right acts and a headless test
drive a whole navigation. `links` returns a working unsubscribe that removed nothing, `saved()`
answers null and `restore()` answers false, because no page has a scroll position.

There is no option for handing in an implementation of your own. `createRouter({ url, base })` is
the whole signature, and a test that wants the memory one runs where there is no `window`.

**The entry key.** Every entry the router writes carries `{ key }` under one field of the
history state, so a foreign state object keeps its own fields. `replace` keeps them too: it is
still the same entry, so what somebody else wrote on it is still theirs. A `push` is a new entry
and starts from nothing. An entry the router did not write
(the first load, or someone else's `pushState`) is stamped with a key by `replaceState` the first
time the router sees it. Keys count up from a counter in `sessionStorage`, so a reload does not
mint a key an entry already in the back stack is using.

**Scroll.** `history.scrollRestoration` is `'manual'` in a browser. Positions live in
`sessionStorage` under the entry key, written before a navigation leaves an entry and before the
entry change a `popstate` reports. The router restores nothing on its own: it answers `saved()`
and does what `restore()` is told, and the policy of when to use them is `Stage`'s (design 125).
`dom` decides nothing about components.

**Anchor clicks.** `links(root)` takes over `click` under `root` and returns its unsubscribe. It
leaves alone: a click with a modifier key held, any button but the primary one, an event something
else already prevented, an anchor with `target` (other than `_self`), `download`, or
`data-no-route`, any href that is cross-origin, another scheme, or outside `base`, and **an href
that is the page showing now with a different hash on it**.

That last one is not a refusal, it is the right owner. A fragment link changes no act, so taking it
over would push an entry nothing acts on and the target would never be scrolled to: a page measures
`scrollY` 0 after such a click, against 1555 on a cold load of the same URL. The
browser scrolls to the target and writes the entry, and Chromium reports it through `popstate`, so
the `url` cell follows a URL this router never pushed.

## Why

A subpath rather than a package: history is a browser API, `dom` is the browser package, and a
package whose whole content is one file of history glue is not a package. It is the same reasoning
that made `@aweftjs/build/loader` a subpath (design 110).

One interface with two implementations rather than a browser check at each call site, because the
no-window behaviour is a stated feature and not a fallback: the static render path and every Node
test of the router run on it, so it is the implementation that gets exercised most.

The key in the entry state rather than in a table here, because the table cannot survive the back
button. An entry the user reaches by pressing back twice has to answer with the key it had going
forward, and the only place that survives is the entry itself.

## What this costs

The deep-import rule in `.dependency-cruiser.cjs` allowed exactly one file per package,
`src/index.ts`, so `ui` importing `@aweftjs/dom/router` read as a reach into `dom`'s internals. The
rule now reads each package's `exports` map and allows the files it names, which is what the rule's
own comment always said it meant. A file that is not on the exports map is still refused.

`createRouter` reading `globalThis.window` means a Node test that wants the browser path installs a
fake `window` around the call and takes it away after. That is the price of keeping the signature
at two options.

`push` and `replace` refuse a path that already starts with `base`, which also refuses the real
path `/docs/api` on a site whose base is `/docs` and whose first segment is `docs` again. There is
no way to tell that apart from the mistake, and the mistake (a doubled base, a URL nothing answers)
is the common one. `links` is not checked this way, because it works its own path out of the base
already.

## What would reverse this

An application needing two routers over one history, or a second history implementation worth
shipping, either of which would turn the internal interface into an option on `createRouter`.

## Amended

The `state` cell on `Router`, and the `state` parameter of `push` and `replace`, are dropped.
Nothing in `ui` or the routed-site recipe read them, and the point of a subpath that
tree-shakes to nothing is to stay small. The entry the router stamps now carries `{ key }` alone.
Foreign fields on the history state are still preserved, unchanged.

What would bring them back: a caller that needs per-entry data the URL cannot carry, such as a
scroll offset inside a virtual list or the record a modal was opened from, where re-reading it
from the URL is not the same value.

The half of the seam that says where the URL and its entries live is an option now:
`createRouter({ entries })`, with `Entries` exported as a type (design 279). Scroll, storage
and clicks are not part of it; they still come from the window when there is one and from
memory otherwise. The second history implementation this note said would open the seam is a
document shared across a sandbox wall.
