# @aweftjs/build

The transforms. It compiles markup and JSX to `h` calls, replaces a static subtree with a
template made once and cloned per use, and removes assert calls from a release build. It
decides nothing else: not which bundler you use, not whether you write JSX, markup or `h` by
hand, not what a custom `h` does, and not when source that arrives at run time is compiled.

Nothing here is required. A page that writes `h` and markup runs with no build step at all;
this makes it faster and smaller.

## Quickstart

One implementation, two ways in.

```ts
// A bundler, rollup's shape, vite among them.
import { aweft } from '@aweftjs/build';

export default { plugins: [aweft({ release: process.env.NODE_ENV === 'production' })] };
```

```ts
// Anywhere, a browser included, for source that did not exist at build time.
import { transform } from '@aweftjs/build';

const { code, map } = transform(source, { filename: 'page.tsx', release: true });
```

Both produce the same bytes for the same input, and there is a fixture suite that says so
(`tests/modes.test.ts`). That equality is not a nicety: source validated by one transform and
executed by another can validate, be stored, and break when it renders.

## What it does to a file

### Markup in a template literal

A `` html`...` `` tag imported from `@aweftjs/dom` becomes `h` calls, so the page carries no
parser.

```ts
import { html } from '@aweftjs/dom';
const Note = (tone, text) => html`<p class="note ${tone}">${text}</p>`;
```

becomes calls to `h`, with the mixed attribute joined by `joined` from `@aweftjs/dom`, which
is the same function the runtime parser uses for it.

The dialect is `@aweftjs/dom`'s, unchanged. A tag may be an expression (`<${Component}>`), `</>`
closes the innermost open element, `<!-- ... -->` is a comment and goes, and `${value}` between
tags is a child. Inside a tag, these are all the forms there are:

| written | means |
| --- | --- |
| `hidden` | the attribute set to `true` |
| `id=plain` | the unquoted text up to the next space or `>` |
| `class="row ${tone}"` | the quoted parts as one value, joined by `joined` |
| `title=${t}`, `$onclick=${fn}` | the expression itself |
| `=${props}` or `${props}` | a spread: every key of the object becomes a prop |

A spread is the one form with two spellings. `=${props}` is the explicit one; a hole on its own,
with no name in front of it, means the same thing. Both compile to `{ ...props }`.

What compiling changes is when a mistake is reported: every fault the parser would have thrown at
render time is thrown here instead, as a `TransformError` carrying `at`, the offset in the file.
One check does not survive compilation, and it is named rather than hidden. The parser asserts
that a spread is an object; a compiled template writes `{ ...expr }`, which spreads whatever it
is handed. A string spreads as one attribute per character, so `=${'not a tag'}` renders
`<div 0="n" 1="o" 2="t" ...>` where the parser would have refused, and a number, `null` or
`undefined` spreads as nothing at all.

### JSX

JSX compiles to a plain `h(...)` call resolved by ordinary lexical scope.

```tsx
const Card = ({ title }) => <section class="card"><h1>{title}</h1></section>;
```

A lowercase tag with no dot in it is an element name; anything else is an expression, so
`<Item/>` and `<ns.Part/>` call whatever the surrounding code calls `Item` and `ns`. A
fragment, `<>...</>`, becomes an array of items, which is what `mount` takes.

`h` is imported from `@aweftjs/dom` **only when the file has no `h` of its own**. A file that
declares its own `h`, or imports one from elsewhere, keeps it, and its JSX compiles to that
one. That is what lets a component library ship its own `h`, its own theming and a wholly
separate definition without this package knowing anything about it.

### Static hoisting

The shape a source fixes becomes a template made once per document and instanced per use.
Element names, attributes whose value is a literal, and text go in the template; everything
else is applied to the instance.

```ts
const Row = (label, click) => h('tr', { class: 'row' },
	h('td', { class: 'a' }, label),
	h('td', { class: 'b' }, h('a', { $onclick: click }, 'go')));
```

becomes one `template(...)` at the top of the file and one call to it per row. Measured by
`bench/hoist.ts` in Chromium, 10,000 rows of that shape, best of five invocations of best of
seven: inside a mount, which is where a list builds its rows, 28.5 ms through the eight `h`
calls against 13.4 ms as one template instance. Outside any mount, which is where a page builds
the item it then hands to `mount` or `hydrate`, the same two are 43.1 ms and 29.8 ms, because
every node made there is marked as the binding's own so `hydrate` can adopt the server's markup.
For a clone that marking is a walk, and it is about 16 ms per 10,000 instances. A row built
during a mount that is not hydrating pays none of it. The loop for re-running the script is
`bench/README.md`.

**Hoisting only happens where `h` is provably `@aweftjs/dom`'s in that file.** JSX still
compiles to any `h`; only this substitution is restricted, because it assumes `dom`'s `h`'s
semantics. Four things are left as plain `h` calls:

- an element with a spread in its properties, which may carry `children` at run time
- an element given `children` as a property
- an element whose tag is not a literal name, a component included
- every element in a file that binds the name `h` anywhere except the one import from
  `@aweftjs/dom`

In the first three the subtree around the element still hoists, with the call as one of its
varying parts. The fourth is not one element but the whole file: a file that binds `h` itself
hoists nothing anywhere in it, including the elements the shadow never reaches. That is
deliberate, because following a shadow properly needs real scope analysis, and the blunt rule can
only be wrong in the direction of hoisting less.

### Assert stripping

With `release: true`, a statement that is nothing but a call to a name imported by name from a
neighbouring `assert` module is removed, and the import goes with it when nothing else in the
file still names it.

```ts
import { assert } from './assert.ts';   // removed with its last call
import assert from 'node:assert/strict'; // never touched
```

Three shapes stay: a default import (`node:assert` and friends), `assert` used as a value
rather than called, and a call whose value something reads, so `const ok = assert(x, 'm')`
keeps its initializer. To get your own asserts stripped, import them by name from a module
called `assert` next to the file.

## The release mangle

`mangle` is the configuration for renaming this stack's internal properties, in the pattern and
in the two shapes a minifier takes.

```ts
import { mangle } from '@aweftjs/build';

await minify(code, mangle.terser);   // or: build({ ...mangle.esbuild })
```

A property whose name ends in exactly one underscore is internal surface and may be renamed. A
property whose name **begins** with an underscore is runtime-private and must keep its name,
because a wildcard observer decides what it delivers by looking at the name. The two are never
the same rule. Nothing in the stack uses the trailing convention yet, so today this renames
nothing; it is here so that the rename, when it happens, is a rename and nothing else.

## What it never decides

Which bundler you use. Whether you write JSX, markup or `h` by hand. What a custom `h` does.
When source that arrives at run time is compiled, or by whom.

## Proven by

`examples/build/main.ts` builds a real page through the transforms, runs it in all three modes,
and checks that a release build of the binding's own source has no asserts left in it. The
package's own suite is the equivalence suite: every fixture runs twice, once as written and
once transformed, mounted, rendered and hydrated, over a document whose nodes clone and one
whose nodes do not.
