# @aweftjs/ui

Components and theming on top of `@aweftjs/dom`. `h` is `dom`'s `h` plus the handful of things
that need to know where the element sits: its theme, its state cells, its listeners. A theme is
data you define once and match against, not a stylesheet you write. Everything one page owns is
one object made per render, so a build can render two pages at the same time and neither can see
the other's classes.

## Quickstart

```tsx
import { h, mount } from '@aweftjs/ui';
import { mutable } from '@aweftjs/core';

const Counter = () => {
	const clicks = mutable(0);
	const hovered = mutable(false);
	return (
		<button theme={['button', hovered.bool('hovered', null)]} isHovered={hovered}
			onClick={() => clicks.set(clicks.get() + 1)}>
			clicked {clicks} times
		</button>
	);
};

mount(document.body, <Counter />);
```

`recipes/ui/` is the whole of this README as a running page. `npx vite recipes/ui` serves it.

## Source is `.tsx`

This package's own source is `.tsx`, compiled by this stack's own transform. JSX becomes plain
`h` calls resolved by ordinary scope, so `h` has to be in scope in every file that writes JSX.
Node cannot load `.tsx` on its own, so a suite that imports one runs with
`node --import @aweftjs/build/loader`; the root gate does that for you.

An application bundles with `aweft()` from `@aweftjs/build`, which is one line in a vite config
and is what `recipes/ui/vite.config.ts` shows. Pass `aweft({ defaultH: '@aweftjs/ui' })` if your
pages are `ui` pages: a file that writes JSX and imports no `h` of its own is given one, and
without that setting it is `dom`'s, which writes `theme` out as an attribute nothing reads.

**Getting the packages.** Nothing is published to a registry yet. An application takes this repo
as a git submodule and its own package manager resolves `@aweftjs/*` through the workspace, which
is how the five applications that use the stack do it. A program written outside a checkout has
nothing to resolve those specifiers to, so `recipes/` and the tests live inside the repo.

## `h`, `svg` and `html`

`h(tag, props, ...children)` is `dom`'s, with eight prop names taken off it:

| prop | what happens |
|---|---|
| `theme` | a string, a list, a cell, or lists of those; flattened at mount into a class list and matched against the theme |
| `class` | kept, and joined in front of the classes the theme generated. Without a `theme` it is an ordinary attribute |
| `style` | an object (or a string); a bare number in a size property gets `px`, and `$var` and `$fn()` resolve against the element's own theme chain |
| `isHovered`, `isFocused`, `isClicked`, `isTouched` | a cell this package writes from real events |
| `onClick`, `onInput`, `onKeyDown`, … | `on` and an uppercase letter: a listener, removed when the element unmounts |

Everything else goes to `dom` unchanged: a bare name is an attribute, `$name` is a property.

An element with none of those is `dom`'s `h` exactly, node and all, so
`const box = h('div', { class: 'box' })` is an element. **An element with any of them is a
mounter, not a node**: the theme it gets depends on where it is mounted, and `dom` hands the
mount context to a mounter and to nothing else. Hand it to `mount` as you would anything else.

`svg` is the same in the SVG namespace, with no theme: `class` and `style` stay plain attributes.
`html` is `dom`'s template-literal tag bound to this `h`.

On a component, `each:name` renames the loop item: `<Row each:row={rows} />` hands each item to
the component as `props.row` rather than `props.each`.

## The theme

A theme is a flat object whose keys are `_`-joined selector paths.

```ts
Theme.define({
	'*': { $brand: '#1b6ef3' },
	tile: { padding: '$space4', borderRadius: '$radius', background: '$brand' },
	tile_flat: { boxShadow: 'none' },
});
```

An element's `theme` prop flattens to a class list with `*` in front of it. **An entry matches
when its segments appear in that list in order, with gaps allowed.** So `card_hovered` matches an
element themed `card primary hovered`, and `hovered_card` does not match anything themed
`card hovered`. Entries are ordered by where their last segment matched, ties going to the longer
entry, and later in that order wins.

**Values.** `$name` is a variable, `$fn(a, b)` is a call, `$$` is a literal `$`, and `$size$px`
is the variable followed by the text `px`. A bare number in one of `sizeProperties` gets `px`.
What a variable holds is text, and that text is not read again: `$a: '$b'` writes the four
characters `$b` into the CSS rather than following them. Point a declaration at the variable you
mean.

**Variables and functions are the same namespace.** A `$name` whose value is a function is a
function; anything else is a variable. Both are found by walking the matched chain from the most
specific entry down, so a generic entry writes `background: '$hover'` once and every component
supplies its own `$hover`. And because a function is theme data, an application defines its own
and a nested theme replaces one:

```ts
Theme.define({ '*': { $em: (args) => `${Number(args[0]) * 16}px` } });
```

