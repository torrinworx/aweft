# @aweftjs/icons

Icon sets as modules. Name an icon in your source and the build puts that one icon in your page;
name one when the page runs and a resolver fetches it. This package holds no drawings of its own
and never will.

```
npm install @iconify-json/lucide
```

The sets are optional peers, so nothing is installed until you pick one. Any published set works:
`@iconify-json/lucide`, `@iconify-json/mdi`, `@iconify-json/tabler`.

## Naming an icon in your source

```tsx
import { Icon } from '@aweftjs/ui';

<Icon name="lucide:check" label="done" />
```

`@aweftjs/build` rewrites that literal into an import of that one icon, a few hundred bytes (over
Lucide: median 325, largest 978), and `@aweftjs/icons` generates the module it imports. Nothing
else in the set reaches your page.

The rewrite fires for a string literal shaped `set:name`, on the `name` prop of the `Icon` your
file bound from `@aweftjs/ui`, written as JSX or as an `h(Icon, { ... })` call. Nothing else moves:
a name with no colon in it, a value that is not a string literal, a spread that could carry its own
`name`, and an `Icon` bound from anywhere else all come out as they went in and are looked up
through `Icons` when the page runs.

You can write the import yourself, and it is the same module:

```tsx
import check from '@aweftjs/icons/lucide/check';

<Icon name={check} />
```

Three subpaths exist, and all three are generated from the set you installed:

| import | what you get |
|---|---|
| `@aweftjs/icons/lucide/check` | one icon, as `IconData` |
| `@aweftjs/icons/lucide/+standard` | the names `ui`'s components ask for, as an `IconPack` |
| `@aweftjs/icons/lucide` | the whole set as an `IconPack`, about 588 KB of it |

The `+` in `+standard` is deliberate: no set can publish a name with one in it, so that path can
never be an icon you wanted.

They are not files, so they need `aweft()` in your bundler or the Node loader:

```ts
import { aweft } from '@aweftjs/build';
export default { plugins: [aweft()] };
```

and `node --import @aweftjs/build/loader` where you render a page without a browser. That is the
same plugin and the same loader that compile your JSX; there is nothing extra to register.

A set named `node` could not be reached this way, because `@aweftjs/icons/node` is the generator's
own subpath. No published set has that name.

## The names your components ask for

Everything in `@aweftjs/ui` that shows an icon asks for a name, never a drawing:
`chevron-down`, `chevron-up`, `chevron-left`, `chevron-right`, `check`, `x`, `triangle-alert`,
`search`, `upload`. The list is `standardIcons`, exported by `ui`.

```tsx
import { Icons } from '@aweftjs/ui';
import standard from '@aweftjs/icons/lucide/+standard';

<Icons value={standard}><App /></Icons>
```

That costs about ten icons rather than a set. To give one of those names a drawing of your own,
put a pack in front:

```tsx
<Icons value={[{ icons: { 'chevron-left': myOwnChevron } }, standard]}><App /></Icons>
```

The nearest source wins, so your pack answers and nothing else changes.

## A name you only have when the page runs

```tsx
import { fromUrl } from '@aweftjs/icons';

<Icons value={[standard, fromUrl('https://api.iconify.design')]}><App /></Icons>
```

`fromUrl(base)` fetches `<base>/<set>.json?icons=<name>` and reads the answer the public icon
APIs give. Point it at a route of your own to serve the icons yourself; `recipes/icons/main.ts`
has that route in about fifteen lines, built out of an installed set.

Nothing installs it. A page that never adds it makes no requests, because a fetch to somebody
else's service is a decision you make and not one a library makes for you.

It answers null for a name with no set in it, so `check` keeps being answered locally. A page
whose server fetched an icon has to hand the client what the server got, as a pack: a hydration
waits for nothing, so a resolver alone leaves the client one drawing short of the markup it is
taking over.

## When something is missing

A set you have not installed:

```
set-not-installed: the icon set "tabler" is not installed; run: npm install @iconify-json/tabler.
Install the icon set the message names, or hand a pack of your own to Icons.
```

A name the set does not have is `icon-not-in-set`, naming both. Both happen while the page is
being built, not while it is running, which is the point of naming an icon in your source.

A name nothing in your `Icons` stack answers is a loud assert from `ui` in development, and
nothing at all in a release build. The full list of refusals is `errors.txt`.

## What this package never decides

Which sets you install. Whether your page fetches anything. What an icon looks like. It ships no
icon data, and nothing in the gate reads this package for drawings. `npm run dependencies` at the repo root checks something else, that no icon set is a
dependency rather than an optional peer.
