# 143: One resolver ships, it speaks the icon API's shapes, and nothing installs it

## Decision

**`fromUrl(base)` is the whole root entry of `@aweftjs/icons`.** It answers a resolver in the
shape `Icons` already takes, `(name) => Promise<IconData | null>`, and it is the only value the
root entry exports. A page that never fetches an icon loads one function it never calls.

**It speaks the shapes the public icon APIs already use**, so `fromUrl('https://api.iconify.design')`
works against a service nobody here runs, and an application that would rather serve its own
answers points it at a route of its own:

- the request is `<base>/<set>.json?icons=<name>`
- the answer is `{ prefix, icons: { <name>: data }, aliases?, width?, height?, not_found? }`
- a root `width` and `height` in the answer apply to an icon that carries none
- an alias is followed once, taking its own turns and flips on top

**A name with no set in it answers null.** The resolver has nowhere to send `check`, so it passes
the question on to the next source in the stack rather than guessing a set. Standard names
therefore keep being answered locally even with this resolver in place.

**Nothing installs it.** It is not in `Icons` by default and no component reaches for it. An
application adds it:

```tsx
<Icons value={[myPack, fromUrl('https://api.iconify.design')]}><App /></Icons>
```

A page that fetches drawings from a third party over the network is a policy, and a policy the
library turned on by itself would be one nobody chose.

**A failed request is a failed lookup, not a thrown error.** A non-200, a body that is not the
shape above, or a set that answers nothing gives null, and the stack asks the next source. A
network error is left to reject, and `Icon` reports it as the assert design 131 describes,
naming the icon and the reason.

## Why

A fetch-by-URL fallback is worth shipping, and it ships opt-in.

Speaking an existing API's shapes rather than inventing one means the default `base` is a real
service and the mirror is a route an application can write in an afternoon. A shape of our own
would have made both of those a port.

Answering null rather than throwing is what makes it usable as the last source in a stack: a
resolver that throws on a name it does not have would stop the lookup instead of passing it on.

## What this costs

Every name it is asked for is a request, and it does not cache. A page that resolves many names at
run time makes many requests, and the fix is to name them and let the build take them (design 141)
rather than to grow a cache here that an application cannot see or clear.

`fetch` is assumed to exist. It does in every browser and in Node since 18, and that is the only
thing the root entry needs from its host.

## What would reverse this

An application that needs the resolver to batch, cache, or retry, at which point those are
arguments to `fromUrl` rather than a second resolver.