The colour functions (`$shiftBrightness`, `$brightness`, `$saturate`, `$hue`, `$alpha`,
`$invert`, `$contrast_text`, `$luminance`) and the arithmetic ones (`$add`, `$sub`, `$mul`,
`$div`, `$mod`, `$min`, `$max`, `$floor`, `$ceil`, `$round`, `$if`) ship in the default theme, so
every one of them can be replaced the same way. A `$name(` nothing defines is written back out as
it was read, so `calc()` and `rgb()` survive untouched.

**Directives** live inside an entry, keyed `_name_rest`:

| directive | compiles to |
|---|---|
| `extends: 'other'` or `['a', 'b']` | what it extends applies first, so this entry wins over it; a list starting `*` replaces the inherited one |
| `_elem_button` | `button .awN { … }` |
| `_children_span` | `.awN > span { … }` |
| `_cssProp_focus` | `.awN:focus { … }`; a pseudo-element gets `::`, and a key written with its own colons is used as written |
| `_media_(min-width: 40em)` | that entry's body inside the query |
| `_keyframes_spin` | `@keyframes spin-<id>`, with `$spin` bound to the generated name |
| `_fontFace_body` | `@font-face { … }` |
| `_import_fonts` | `@import url(…) layer(aweft);` |

`@font-face`, `@keyframes` and `@import` are emitted once per definition per render rather than
with the entry's own rules, so two class chains reaching one entry emit the font once.

**Every rule is inside `@layer aweft`, and this package ships zero `!important`.** Unlayered
styles beat every layer, so an application's own stylesheet overrides the library with a one-class
selector and no specificity fight. `packages/ui/tests/browser.test.ts` asserts that in Chromium.

**Two themes on one page.** `<Theme value={partial}>` merges a partial theme onto whatever is
above it for its subtree, and that subtree generates its own classes. `<ThemeContext value="brand">`
is different: it sets a prefix that `ThemeContext.use(h => component)` puts in front of every
`theme` an element below asks for. An element with no `theme` prop stays plain; write `theme=""`
to take the cascade and nothing else.

Values in a generated class are literals, not custom properties.

## The per-render object

```ts
const ui = context();
const body = await render(<App />, { context: ui });
const page = `<!doctype html><html><head><style data-aweft>${ui.theme.markup()}</style></head><body>${body}</body></html>`;
```

`mount`, `render` and `hydrate` each make one and thread it through `dom`'s context. It carries
`theme` (this render's class cache and stylesheet), `ids` (the counter behind an
`aria-labelledby`, counting from zero per render so a server and a browser agree), `popups`, and
`head` and `stage`, which step 18 fills.

`mount` puts the stylesheet in the document head and takes it back out when it unmounts.
`hydrate` adopts the one the server wrote rather than making a second. `render` returns the item's
markup only; the CSS is `context.theme.markup()`, which the page puts in its own head.

Two `mount` calls into one page share that page's render, so two widgets on one page cannot mint
the same class name for two different themes. Passing a `context()` by name asks for a render of
your own instead, which is what a static render wants; two named renders in one page each count
their classes from zero.

**A theme mismatch across a hydration is not reported.** `dom` catches a structural mismatch
loudly, but if the client's theme registry says something different from the server's, the client
rewrites the adopted `<style>` and says nothing. Define your theme in a module both sides import.

Reaching a `ui` system from a mount that has none is an assert naming what to call instead.

## Contexts

```ts
const Tone = createContext('plain');
const Label = Tone.use((tone) => (props) => <span theme={['label', tone]}>{props.children}</span>);

mount(document.body, <Tone value="accent"><Label>hi</Label></Tone>);
```

`createContext(def, transform)` returns the provider, with `def`, `read(context)`,
`node(context)` and `use(build)` on it. `transform(raw, parentValue, children)` runs on first read
and again after `raw` changes; `raw` arrives exactly as written, so a cell arrives as a cell.

A node has `id`, `parent`, `children` and `value()`. `children` is an observable array in mount
order, so something above can watch what appears below it. `node(context)` answering null is how a
component asks whether there is a provider above it at all.

`node(context)` reads the tree **at that point**, not from the root: the node it answers is the
nearest provider above the mount whose context you handed it, and `parent` walks up from there.
There is no way in from outside, and that is the design: to introspect from elsewhere, capture a
context inside the tree (a component's fourth argument, or a mounter's) and start from that.

## Marks

A component that takes more than one slot of children reads them with `mark` and `categories`.

```tsx
<Shown value={open}>
	<p>shown</p>
	<mark.else><p>hidden</p></mark.else>
</Shown>
```

A mark is a value, never a node, and never reaches `mount`. Inside a component:

```ts
const [popup, anchor] = categories(props.children, ['popup', 'anchor'], 'anchor');
```

