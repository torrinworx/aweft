# 141: One icon is a virtual module, and `build` rewrites a literal name into it

## Decision

**`@aweftjs/icons/<set>/<name>` is one icon and nothing else.** It is a module nobody wrote: the
vite plugin and the Node loader make its source on demand from the set the application installed.
The source is one object literal, a few hundred bytes (over Lucide: median 325, largest 978), so
a page that names ten icons carries ten icons and not a set.

Three shapes are generated, and `@aweftjs/icons/node` is the generator for all three:

| the import | what the module is |
|---|---|
| `@aweftjs/icons/<set>` | the whole installed set as an `IconPack`, with its root size |
| `@aweftjs/icons/<set>/<name>` | one icon as `IconData`, an alias followed once, the root size applied |
| `@aweftjs/icons/<set>/+standard` | the standard names that set has, as an `IconPack` (design 142) |

`@aweftjs/icons/node` answers all three through one function, `moduleFor(request, from)`, where
`request` is what follows `@aweftjs/icons/` and `from` is the directory to resolve
`@iconify-json/<set>` from. It answers null for anything else, which leaves that import to
ordinary resolution. The grammar of these imports lives there rather than in `build`, so the
`+standard` spelling is written down once and `build` matches a prefix and hands the rest over.

**Both of `build`'s entry points hold the hook.** The plugin gains `resolveId` and `load`; the
loader gains `resolve`. An application still registers one plugin and one loader. A page built by
vite and the same page rendered in Node have to name an icon the same way, so neither entry point
can be the only one that knows how.

**A hook asks the generator before it claims the import.** `moduleFor` answering null is what says
"this is not a request", and a hook that claimed first could not act on that answer afterwards: the
specifier is gone by then and only the generated id is left. So both hooks call `moduleFor` while
resolving, and hand the specifier back untouched when it answers null. `@aweftjs/icons/..` is then
Node's own `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than a module read out of a directory that holds
no set. A refusal is different: a set or a name the generator recognises but cannot find belongs to
`load`, where the module being built has a name, so a throw while resolving still claims the
import. That is why `resolveId` is async.

**`build` rewrites a literal name on `Icon` into that import.** In a file that binds `Icon` from
`@aweftjs/ui`, and binds it only by that import:

```tsx
import { Icon } from '@aweftjs/ui';
<Icon name="lucide:check" />
```

compiles to

```tsx
import _icon0 from '@aweftjs/icons/lucide/check';
import { Icon } from '@aweftjs/ui';
<Icon name={_icon0} />
```

and `h(Icon, { name: 'lucide:check' })` is rewritten the same way, in place, with only the string
replaced. The generated name dodges every name the file mentions, and one name written twice in a
file is imported once.

**What is left alone.** A name with no colon in it, which is a standard name and goes through
`Icons` at run time. A name that is not a string literal. A spread that could carry `name`. An
`Icon` bound from anywhere but `@aweftjs/ui`, or rebound after its import. In each case the source
comes out as it went in and the lookup happens at run time, which is what `Icons` is for.

The rewrite is the only thing in `build` that knows a component's name. `build` already knows two
specifiers (`@aweftjs/dom` and `@aweftjs/ui`, design 108) and this adds one export name to the
second, not a vocabulary.

## Why

The build step is what makes only named icons reach the bundle. Measured: whole Lucide is 588 KB
raw and 88 KB gzipped, one icon is a few hundred bytes (over all 1,884 of its icons, through
`moduleFor`: 185 smallest, 325 median, 337 mean, 978 largest), and the recipe page's own bundle is
about 40 KB. Importing the set to name three icons costs more than
the page.

A per-icon package published for every icon in every set is the alternative, and it exists in the
wild: 8.4 MB and 1866 files for one set. It was not picked, because a page that also wants a name
known at run time would then carry both a set and per-icon files.

Generating the module rather than writing a file per icon means no icon data is in this repo at
all, which is the thing design 144 is about: the stack ships no drawings.

The literal rewrite happens on the element's properties, before hoisting, so it costs the same
whether the element hoists or not, and a rewritten file is byte for byte the unrewritten one apart
from the import and the one prop.

## What this costs

An icon named with a literal is resolved at build time, so a typo in the set or the name is a
build failure rather than a run-time assert. That is the intent, but it moves the error: a page
that would have shown nine icons and asserted on the tenth now does not build.

The virtual modules only exist where the plugin or the loader is registered. Plain `node
page.tsx` with no loader cannot resolve `@aweftjs/icons/lucide/check`, and says so with Node's own
message. The exports map deliberately does not name the pattern, because a real file there would
be a second answer to the same import.

A set named `node` could never be reached, because `@aweftjs/icons/node` is the generator's own
subpath: `iconRequest` in `packages/build/src/icons.ts` hands it to ordinary resolution and Node
answers `ERR_PACKAGE_PATH_NOT_EXPORTED`. No published set has that name.

## What would reverse this

A bundler-independent way to publish one icon per module that costs no more than the set, at which
point the rewrite could import a real file and the plugin hooks would go.
