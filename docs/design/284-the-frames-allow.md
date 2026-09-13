# 284: The frame's `allow`

Amends design 069. The frame runner still claims exactly the browser's boundary; what changes
is that an application may open the frame's content security policy for what a page needs,
and only that.

## Decision

`iframe()` gains `allow`:

```ts
interface FrameAllow {
	styles?: boolean;               // style-src 'unsafe-inline'
	images?: readonly string[];     // img-src <inside origin> data: blob: <origins>
	fonts?: readonly string[];      // font-src <inside origin> data: blob: <origins>
	media?: readonly string[];      // media-src <inside origin> data: blob: <origins>
}
```

`styles: true` adds `style-src 'unsafe-inline'`. Each list adds its directive with the inside
module's origin, `data:`, `blob:` and the origins named, so an application serving its own
assets writes `images: []` and one that also loads avatars from a CDN names it. A list that is
absent adds no directive, so the default `default-src 'none'` still refuses that kind.

**What never widens.** `script-src` stays `'unsafe-inline' data:` plus the inside origin.
`connect-src` is never written, so it stays under `default-src 'none'`: a room has no
network, whatever it may paint. The sandbox attribute stays `allow-scripts` alone.

## Why

`ui` paints in the frame with `style-src 'unsafe-inline'` and not without it (measured: the
theme's `<style>` is refused under the compute room's policy with three CSP errors and the
button paints browser-default grey; with the directive the theme applies and there are no
errors). The theme is a `<style>` element the sheet writes (design 257), so a page in a room
needs inline styles or it needs nothing else.

Images, fonts and media are what a page shows; scripts and connections are what a room must
not have. The line is drawn between the two by directive rather than by a policy string the
application passes whole, because a whole string would let `connect-src` in by accident, and
the runner would no longer be able to say what it stops.

## What it costs

`'unsafe-inline'` for styles means a module in the room can write any CSS, including
`url()` values that would fetch if `img-src` allowed them. That is why each list is a list of
origins and not a boolean.

A room that shows an image from an origin the application did not name gets a broken image
and a CSP report in the frame's console, not an error the host hears.

## What would reverse this

An application that needs `connect-src` in a room, for a module that must fetch. That is not
a widening of `allow`; it is a room with a network, which is a different runner claim and a
note of its own.