Each category has `items` and a `props` merged from every mark of that name. An unknown slot, or
a bare child with no default slot, is an assert naming the slots the component knows.

`mark.name` is declared for the six slots this package reads (`then`, `else`, `case`, `default`,
`popup`, `anchor`). Any other name works at run time; in a TypeScript file write it as
`mark('name', props, ...children)`.

## Control flow

`Shown` takes a condition, a `then` (the default slot) and a `<mark.else>`, with `invert` to flip
it. `Switch` takes a `value` matched against `<mark.case value=…>` with a `<mark.default>`, or a
`cases` object of cells where the first truthy key wins. Neither builds an element or keeps state.

## Loading

```tsx
const Article = suspend(Spinner, async ({ id }) => <Body article={await fetchArticle(id)} />, ErrorPanel);
```

The fallback shows, the loader runs, and what it resolves to replaces the fallback. The promise is
declared `pending`, so a static render waits for it.

**A rejection never leaves the fallback on screen.** The call's own `failed` component shows it,
or the `LoaderContext`'s, and with neither the slot goes empty and the rejection is rethrown so
the host reports it. `LoaderContext` carries `{ loading, failed }` and inherits them one field at
a time.

## Popups

```tsx
<PopupContext>
	<App />
</PopupContext>

<Detached enabled={open}>
	<button onClick={() => open.set(!open.get())}>menu</button>
	<mark.popup><Menu /></mark.popup>
</Detached>
```

`PopupContext` renders its children and then the popups, so a popup is after the page in DOM
order. The first one on a page takes the render's own sink; a second one, nested or beside it,
makes its own, so a nested `PopupContext` renders its popups at the end of its own subtree rather
than at the end of the page. That is what it is for: it is how a dialog keeps its own popups
inside itself. `Popup` renders nothing where it is written and puts its element in that sink. `Detached`
measures its own children, scores twelve placements and picks one, re-measures every animation
frame, and closes when the anchor moves, on the reading that the page scrolled.

**There is no `z-index` in this package.** A popup asks for the top layer with the `popover`
attribute where the host has one, and falls back to DOM order where it does not. Below the top
layer a page with its own stacking context can put something over a popup, and that is the page's
decision to make.

`trackedMount()` is how `Detached` measures children it does not own: it returns the array the
real nodes appear in and a mounter to render where they belong.

**`Detached` needs a real browser to open.** It places its popup from the anchor's measured
rectangle and asks for the next animation frame, and the light tree has neither layout nor frames.
So in Node, and in a static render, a `Detached` renders its anchor, and its popup's children are
in the markup inside a `display: none` container rather than left out of it. That is the right
server output, and it is also why the interaction tests for it are in
`browser.test.ts` rather than in the light tree. `Popup` on its own has no such need: give it a
placement and it renders where you put it, anywhere.

## Other exports

`InputContext` is where an input event goes: `InputContext.fire(context, 'click', payload)` calls
the generic `on` and then `on<Type>`, with the application's `meta` merged in last. `useAbort(fn)`
runs `fn` with a fresh `AbortSignal` and hands back the abort. `sizeProperties` is the set of
property names a bare number is given `px` for.

## The look

A default theme ships in light and dark. It is what makes `theme="button"` a button, and it is the
contract a component of this package is allowed to use. Designs 115 to 120 are the whole of it.

**Three colour scales**, `neutral`, `accent` and `danger`, twelve steps each, `$neutral1` to
`$neutral12` and so on. The steps follow one job list: 1 and 2 are backgrounds, 3 to 5 component
fills by state, 6 to 8 lines, 9 and 10 solids, 11 and 12 text.

**Seventeen roles**, each set from one step. A component uses a role, never a step:

| role | pairs with | what it is for |
|---|---|---|
| `$background` | `$foreground` | the page |
| `$surface` | `$surfaceForeground` | a raised block |
| `$muted` | `$mutedForeground` | a quiet fill, and quiet text on any background |
| `$accent` | `$accentForeground` | a filled control |
| `$accentSubtle` | `$accentSubtleForeground` | a tinted control |
| `$danger` | `$dangerForeground` | a destructive control |
| `$dangerSubtle` | `$dangerSubtleForeground` | a warning block |
| `$border` | | the line around a block |
| `$input` | | the edge of a control |
| `$ring` | | the focus ring |

Every pair meets WCAG 2 AA in both modes, 4.5:1 for text and 3:1 for a line, asserted in
`packages/ui/tests/contrast.test.ts` with a ratio the test computes itself.

**Type** is `$textXs`, `$textSm`, `$textMd`, `$textLg`, `$textXl` and `$text2xl`, in `rem`, each
with `$textXsLine` and so on beside it. `$font` and `$fontMono` are the families.

