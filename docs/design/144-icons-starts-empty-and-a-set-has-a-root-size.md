# 144: `Icons` starts empty, and a set's root size applies to the icons under it

Amended: the cost of an empty stack is bigger than a bare `Icon`, and it is written down below.
Amended by design 219: where the animated spinner an application wants comes from, which is an
icon set like any other. No drawing ships.

## Decision

**The stack ships no drawings.** `packages/ui/src/icon-pack.ts` and the eight glyphs in it are
deleted. `Icons` starts as an empty stack, and every icon on a page comes from a set the
application installed or a pack it wrote. This withdraws the last paragraph of design 131 and the
earlier rule that a default pack ships.

**`IconPack` gains a root `width` and `height`**, and they apply to every icon in the pack that
carries none:

```ts
interface IconPack {
	readonly prefix?: string;
	readonly icons: Readonly<Record<string, IconData>>;
	readonly aliases?: Readonly<Record<string, IconAlias>>;
	readonly width?: number;   // the set's own box, applied to an icon that declares none
	readonly height?: number;
}
```

Without this every icon from a real set renders clipped. Lucide declares 24 by 24 at the set root
and 1865 of its 1866 icons carry no size of their own; `Icon` falls back to 16, so the drawing was
cut off at two thirds. mdi is the same shape. The rule is the sets' own and is applied everywhere
an icon is taken out of a set: here, in `@aweftjs/icons/node`, and in `fromUrl`.

**A name nothing answers asserts, and the assert says how to answer it.** With an empty stack the
old message ("no icon named check: 0 source(s) were asked") told a reader what happened and
nothing about what to do:

```
ui: no icon named lucide:check: 0 source(s) were asked. Wrap the page in <Icons value={pack}>
with a pack or resolver that has it; @aweftjs/icons gives you one from an installed set.
```

One sentence for every name, including a prefixed one. `ui` knows nothing about where a name comes
from: a prefix is a pack's prefix, not a package, so a `npm install @iconify-json/<prefix>` built
out of it would name a package that need not exist.

It asserts in development and is stripped from a release build, where the element renders nothing.
An icon that is missing is a typo, not a state, so nothing is drawn in its place.

**The catalogue names real icons.** `recipes/ui/examples/icon.example.tsx` names Lucide icons
through `@aweftjs/icons`, both the way the build resolves and the way a page's installed set
answers, which is what makes it a page that proves the seam rather than one that renders the
library's own drawings.

## Why

Icons of our own are the wrong thing for this stack to define, so they are removed.

Eight drawings that will never be a set are a maintenance surface with no upside: an application
that wants icons installs a set, and one that does not wants nothing. The reason they were drawn
in the first place was to avoid a dependency, and design 140 answers that properly, so the reason
is gone.

The root size is not a convenience. It is the format: a set states its box once and its icons
inherit it. Reading a set without it is reading it wrong.

## What this costs

A bare `Icon` renders nothing until the application supplies a source, and finds that out from an
assert in development. That is the intended shape, and the message carries the two ways to fix it.

**It is not only a bare `Icon`.** `DropDown`, `FileDrop`, `Modal` and `Validate` each mount an icon
by name of their own, so a page holding one of them and no `Icons` provider does not render at all.
Someone building a form hits `no icon named triangle-alert: 0 source(s) were asked` from
`Validate`'s default icon, from a component they never asked for an icon from, and the way around
it is to pass `icon` themselves. Confirmed at the source: a `Validate` mounted with no provider
throws that assert.

The behaviour stands, because the message already names both fixes. What was wrong is the
documentation: the README said the components ask for names in one sentence after the composites
table, which is not where a reader building a form is looking. The `Icons` section now says which
four components mount one, that a page with none of them asserts on its first render, and that
`icon` on the component is the other way out. Reversing the behaviour instead would mean shipping
drawings again, which is the thing this note exists to stop.

Any page in this repo that wanted an icon now depends on the icons recipe's set being installed.
The gallery is the one that does, and it declares it.

## What would reverse this

Nothing about the drawings. The root size would be reversed only by a set format that stops
declaring one, at which point the fields would stay and simply never be set.