**Sizes** are `$space` (4px) and its six multiples, `$space2`, `$space3`, `$space4`, `$space6`,
`$space8` and `$space12`, with no step between them; `$radius` and `$radiusLg`; `$target` (24px,
the smallest a pointer target may be); and `$borderWidth`, `$ringWidth` and `$ringOffset`.

**Motion** is `$fast`, `$slow`, `$ease` and `$easeOut`. Nothing in this package sets a transition
of its own: the root sets one, inside `@media (prefers-reduced-motion: no-preference)`, so a
person who asked for less motion gets none and no component has to remember the query.

**States are one rule.** `hovered` and `pressed` lay a translucent tint of the element's own
foreground over whatever background it has, at two fixed strengths. No component names a hover
colour, and there is no ripple. `disabled` clears the tint.

**Focus is one rule.** The root gives every themed element `outline: $ringWidth solid $ring` on
`:focus-visible`. Nothing here writes `outline: none`.

**The entries it ships.** These are the theme names a component of this package, or of yours, can
ask for. Everything else is yours to define.

| entry | what it is for |
|---|---|
| `button` | a filled control: the accent fill, its foreground, a 24px minimum height |
| `button_quiet` | the same control with no fill: a border and accent-subtle text |
| `button_danger` | the same control in the danger colours |
| `input` | a text field: the surface fill, the `$input` edge, a placeholder in `$mutedForeground` |
| `input_invalid` | that field with a danger edge |
| `select` | `input` again, with room on the right for the arrow the host draws |
| `card` | a raised block: the surface fill, a border, the larger radius, `$space4` of padding |
| `popup` | the same block at popup size: the smaller radius, tighter padding |
| `text` | body copy at `$textMd`, with no margin |
| `text_xs`, `text_sm`, `text_lg`, `text_xl`, `text_2xl` | that copy, one size step at a time |
| `text_mono` | that copy in `$fontMono` |
| `muted` | text in `$mutedForeground`, readable on any of the three backgrounds |

`hovered`, `pressed` and `disabled` are three more entries, and you put them in a class list
yourself: `theme={['button', hovered.bool('hovered', null)]}`. They match anywhere, so they apply
to any entry above. They are meant for the controls, `button` and its two variants, `input` and its
variant, and `select`; `card`, `popup`, the `text` sizes and `muted` have no state to show.

**Dark is a theme.** `dark` and `light` are partial themes handed to the provider:

```tsx
mount(document.body, <Theme value={dark}><App /></Theme>);
```

Either may nest inside the other, and each subtree resolves its own roles, because a provider's
subtree generates its own classes. Following the operating system is your call, in your own theme,
with the `_media_` directive the engine already has.

**No unnamed value.** A component of this package writes `$name`, never a colour, a size or a
duration. `node packages/testing/scripts/check-theme.ts` refuses one that does, over
`packages/ui/src` and `recipes/`, and `packages/ui/tokens.txt` is the committed list of every name
there is. A value with no name yet gets one in the entry that needs it:

```ts
Theme.define({ splash: { $splashHeight: '320px', minHeight: '$splashHeight' } });
```

Point the check at your own source to adopt the same rule; nothing makes you. A path is resolved
against the repository root, so an absolute one is taken as it is, and a path with no `.ts` or
`.tsx` file under it fails instead of passing over nothing.

```
node packages/testing/scripts/check-theme.ts /home/me/app/src
```

**Overriding it.** `Theme.define` adds to the theme; it refuses one property of one entry given two
different values, so it is not how you replace what the default already says. A `<Theme value={...}>`
provider is, and it is also what scopes an override to part of a page. Entry names the default
theme does not use are yours to define outright.

**A dev-mode warning.** When a chain resolves both `color` and `background` from named values and
the pair is below 4.5:1, this package says so in the console, with the ratio, the target and the
role to use. Theme-derived pairs only, and the call is not in a release build.

## What it never decides

Storage, transport, and anything server-side. Data fetching: `suspend` takes a promise and does
not make one. Upload transport. Auth. Where analytics go: `InputContext` fires and the application
listens. What your application looks like: a default theme ships so a bare `theme="button"` renders
as something readable, and every value in it is yours to replace. What your own components name
their own values, and whether you run the theme check. Routing and head tags, which are step 18.

## Boundaries

Tier 7, client plane. It imports `@aweftjs/core` and `@aweftjs/dom` and nothing else, and nothing
in the stack imports it.

Nothing at module scope here can be seen through from one page to another. The theme definitions
are the one store, and they are data written once at import. The rest is caches keyed on an object
the caller already holds: the tag identity behind each `<mark.name>`, what a theme says as a
string, and the merge of a render's own theme with a provider's. A page's own state, its class
cache and stylesheet, its id counter and its popup sink, is on the object each render makes.
The render every default `mount` into a page shares is kept on that page's document, not here.
