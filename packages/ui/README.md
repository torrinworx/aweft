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
| `isHovered`, `isFocused`, `isClicked`, `isTouched` | a cell this package writes from real events. `isFocused` is the element's own focus, and `isTouched` is a pointer event that says it was a finger |
| `onClick`, `onInput`, `onKeyDown`, … | `on` and an uppercase letter: a handler, handed to `dom` as `$on<type>` so a hydration replays it, and gone when its element goes. Your own `$onclick` beside it runs first |

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

**A class token holding `_` names one entry: that is how you reach a part.** A part is a different
element from its component, and it must not wear the component's own box, so `theme="card_title"`
reaches `card_title` and not the bare `card`. A modifier is a state or a variant of the same
element and stays a segment of its own, so `theme={['card', 'tight']}` reaches `card` and
`card_tight`. Both spellings mix: `theme={['card_title', 'muted']}` reaches `card_title` and
`card_title_muted`, and an element that wants a part and its component says both tokens.

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
| `_container_(min-width: 28rem)` | that entry's body inside a container query |
| `_starting_` | that entry's body inside `@starting-style`, the style a transition starts from. It takes nothing after the name |
| `_keyframes_spin` | `@keyframes spin-<id>`, with `$spin` bound to the generated name |
| `_fontFace_body` | `@font-face { … }` |
| `_import_fonts` | `@import url(…) layer(aweft);` |

`@font-face`, `@keyframes` and `@import` are emitted once per definition per render rather than
with the entry's own rules, so two class chains reaching one entry emit the font once.

**A directive block holds declarations and one more directive.** A `_media_` or a `_container_` may
hold a `_cssProp_` and a `_starting_`; a `_cssProp_` may hold a `_starting_`. That is what lets a
dialog's `::backdrop` fade: its transition has to reach `.awN::backdrop` and has to stay inside the
reduced-motion query. A third level compiles to nothing, and an enclosing rule is dropped wherever
its own body came out empty. `_keyframes_`, `_fontFace_` and `_import_` leave the entry body rather
than wrapping the rule, so they are read at the entry's own level only.

**A declaration whose value is a list is emitted once per item, in order.**
`appearance: ['none', 'base-select']` writes `appearance: none; appearance: base-select;`, and a
host that cannot read the second keeps the first. That is the only way an entry, which is an
object, can say one property twice.

**Every rule is inside `@layer aweft`, and this package ships zero `!important`.** Unlayered
styles beat every layer, so an application's own stylesheet overrides the library with a one-class
selector and no specificity fight. `packages/ui/tests/browser.test.ts` asserts that in Chromium.

**Two themes on one page.** `<Theme value={partial}>` merges a partial theme onto whatever is
above it for its subtree, and that subtree generates its own classes. `<ThemeContext value="brand">`
is different: it sets a prefix that `ThemeContext.use(h => component)` puts in front of every
`theme` an element below asks for. An element with no `theme` prop stays plain; write `theme=""`
to take the cascade and nothing else.

Values in a generated class are literals, not custom properties. The element's `class` attribute
holds one minted name per distinct list, not the segments themselves, and that name's rules are
written one block per matched entry, so a stylesheet has as many blocks for `.aw1` as entries
matched it.

## The per-render object

```ts
const ui = context();
const body = await render(<App />, { context: ui });
const page = `<!doctype html><html><head><style data-aweft>${ui.theme.markup()}</style></head><body>${body}</body></html>`;
```

`mount`, `render` and `hydrate` each make one and thread it through `dom`'s context. It carries
`theme` (this render's class cache and stylesheet), `ids` (the counter behind an
`aria-labelledby`, counting from zero per render so a server and a browser agree), `popups`,
`head` (the page's head tags, and `head.markup()`) and `stage` (one entry per live
`StageContext`).

`render` holds the head list and the stage list for the length of the call, so a caller can read
both after the page has been taken down. A render object is therefore for one page.

`mount` puts the stylesheet in the document head and takes it back out when it unmounts.
`hydrate` adopts the one the server wrote rather than making a second. `render` returns the item's
markup only; the CSS is `context.theme.markup()`, which the page puts in its own head.

Two `mount` calls into one page share that page's render, so two widgets on one page cannot mint
the same class name for two different themes. Passing a `context()` by name asks for a render of
your own instead, which is what a static render wants; two named renders in one page each count
their classes from zero.

**A component hydrates by identity, and the elements it makes on the way are dropped.** `hydrate`
builds the client's tree and pairs it against the nodes the server wrote, keeping the server's; the
fresh elements it made to compare against are thrown away. So a hydration is not free of
`createElement`, and counting those calls counts the client's tree, not a defect.
`packages/ui/tests/controls.test.ts` pins both halves: every server element is kept by identity, and
nothing the client made ends up in the page.

**A hydrated page is live.** Nothing this package computes is written onto an element: a handler is
a `$on<type>` property and the class and the style are cells handed to `dom` as attributes, and
`dom` carries all three onto the node the hydration adopted (design 133). So a click, a keystroke,
a focus, a hover, a theme cell and an inline style all reach the page a server sent.
`browser.test.ts` clicks, types, focuses and hovers for real in Chromium and reads the hovered tint
back off the button the server wrote.

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

`use(build)` calls `build` **once per mount of the component it hands back**, with the value read at
that mount's own place in the tree. So two mounts under two different providers each get their own
component, and a mount already on the page does not call `build` again when the value above it
moves. A value that moves is read with `read(context)` or held in a cell the built component
follows, not through `use`.

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

`mark.name` is declared for the eight slots this package reads (`then`, `else`, `case`, `default`,
`popup`, `anchor`, `tabs`, `panels`). Any other name works at run time; in a TypeScript file write
it as `mark('name', props, ...children)`.

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

**Every wait in this package shows the same loader** (design 219). `suspend` while its loader runs,
a `Button` while a promise its `onClick` returned is pending, and a `FileDrop` entry an application
moved to `status: 'loading'` all show `LoaderContext.loading`, and `LoadingDots` when nothing named
one. So naming a loader once names it for all three:

```tsx
<LoaderContext value={{ loading: MySpinner }}><App /></LoaderContext>
```

No drawing ships (design 144). `LoadingDots` is three spans and a keyframes block; for an animated
spinner, `@aweftjs/icons` says which set to install and shows the one line that puts it here.

## Popups

```tsx
<PopupContext>
	<App />
</PopupContext>

<Detached enabled={open}>
	<button onClick={() => open.set(!open.get())}>details</button>
	<mark.popup><Card>what floats</Card></mark.popup>
</Detached>
```

Everything that floats is a popup: a `Tooltip`, a `Menu`, a `Select`, and `Popup` itself. Every one
of them has somewhere to go without being told. A popup's sink is the nearest `<dialog>` above where
it was written, then the sink a `PopupContext` gave it, then the element the page was mounted into.
So a page needs no wrapper to open one, and a menu opened inside a modal draws inside that dialog,
which is what makes its rows clickable: a dialog's top layer swallows every pointer event aimed at
anything outside it.

`PopupContext` is how a page chooses a sink on purpose. It renders its children and then the popups,
so a popup is after the page in DOM order. The first one on a page takes the render's own sink; a
second one, nested or beside it, makes its own, so a nested `PopupContext` renders its popups at the
end of its own subtree rather than at the end of the page. `Popup` renders nothing where it is
written and puts its element in whichever sink it found. `Detached` measures its own children,
scores twelve placements and picks one, re-measures every animation frame, and closes when the
anchor moves, on the reading that the page scrolled.

**There is no `z-index` in this package.** A popup asks for the top layer with the `popover`
attribute where the host has one, and falls back to DOM order where it does not. Below the top
layer a page with its own stacking context can put something over a popup, and that is the page's
decision to make.

`Detached` mounts its anchor where the anchor was written and reads the anchor's nodes back out of
the document, so a page taken over from a server adopts the anchor the server sent (design 153).
`trackedMount()` is the other way of reaching children a component does not own: it returns the
array the real nodes appear in and a mounter to render where they belong, and children mounted
that way are built fresh rather than adopted.

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

## What every component takes

Four props mean the same thing on every component in this package, controls, composites, display
pieces and grouping pieces alike.

- **`theme` appends your own segments** to the ones the component writes, so
  `<Card theme="tight">` is the card entry plus `card_tight` and `<Button theme={cell}>` follows a
  cell.
- **`class` appends** a plain class name, leaving the generated one alone.
- **`element` hands in the node to decorate** instead of building one. An `element` of the wrong tag
  is an assert naming both tags, because a `<div>` wearing a checkbox's theme is a checkbox that
  does nothing.
- **Anything else goes to the element**, so `id`, `aria-*` and a handler the component does not name
  land where you would expect them.

**Every state prop is a cell, or absent.** Given one, the component writes it and follows it; given
none, it keeps its own. A display prop takes a value or a cell. There are no imperative handles.

## Controls

Every control here is one native element with a theme on it. There is nothing in this package that
draws a control out of `div`s, so the keyboard, the role, the form participation and the autofill
are the platform's and not ours (design 128).

```tsx
import { Button, Select, TextField, Toggle } from '@aweftjs/ui';
import { mutable } from '@aweftjs/core';

const email = mutable('');
const problem = mutable(null);

<TextField label="Email" value={email} error={problem} description="Work address" />
<Toggle label="Email me" value={subscribed} />
<Select label="Owner" value={owner} options={users} display={(user) => user.name} placeholder="Pick someone" />
<Button label="Save" onClick={() => save(email.get())} />
```

| component | the element | its own props | `size` | example |
|---|---|---|---|---|
| `Button` | `<button>`, or `<a>` with an `href` | `label`, `type`, `icon`, `iconPosition`, `disabled`, `loading`, `round`, `inline`, `href`, `hrefNewTab`, `onClick`, `track` | `sm`, `lg`, `icon`, `icon-sm`, `icon-lg` | `button` |
| `TextField` | `<input>`, in a `<div>` on `input_group` when it was given an addon | `value`, `label`, `description`, `error`, `leading`, `trailing`, `placeholder`, `password`, `onEnter`, `onKeyDown`, `disabled`, `type` | `sm`, `lg` | `text-field` |
| `TextArea` | `<textarea>` | the same, plus `maxHeight` | `sm`, `lg` | `text-area` |
| `Checkbox` | `<input type="checkbox">` | `value`, `label`, `invert`, `indeterminate`, `disabled`, `onChange` | `sm`, `lg` | `checkbox` |
| `Radio` | `<input type="radio">` | `value` (the group's), `option` (this one's), `label`, `disabled`, `onChange` | `sm`, `lg` | `radio` |
| `Toggle` | `<input type="checkbox" role="switch">` | `value`, `label`, `disabled`, `onChange`, `type` | `sm`, `lg` | `toggle` |
| `Slider` | `<input type="range">` | `value` (a number), `min`, `max`, `step`, `disabled`, `track` | `sm`, `lg` | `slider` |
| `Select` | a `<button role="combobox">` in a `<span>` with its arrow, over a hidden `<select>` | `value`, `options`, `display`, `placeholder`, `open`, `disabled`, `name`, `autocomplete`, `onChange` | `sm`, `lg` | `select` |
| `LoadingDots` | three dots | `type`, `size`, `label` | a CSS length | `loading-dots` |
| `Icon` | `<svg>` | `name`, `size`, `label`, `rot` | a CSS length | `icon` |

The last column is the file under `recipes/ui/examples/`, without its `.example.tsx` ending. Each
one renders every state, type and size of its component, in both modes, on a page of its own at
`catalogue.html#/<Component>`, and the recipe's driver reads it there (designs 197 and 226).

**`size` is one theme segment, right after `type`** (design 194): `sm` is 32px tall, nothing is
36px and `lg` is 40px, and the entries are `button_sm`, `input_lg`, `checkbox_sm` and so on, the
same way `quiet` and `danger` are. A small control takes the smaller text step with it. `Button`
also takes `icon`, `icon-sm` and `icon-lg`, which are a square of that height with no padding, for
a button whose label is an icon. It is a value or a cell, like every other display prop.
`LoadingDots` and `Icon` have a `size` of their own, which is a CSS length and not this axis.

**A label is what gives a control a name.** Give one and the component renders a `<label for>` next
to the element, both inside one `<div>`, mints the ids off the render (so a server and its hydration
agree), and wires `aria-describedby` and `aria-invalid` for you. Give none and you get the bare
element, and naming it is yours. `packages/ui/tests/controls.test.ts` finds every control by its
role and its name.

**One document is one render.** The ids come off the render's counter, which starts at zero every
time (design 109), so two named renders mounted into the same document mint the same ids and their
labels point at each other's controls. Two `mount` calls into one page share that page's render and
do not collide; a second `context()` is a second render and belongs in a second document.

**What a control starts with is in the markup.** `Checkbox`, `Radio` and `Toggle` write the state
they start in as the `checked` attribute; `TextField` writes its text as `value` and `TextArea` as
its content. So a server page shows a ticked box and a filled field before any script runs. The
property follows the cell once the page is alive, which is what the platform does with these
attributes too: they say what the control started as, not what it holds now.

**An `error` cell is announced when it arrives.** While it says something the control carries
`aria-invalid`, its `aria-describedby` names the message, and the message is a live region. Once the
error clears the attribute is removed rather than set to `false`.

**A promise makes a button busy.** A promise `onClick` returns disables the button and shows the
`LoaderContext` loader until it settles, however it settles, so a double click cannot submit twice.

**A radio group is a group because its members share a `name`**, minted once per `value` cell. So
the arrow keys, the wrapping and the roving focus are the platform's. `browser.test.ts` presses
the real keys: Space on a checkbox, the arrows in a radio group, Home and End on a slider.

**`TextField` takes `leading` and `trailing`, and builds a box only when it was given one**
(design 210). With neither, the markup is the `<input>` and nothing else. With either, the input
goes inside a `<div>` on `input_group` that carries the border, the radius, the fill and the height,
and the input carries none of them, so the two read as one control. The focus ring is on the box, so
tabbing into the input rings the whole thing. Text is wrapped on `input_group_addon` for you, and
anything else is mounted as it is, which is what lets an `Icon` or a `Button` of `size="icon"` go
there.

```tsx
<TextField label="Price" leading="$" trailing="CAD" value={price} />
<TextField label="Search" leading={<Icon name="search" />} value={query} />
```

**`Select` draws its own list, on every host** (design 224). The closed control is a
`<button role="combobox">`; the open list is a `<div role="listbox">` of `<div role="option">` rows
in a popup placed under the control at the control's width. So it looks the same everywhere, the
theme reaches every part of it, and `open` is a cell you can read and write. The list goes where
every popup in this package goes, so it needs no wrapper above it.

It opens on a click, on ArrowDown, ArrowUp, Enter and Space, and on typing a letter, which opens it
and jumps to the first row beginning with that letter in the one press. Inside it the arrows move
and wrap, Home and End go to the ends, typing keeps searching, Enter and Space choose, and Escape
closes and gives the keyboard back to the control. The focus stays on the control the whole time
and `aria-activedescendant` says which row the keys are on.

**A hidden `<select>` sits under it**, off the screen and out of the reading order, carrying the
same options and the same choice. It takes `name` and `autocomplete`, so a form the control is in
posts the value and autofill has a real control to find; anything that writes it writes your cell.
What autofill cannot do is draw its own highlight over the button, because the element it filled is
one pixel square.

**`Select` holds items, not the text a row reads as.** `options` is a list of anything, `display`
says what a person reads, and the cell holds the item you put in the list, so adding, removing or
reordering leaves the choice on its own item. An item that is a string or a number carries itself as
the hidden option's `value`; an object carries none, and the platform then posts what the row reads
as.

**`Select` draws its own arrow** (design 195). Every host draws a different one and no theme can
reach any of them, so the entry tells every host to draw none and the component renders the control
inside a `<span>` with an empty box at the right of it. The `select_chevron` entry draws the arrow the
way `checkbox` draws its tick: a `$chevron` square with two of its sides in `$mutedForeground`,
turned a quarter turn. So it needs no icon pack, and an application that wants another arrow gives
`select_chevron` its own rules. It is `aria-hidden` and takes no pointer events, so a screen reader
reads the combobox and a click reaches the element under it.

**`Icon` is built from icon data**, in the shape the icon sets publish: `body`, `width`, `height`,
`left`, `top`, and optional `rotate`, `hFlip` and `vFlip`. `name` is that data, or a name looked up
through the `Icons` context.

**This package ships no drawings** (design 144). `Icons` starts empty, and an application supplies
a pack, a resolver, or both. This is not only about the `Icon` you write yourself: `DropDown`,
`FileDrop`, `Modal` and `Validate` each mount one of their own, by name, so a page that mounts any
of them and has no `Icons` provider above it asserts
on its first render rather than rendering without the glyph. `Validate` is the one that surprises people, because its icon is a default
nobody asked for. Give the page a provider, or give the component its own `icon` prop. (`Select`
needs none: its arrow is drawn by the theme, design 195.)
`@aweftjs/icons` turns an installed icon set into exactly that:

```tsx
import { Icon, Icons } from '@aweftjs/ui';
import standard from '@aweftjs/icons/lucide/+standard';

<Icons value={standard}><App /></Icons>
<Icon name="check" label="done" />
```

A provider stacks a pack or a resolver in front of what it inherited, newest first, so a pack an
application puts up answers before anything under it. A pack is
`{ prefix, icons, aliases?, width?, height? }`, where the root `width` and `height` are the box
every icon in it that states none is drawn in; the sets state it once at the root, so without it a
real set renders clipped. A resolver is `(name) => data | Promise<data> | null`, and a promise is
declared `pending` so a static render waits for it. A resolver that answers null passes the name on
to the next source, and so does one that answers a promise of null, so a resolver in front of a
pack does not stop the pack behind it being asked. An icon with no `label` is `aria-hidden`,
because an icon beside the word it means is otherwise read out twice. A name nothing answers is an
assert naming the icon, how many sources were asked, and how to answer it: wrap the page in `Icons`
with a pack or resolver that has it.

**The components here ask for names, never for drawings.** `standardIcons` is that list, in the
spelling the sets publish: `chevron-down`, `chevron-up`, `chevron-left`, `chevron-right`, `check`,
`x`, `triangle-alert`, `search`, `upload`. Give one of them a drawing of your own by putting a pack of your
own in front, which is what `Icons` is for.

**Laying things out is a theme entry, not a component** (design 132): `row` and `column`, each with
`fill`, `center`, `start`, `end`, `spread`, `wrap` and `tight`, and `divider`. `center`, `start`
and `end` mean across the page on both.

```tsx
<div theme={['row', 'fill', 'spread']}><span>left</span><span>right</span></div>
```

`recipes/ui/catalogue.html` is every one of them in every state, in both modes, one page per
component at `#/<Component>`, driven in Chromium by `recipes/ui/main.ts` with axe-core over every
page.

## Laying a form out

There is no `Field` component. A form is the theme entries and a bare `<label>` (design 209): five
builders out of five reached past the components, for the same reason each time, so the components
went and the entries stayed.

```tsx
import { Checkbox, TextField } from '@aweftjs/ui';

<div theme="field_group">
  <fieldset theme="field_set">
    <legend theme="field_legend">Where to send it</legend>
    <div theme={['field', 'responsive']}>
      <label for="street" theme="field_label">Street</label>
      <TextField id="street" value={street} />
    </div>
    <div theme={['field', 'inline']}>
      <Checkbox id="post" value={post} />
      <label for="post" theme="field_label">Post it rather than email it</label>
    </div>
  </fieldset>
  <TextField label="Notes" value={notes} description="Anything else" />
</div>
```

| entry | what it lays out |
|---|---|
| `field` | one field: a control, whatever labels it, and whatever is said under it, in a column |
| `field_inline` | the same field as one `$control`-tall row |
| `field_responsive` | a column that turns into that row from 28rem of its container |
| `field_group` | the stack a form is, `$space6` apart, declaring itself the container above measures |
| `field_set` | the same stack on a `<fieldset>`, with the host's border, padding and minimum width off |
| `field_legend` | the `<legend>` inside one |
| `field_label`, `field_hint`, `field_error` | the three things written around a control |

**A control still labels itself.** `label`, `description` and `error` stay on the control, and a
control given any of the three wraps itself in its own `<div theme="field">`. So the last line of
the form above needs no box around it: a `Field` around a control that lays itself out is a column
of one thing.

**`field_inline` and `field_responsive` lay out the box's own children**, so they are for a bare
control and the `<label for>` you wrote beside it.

**`field_responsive` measures the nearest ancestor that declares itself a container**, which in this
package is `field_group` and nothing else. With no group above it, a query with no container answers
false and the field stays a column at every width.

**A label under an ancestor carrying `data-invalid` takes the colour its message has.** Nothing
writes that attribute for you; write it from the same cell you pass to `error` if you want it.

## Composites

Eight more components, each built out of the controls above and the behaviours underneath them.

```tsx
import { ColorPicker, Default, DropDown, FileDrop, Menu, Modal, Tooltip, Validate, ValidateContext } from '@aweftjs/ui';
```

| component | what it is | its own props | example |
|---|---|---|---|
| `Modal` | a stage template: the act inside a native `<dialog>` | `label`, `noEsc`, `noClickEsc`, `type` (`sheet`), `side` | `modal` |
| `Default` | the stage template that adds nothing | none | `modal` |
| `Tooltip` | `Detached` plus the hover and focus trigger | `label`, `enabled`, `locations`, `type` | `tooltip` |
| `DropDown` | a `<details>` whose `<summary>` wears the `button` theme | `open`, `label`, `icon`, `iconOpen`, `iconClose`, `arrow`, `name`, `type`, `disabled` | `drop-down` |
| `FileDrop` | a drop zone with a real file input in it | `files`, `extensions`, `multiple`, `limit`, `clickable`, `disabled`, `onDrop`, `ready`, `type` | `file-drop` |
| `Validate` | a check around a control, and the message it shows | `value`, `validate`, `signal`, `valid`, `error`, `showError`, `icon`, `type` | `validate` |
| `ValidateContext` | the form's answer: every `Validate` below it | `value` | `validate` |
| `ColorPicker` | a saturation and brightness square, the hue and the alpha as `Slider`s, and a swatch | `value`, `hasAlpha`, `disabled`, `type` | `color-picker` |
| `Menu` | a button and the list of actions it opens | `items`, `open`, `label`, `icon`, `type`, `size`, `disabled`, `locations` | `menu` |

These ask for `chevron-up`, `chevron-down`, `x`, `triangle-alert` and `upload` by name, so a page
using them answers those five through `Icons`; `@aweftjs/icons/<set>/+standard` does. A `Menu` asks
for none: its rows hold whatever `icon` you give them.

**A `Menu` is a button and the actions under it.** `items` is a list of
`{ label, icon?, type?, disabled?, onSelect }`, and `{ heading, items }` anywhere in that list draws
a small heading over its own group. `type: 'danger'` draws a row in the danger colour, which is what
a delete belongs in.

```tsx
<Menu label="Quick Actions" items={[{
	heading: 'Conversation',
	items: [
		{ label: 'Mute Conversation', onSelect: mute },
		{ label: 'Mark as Read', onSelect: read },
		{ label: 'Delete Conversation', type: 'danger', onSelect: remove },
	],
}]} />
```

The keys are the ones a `Select` has, because they are the same behaviour: the arrows move and wrap,
Home and End go to the ends, typing moves by what a row reads, Enter and Space choose, Escape and an
outside click close it, and Escape and choosing put the focus back on the button. The list is
`role="menu"` and the rows are `role="menuitem"`, named by the button. The list is in the page
while the menu is closed, inside the box the sink places, which is what hides it; a script that looks
for an open one asks by role with hidden elements left out, not for the first `role="menu"` it finds.

Opening it moves the focus onto the `role="menu"` element, which is where `aria-activedescendant`
names the row the keys are on. That is the ARIA menu-button pattern, and it is the only shape ARIA
allows: the attribute may not sit on the button that opened the menu. Escape and choosing a row put
the focus back on that button.

The anchor is the button this component builds, so the ARIA is in the markup rather than written
onto a node it does not own. Children go inside that button, and `element` hands one in. A group is
`{ heading, items }`, and a heading makes it one whether or not it has any items yet.

**A modal is a stage template, so back closes it.**

```tsx
stage.open({ name: 'edit', history: true, template: Modal });
```

A stage calls a template as `h(template, props, act)`, where `props` is what the `open` carried past
`name`, `template`, `history` and `children` (design 213). So the dialog is named at the call, and
`Modal` goes in as the template itself:

```tsx
stage.open({ name: 'edit', history: true, template: Modal, label: 'Edit the thing' });
```

The act is handed the same props, plus the `stage` after them. An act reached from the URL carried
nothing, so the template the stage was given is called with nothing.

**`Modal` reads the props it names and forwards none of the others.** `label`, `noEsc`, `noClickEsc`,
`type`, `side`, `element`, `theme` and `class` are its own; anything else an `open` carried goes to
the act and no further, so a row handed to the act is not written on the `<dialog>` as an attribute.
A prop the act wants that is spelled like one of the eight is read by `Modal` too: that is what one
prop bag means, and it is visible in the call.

Escape (through the element's own `cancel` event), a mousedown on the backdrop and the close button
all call the stage's `close()`, so a modal that owns a history entry goes down the same way whichever
one you used (design 124). `noEsc` and `noClickEsc` turn the first two off. A `Modal` with no stage
above it is an assert naming the call that shows one. A popup opened inside the dialog goes in the
dialog, so a `Select` or a `Menu` in a modal works with nothing else to write.

**A sheet is a `Modal` with `type="sheet"`**, against an edge instead of in the middle, sliding in
from it (design 202). `side` says which edge, `right` by default, and is read for no other type.
Everything else is the same: the same stage, the same three ways to close it, the same backdrop.

```tsx
stage.open({ name: 'filters', template: Modal, label: 'Filters', type: 'sheet' });
```

**A stack of disclosures that keeps one open is a run of `DropDown`s sharing one `name`**, which is
the platform's own behaviour for a group of `<details>`. There is no component for it (design 212):
give each drop-down the same `name` and you have one.

**A tip is on hover and on focus, and the anchor names it.** The children are the anchor, and a
`<mark.popup>` replaces the label with markup. The panel sits inside the box `Detached` placed and
wears no `popover` of its own: the box is already a popover, and a popover inside a popover is put in
the top layer and laid out by the browser, which takes the panel out of the box and lands it in the
middle of the screen (design 135). The pause before a hover shows it belongs to the
behaviour, so every tip on a page waits the same time and there is no prop for it; focus shows it at
once. Each element in the anchor gets `aria-describedby` naming the panel, written when the page
comes alive. A static render leaves it out, because nothing on the client can write it before the
pairing walk reaches the anchor, so markup carrying it could not be taken over (design 153). It is
taken off again when the component unmounts.

A `Tooltip` takes over server markup and can sit inside an act a stage swaps away, both since
design 153.

**A drop down is a disclosure, not a floating menu.** The content is the children, in the page's
flow. The `open` cell goes both ways: writing it opens and closes the element, and a person opening
it writes the cell. Space, Enter, the `button` role and the expanded state are the platform's,
because the element is a `<details>`. A floating menu under a button is `Detached` with a `Button`
anchor, which is one call and no new component.

**A file drop holds entries, and no upload.**

```tsx
const picked = mutableArray();
<FileDrop files={picked} extensions={['image/png', '.csv']} limit={4_000_000} ready={file} />
```

An entry is `{ name, file, status, error, reason }`. A file the zone accepted starts as `ready` and
one it refused as `error`, with `error` the sentence a person reads and `reason` the code you branch
on: `type` for a file the `extensions` do not cover, `size` for one over `limit`, and `count` for a
second file while `multiple` is false (design 214). An accepted entry carries neither. A refused
file stays in the list rather than disappearing. Move `status` to `loading` while you upload by
writing the entry back, `files[0] = { ...files[0], status: 'loading' }`, which is the edit a list
can hear; that row then shows the `LoaderContext`'s loader beside the file's name, and the dots
when nothing named one (design 219). `ready` is written null while anything is loading, and otherwise the file, or the array of
files when `multiple` is true, counting every entry that is not in error. The transport is yours:
`ui` decides nothing about storage, transport or the server, so the entry carries the platform
`File`.

**With `multiple` false, a second pick replaces the entry that is there**, in place, so a `watch` on
the list hears a `replace` and not an `add`. A page listening for `add` alone sees the first file and
none of the ones after it.

**`limit` is bytes, and every sentence naming it is written for a person**: KB, MB or GB, 1024 to a
step, so a `limit` of `4_000_000` reads as 3.8 MB. The prompt names the accepted types the same way,
so `image/png` reads as `png`, `image/*` reads as `image` and `.csv` reads as `csv`.

The zone listens for `dragenter`, `dragleave` and `drop`, and reads the dropped files off the
event's `dataTransfer.files`; the input listens for `change` and reads its own `files`. Those four
are the whole of what reaches this component from the host.

Children replace the prompt line and the listing. The input itself is visually hidden rather than
`display: none`, so it is still focusable, and its label is the zone's prompt whichever chrome is
showing. A `FileDrop.Button` standing on its own names its own input the same way, with an offscreen
`<label>` carrying the button's `label` or its `aria-label`, because the button beside it is what
shows the words. `look.test.ts` reads the `filedrop_picker` rule and fails if it ever becomes
`display: none`.

**`FileDrop.Button` is two things, decided by where it is** (design 214). Inside a `FileDrop` it is
a `Button` that opens that zone's input, and it takes no checking props of its own, because the zone
already has them; giving it one is an assert. Outside a zone it is the picker with no chrome: its
own hidden input, the same checks, and `files`, `extensions`, `multiple`, `limit`, `onDrop` and
`ready` on the button itself.

```tsx
<FileDrop.Button label="Change photo" extensions={['image/*']} multiple={false} ready={photo} />
```

**A check is given the cell, not the value.**

```tsx
<ValidateContext value={allValid}>
	<Validate value={email} validate="email" signal={submitted}>
		<TextField label="Email" value={email} />
	</Validate>
</ValidateContext>
```

**`validate` is handed the cell, not what the cell holds.** So a check reads it with `cell.get()`,
and one that formats what was typed writes it back with `cell.set(...)`, which is how four of the
eight built-ins work. It returns the problem as a string, or `''` or `null` for no problem.

```tsx
<Validate value={confirm} validate={(cell) => (cell.get() === password.get() ? '' : 'They do not match.')}>
```

`validate` is that function, or the name of one of eight built-ins: `phone`, `email`, `pan`, `expDate`, `postalCode`, `date`, `number` and `float`. Four
of them write a formatted value back into the cell: `phone`, `pan`, `expDate` and `postalCode`. Each
answers nothing for an empty value, so a field is not invalid before anybody has typed in it. They
are small on purpose, each doing what its name promises and no more: `email` is a shape check,
`date` is `YYYY-MM-DD`, `postalCode` is the Canadian one, and `pan` is a Luhn check on thirteen to
nineteen digits. Write a function for anything else.

**A `signal` is read, not counted.** While that cell holds something falsy nothing is checked, and
while it is truthy every change to `value` is checked (design 208). So a form that clears itself
after a successful submit writes `submitted` back to false and goes quiet again, rather than marking
every emptied field. Going quiet clears the message, writes `valid` true and writes `error` null.
With no `signal`, checking is live from the start.

**Under a `ValidateContext`, a check runs again when any cell that form is checking changes.** That
is what confirm-must-match needs: the validator above reads the other password's cell, and nothing
else would tell it that the other password moved. A validator that reads a cell no `Validate` in the
same form is checking is not re-run for it; put that control in a `Validate` too.

The message is rendered once, after the children, as a live region. It also reaches the control:
a control of this package that was given no `error` of its own goes `aria-invalid` and its
`aria-describedby` names that message. A `Validate` around a plain `<input>` still shows and
announces the message and leaves the input unmarked, because nothing read it. `showError` false takes
the message off the screen and leaves it announced.

A `Validate` wraps one control. Every control under it takes the message, so a `Validate` around two
of them marks both invalid and points both at the one message. Two controls want two `Validate`s.

A validator that throws is reported on a microtask the host sees, the way every handler a page wrote
is reported here, and the value counts as invalid with the error's message. A form is never quietly
valid because its check crashed.

`ValidateContext` writes its `value` cell true while every `Validate` under it is happy. Each one
registers when it mounts and leaves when it unmounts, so a field that goes away stops holding the
form invalid.

**A colour picker is a square and one or two sliders.** `value` is a cell holding CSS colour text,
anything `readColour` reads, and it is written back as `rgb()` or `rgba()`; text that is not a
colour is an assert naming the text. Saturation and brightness are one place in a square, dragged
with a pointer or driven with the arrows; hue and opacity, the last only when `hasAlpha` is not
false, are labelled range inputs with the platform's keyboard on them. The swatch beside them is
`aria-hidden`, because it says what the rest already say. There is no eyedropper and no hex field;
a `TextField` on the same cell is the hex field, because the cell is text.

The square's thumb is the one element in this package with a role written on it, because there is
no two-axis role in ARIA (design 222). It is `role="slider"`, focusable, and says both axes:
`aria-valuenow` carries the saturation and `aria-valuetext` reads `saturation 40%, brightness 80%`.
Left and right move saturation, up and down move brightness, `Home` and `End` take saturation to
its ends, and Shift makes any of them coarse. A press anywhere in the square moves the thumb there,
and a drag that leaves the square keeps working.

A drag, a key or a slider writes the cell, and nothing else does, so mounting a picker on a colour
leaves that colour and its notation alone. With `hasAlpha` false a write keeps the alpha the cell
already had: nothing on the screen can change an alpha nobody can see.

The square is `$planeSize` on each side and there is no `size` prop: it is a composite with no one
height, so an application that wants a bigger square redefines `$planeSize`. The two gradients over
it are the `colorpicker_plane` entry's, and the hue track's six hues are `colorpicker_track_hue`'s.
What the component writes is the colour that is chosen now, which does not exist until it runs: the
hue under the square, the thumb's own fill and the opacity track are inline `style`. The theme check
reads source text, and each of those is arithmetic rather than a value anybody typed, so there is
nothing there for it to refuse.

**A state prop takes a cell.** `open`, `enabled`, `value` and `files` are cells or absent; give one a
plain value and it is a loud assert naming the prop and the fix, because a component that quietly
kept a cell of its own would look as though it had honoured what you asked for.

**The theme entries these add**, on top of the ones above: `dialog` with its `::backdrop`, `tooltip`,
`disclosure` and `disclosure_summary`, `filedrop` with `dragging`, `prompt`, `list` and `entry`,
`validate`, and `colorpicker` with `swatch`, `plane`, `plane_thumb`, `track` and `hue`. `offscreen` is one more, and it is
yours to use: it takes an element off the screen and leaves it in the reading order.

Each of them has a page on `recipes/ui/catalogue.html`, in both modes, driven in Chromium by
`recipes/ui/main.ts` with axe-core over it.

## Text

```tsx
import { TextModifiers, Typography } from '@aweftjs/ui';
```

| export | what it is | its own props | example |
|---|---|---|---|
| `Typography` | one run of themed text: one element on the `text` entry | `type`, `label`, `element`, `theme` | `typography` |
| `TextModifiers` | a context holding the list `Typography` runs over its label | `value` | `typography` |
| `TypographyProps` | what `Typography` takes | | |
| `TextModifier` | one entry of that list: `{ check, return }` | | |

**`type` is theme segments joined by `_`, and the first segment also picks the element.**
`<Typography type="h2_bold" label="Today" />` is an `<h2>` themed `text h2 bold`, so `text_h2` and
`text_bold` both apply and the later segment wins where they disagree. `h1` to `h6` give that
heading, `p`, `p1` and `p2` give a `<p>`, and everything else gives a `<span>`, so a word this
package never defined is a segment like any other and your own `text_eyebrow` needs nothing from
here. With no `type` it is a `<span>` on `text` alone. `type` may be a cell: the theme follows it,
and the element does not, because an element lasts as long as the component.

**`label` and `children` both render, label first**, and neither is required. `label` may be a
cell. `element` hands in the node to decorate instead of building one, which is how a heading's
look goes on a level the document outline wanted instead.

**`TextModifiers` turns parts of a label into something else.** A modifier is
`{ check, return }`: `check` is a plain string, matched everywhere and case-insensitively, or a
global regex, and `return(match)` answers whatever that piece becomes. Matches are collected in the
order the modifiers are written, sorted by where they start, and an overlap goes to the one that
started first, a tie to the one written first. A gap between matches is text.

```tsx
<TextModifiers value={[{ check: /@\w+/g, return: (name) => <Tooltip label={who(name)}>{name}</Tooltip> }]}>
	<Typography type="p1" label={note} />
</TextModifiers>
```

Keys beyond those two are ignored, so a list written for something else passes through. A provider
replaces the list above it rather than adding to it; a subtree that wants both writes both. A list
held in a cell is read when each `Typography` below it mounts, as `Icons` is; a later write reaches
what mounts after it. The
list runs over `label` only, because a child is already markup and has nothing for a pattern to run
over, and a label that is neither a string nor a number renders as given. A regex without the `g`
flag is a loud assert naming the flag, because a pattern that finds one match is almost never what
was meant. A cell label runs the pass again when it changes.

**The label goes through one internal resolve step first.** Today it answers the string it was
given. It is the seam translation would fill, and nothing about it is exported.

**What it never does.** No editing: nothing swaps an input in on a click and nothing measures text
with a span, because editing is `TextField`'s job and a page composes the two. No width cap: a
measure is yours, as `maxWidth` on `text_p1`. No fonts: the theme engine already emits `@font-face`
and `@import` from your own theme's directives.

`recipes/ui/preview.html` shows the whole family in both modes, and the gallery's modifier demo is
`recipes/ui/page.tsx`, both driven by `recipes/ui/main.ts`.

## Display

Six things a page shows and nobody operates (design 199). Each is one native element with a theme
on it, none takes a handler, and none takes a value the way a control does.

```tsx
import { Alert, Avatar, Badge, Empty, Progress, Skeleton } from '@aweftjs/ui';
```

| component | the element | its own props | `size` | example |
|---|---|---|---|---|
| `Badge` | `<span>` on `badge` | `label`, `type` (`quiet`, `danger`, `success`, `outline`), `icon`, `element` | `sm`, `lg` | `badge` |
| `Alert` | `<div role="alert">` or `<div role="status">` on `alert` | `title`, `icon`, `type` (`danger`, `success`), `element`, children as the body | | `alert` |
| `Avatar` | `<span>` on `avatar`, holding an `<img>` and a `<span>` | `src`, `alt`, `fallback`, `round` | `sm`, `lg`, or any CSS length | `avatar` |
| `Skeleton` | `<div aria-hidden="true">` on `skeleton` | `width`, `height`, `round` | | `skeleton` |
| `Progress` | `<progress max="1">` on `progress` | `value` (0 to 1, or nothing), `label`, `element` | `sm`, `lg` | `progress` |
| `Empty` | `<div>` on `empty` | `icon`, `title`, `description`, `element`, children as the actions | | `empty` |

**An avatar shows its letters until its picture loads, and again if it fails.** Both children stay
in the tree and whichever is not showing carries `hidden`, so it is out of the accessibility tree as
well as off the screen. `round` is true unless you set it false.

With a plain `src` of nothing there is no `<img>` at all. With a `src` that is a cell the `<img>` is
in the markup from the first paint whatever the cell holds, and its `src` follows the cell: a cell
that has not resolved yet is not the same as no picture.

**`size` takes a CSS length as well as `sm` and `lg`** (design 215), the way `Icon`'s does. A step
name is a theme segment; a length is written as the element's width and height. The fallback letters
are 40% of the box, through a container query on the `avatar` entry, so they follow it at every size
and at any length. Move `$avatarLetter` to change the proportion.

**A progress with no value is indeterminate.** `value` is a fraction of 1, so nothing has to divide;
`null` or nothing leaves the attribute off, which is what the platform reads as waiting and draws as
the moving bar. A number outside 0 to 1 is clamped to it, and anything that is not a finite number,
`NaN` and a string of digits included, is indeterminate rather than written through. Give it a
`label`: without one it has no name for a screen reader.

**A skeleton announces nothing.** It is `aria-hidden`, because the thing that is loading is what
says so and three grey boxes saying it three times is worse than silence. `width` and `height` go
through `style`, so a bare number is pixels and any CSS length works.

**A badge's size is padding and text, not a height.** A badge is not a control, so `$control` is
the wrong number for it: `sm` tightens the padding and `lg` widens it and takes the next text step.

**An alert's icon is yours.** This package ships no drawings, so an `Icon` by name needs an `Icons`
provider above it and there is no default icon here. The box is one column until you give it one.

**`danger` interrupts and `success` waits.** A `danger` alert is `role="alert"`, so a screen reader
breaks off to read it; every other type, `success` included, is `role="status"` and waits its turn
(design 216). A thing that went right is not an interruption.

## Grouping

One component whose whole job is what it puts around other components (designs 200, 211).

```tsx
import { Card } from '@aweftjs/ui';
```

| component | the element | its own props | example |
|---|---|---|---|
| `Card` | `<div>` on `card`, with the `stack` segment when it has parts | `title`, `description`, `foot`, `type`, `tight`, `element`, children as the body | `card` |

**A `Card` with none of `title`, `description` and `foot` is the bare block**: the `card` entry, and
the children directly inside it (design 211). Given any of the three it takes the `stack` segment
and builds the parts: the head, the body around your children, the foot, and `$space4` between them.
Each part renders only where it was given something.

```tsx
<Card><h2 theme={['text', 'lg']}>Today</h2><p theme="text">Nothing yet.</p></Card>
<Card title="Today" description="What is due" foot={<Button label="Add" />}>Nothing yet.</Card>
```

`tight` drops the padding, for a card whose children reach the edge. Write `<Card theme="stack">`
to get the column spacing on a card that has no parts.

**A row of buttons joined into one control is yours to write** (design 212). There is no component
for it: a class list is written by the element that wears it, so a group could never put a segment
in its children's lists anyway.

**A text field with something beside it inside the same box is `TextField`'s `leading` and
`trailing`** (design 210), not a component of its own. See Controls.

## Navigation and data

Where a person is, and what they are looking at (designs 201, 203).

```tsx
import { Breadcrumb, Pagination, Tab, TabPanel, Table, Tabs } from '@aweftjs/ui';
```

| component | the element | its own props | example |
|---|---|---|---|
| `Table` | a `<table>` on `table`, inside a `<div>` on `table_scroll` | `columns`, `rows`, `cell`, `caption`, `foot`, `label`, `striped`, `tight`, `type`, `element` | `table` |
| `Breadcrumb` | a `<nav>` on `breadcrumb` around an `<ol>` | `items` of `{ label, href }`, `label`, `element` | `breadcrumb` |
| `Pagination` | a `<nav>` on `pagination` of quiet `Button`s | `page` (a cell), `count`, `siblings`, `onChange`, `size`, `label`, `element` | `pagination` |
| `Tabs` | a `<div>` on `tabs` around a `<div role="tablist">` on `tabs_list` and the panels | `value` (a cell), `tabs` of `{ value, label, disabled, content }`, `orientation`, `type` (`line`), `size`, `label`, `onChange`, `element` | `tabs` |
| `Tab` | a `<button type="button" role="tab">` on `tab` | `value`, `label`, `disabled`, `element` | `tabs` |
| `TabPanel` | a `<div role="tabpanel" tabindex="0">` on `tabs_panel` | `value`, `element` | `tabs` |

**The table's entries work without the component.** Write your own
`<table theme="table">` with `<thead theme="table_head">`, `<tr theme="table_line">`,
`<th theme="table_heading">` and `<td theme="table_cell">` and you get the whole look. `Table` is
the common case: `columns` is a list of `{ key, label, align, width }` or of plain strings, `rows`
is a list or a cell of one, and `cell` is `(row, column) => anything mountable`, defaulting to
`String(row[column.key])`.

**Rows go through `each`, so pushing one inserts one `<tr>`.** A `rows` cell holding anything but a
list, which is what one holds before the first fetch answers, reads as no rows.

**A `cell` may return a different thing on every row.** A button on the rows that can be acted on
and nothing on the rest, text on some and a `Badge` on others: `cell` is called per row and what it
returns is mounted per row, so nothing about the one-shape rule under `each` reaches it.

```tsx
<Table rows={files} columns={[{ key: 'name', label: 'Name' }, { key: 'act', label: '' }]}
	cell={(row, column) => (column.key !== 'act' ? row.name
		: row.mine ? <Button label="Delete" type="quiet" size="sm" onClick={() => remove(row)} /> : null)} />
```

What `each` asks one shape of is a row component you write yourself, which is a different thing;
`packages/dom/README.md` says what that costs.

**A wide table scrolls in its own box**, which carries `tabindex="0"` so a keyboard can reach the
scroll. Give the table a `caption` or a `label`: without one it has no name for a screen reader.

**A breadcrumb's links are plain anchors with no `target`.** That is what lets a router take the
click: `createRouter(...).links(root)` intercepts same-origin anchors and leaves alone anything with
a target. So a breadcrumb inside a routed page navigates with no reload and no handler.

**Pagination shows the first page, the last, and `siblings` each side of the current one**, with an
`aria-hidden` ellipsis where a run was left out. `page` is a cell counted from 1; previous is
disabled on page 1 and next on the last. The page showing now carries `aria-current="page"`.

**A page outside the count is clamped, and the cell is written with the clamp.** `count` shrinking
under the page it was on is what a filter does every time, and the page it leaves behind has no
button, no `aria-current` and a dead Next. So the component moves to the last page, writes `page`
and calls `onChange` with it (the event argument is null, because nobody pressed anything). A
`count` of 0 renders no page buttons and both arrows off, and writes nothing: there is no page to
be on.

**A strip of tabs is one stop in the Tab order, and the arrows move inside it** (design 203). Tab
lands on the tab showing, and the next Tab leaves the strip for that tab's panel rather than walking
to the next tab. Right and Left move one tab, wrapping at each end; Down and Up do instead when
`orientation` is `vertical`; Home and End go to the ends. A `disabled` tab is stepped over rather
than landed on, and it says so with `aria-disabled` so a screen reader still reads it out.

**Arriving on a tab chooses it.** The arrows move the selection as well as the focus, so holding
Right shows each panel in turn. That is what the roving `tabindex` is for: the tab showing carries
`0` and every other carries `-1`. All of it is one internal behaviour, `tablist.ts`, the fifth
beside the field wiring, the dismiss, the dialog and the tooltip trigger (design 129); none of the
five is exported, and each is tested once on its own.

```tsx
<Tabs label="Views" value={view} tabs={[
	{ value: 'all', label: 'All', content: <All /> },
	{ value: 'mine', label: 'Mine', content: <Mine /> },
]} />
```

**Every panel stays mounted, and the ones not showing carry `hidden`**, so coming back to a panel
finds it as it was left. Wrap a panel's contents in a `Shown` to have them built again instead.

**`tabs` is the common case; two marks are the long way.** The tabs go inside the strip and the
panels go outside it, and a component may not read another component's props to tell them apart, so
a caller who writes them out says which is which:

```tsx
<Tabs label="Sections">
	<mark.tabs><Tab value="left" label="Left" /></mark.tabs>
	<mark.panels><TabPanel value="left">the first</TabPanel></mark.panels>
</Tabs>
```

With no `value` the component keeps a cell of its own and starts on the first tab, and a cell you
passed holding nothing is left holding nothing: choosing for you would be a write you did not ask
for. Each tab and its panel name each other with `aria-controls` and `aria-labelledby`, off ids
minted from the render's counter, so a page rendered on a server and the hydration that adopts it
agree.

**The tab showing leaving the `tabs` list moves the selection to the first tab anyone can choose.**
Otherwise the value names nothing: every tab reads `tabindex="-1"`, so the strip is not in the Tab
order at all, and every panel is `hidden`, so the page shows nothing. The cell is written and
`onChange` is called with the new value (the event argument is null). With every tab `disabled`,
nothing is chosen and the first tab keeps the stop, so the strip is still reachable. Tabs written
out in the two marks are your own markup and are not read this way; taking one out is a change you
made to your own tree.

**A `TabPanel` whose `value` no `Tab` has is refused**, because its `aria-labelledby` would name an
id that is not on the page, which no browser reports.

## The look

A default theme ships in light and dark. It is what makes `theme="button"` a button, and it is the
contract a component of this package is allowed to use. Designs 115 to 120 are the whole of it.

**Four colour scales**, `neutral`, `accent`, `danger` and `success`, twelve steps each, `$neutral1`
to `$neutral12` and so on. The steps follow one job list: 1 and 2 are backgrounds, 3 to 5 component
fills by state, 6 to 8 lines, 9 and 10 solids, 11 and 12 text.

**Twenty-two roles**, each set from one step. A component uses a role, never a step:

| role | pairs with | what it is for |
|---|---|---|
| `$background` | `$foreground` | the page |
| `$surface` | `$surfaceForeground` | a raised block |
| `$muted` | `$mutedForeground` | a quiet fill, and quiet text on any background |
| `$accent` | `$accentForeground` | a filled control |
| `$accentSubtle` | `$accentSubtleForeground` | a tinted control |
| `$danger` | `$dangerForeground` | a destructive control |
| `$dangerSubtle` | `$dangerSubtleForeground` | a warning block |
| `$success` | `$successForeground` | a thing that went right |
| `$successSubtle` | `$successSubtleForeground` | a block saying so |
| `$border` | | the line around a block |
| `$input` | | the edge of a control |
| `$ring` | | the focus ring |
| `$link` | | text that goes somewhere |

Every pair meets WCAG 2 AA in both modes, 4.5:1 for text and 3:1 for a line, asserted in
`packages/ui/tests/contrast.test.ts` with a ratio the test computes itself.

**The default is monochrome.** `$accent` is the neutral scale's text step and `$accentForeground`
is its page step, so a filled button is near-black on near-white in light and the same line read
the other way round in dark. `$ring` and `$accentSubtle` are neutral too. The accent scale is
still defined, all twelve steps of it, and `$link` is the one role that uses it. Colour is a
decision your application makes: one provider at the root redefining `$accent` and
`$accentForeground` puts it back on every filled control, because no component names a step.
`$danger` is unchanged and still red, and `$success` is its counterpart in green (design 216): the
two tones are for a message about what happened, and no control here is coloured by either.

**Type** is `$textXs`, `$textSm`, `$textMd`, `$textLg`, `$textXl`, `$text2xl`, `$text3xl` and
`$text4xl`, in `rem`, each with `$textXsLine` and so on beside it. `$font` and `$fontMono` are the
families.

**Sizes** are `$space` (4px) and its six multiples, `$space2`, `$space3`, `$space4`, `$space6`,
`$space8` and `$space12`, with no step between them; `$radiusSm`, `$radius` and `$radiusLg`;
`$controlSm` (32px), `$control` (36px) and `$controlLg` (40px); `$target` (24px, the smallest a
pointer target may be, which sizes the things that are not controls); and `$borderWidth`,
`$ringWidth` and `$shadowSm`.

**Every control is `$control` tall.** A button, a text field, a select, a slider's hit area and
the row a checkbox sits in beside its words are all 36px, so a line of controls is a line. A text
area is sized by what is in it and keeps a minimum of its own. `$controlSm` and `$controlLg` are
the same rule at the two other sizes.

**The height is the box, so your own padding fits inside it rather than adding to it.** Controls
declare `box-sizing: border-box`, which is what makes the declared height the height whatever
element wears the entry. A `TextField` given `padding: '12px'` through a theme override is still
36px tall, with a 10px content box; `padding: '20px'` is more than fits, so the control grows to
42px. Before this the padding was added to the height every time. `$target` is the smallest a pointer target may be and now
sizes nothing in this theme: it is the number your own entries reach for.

**Motion** is `$fast` (150ms), `$slow` (240ms), `$ease` (`cubic-bezier(0.4, 0, 0.2, 1)`) and
`$easeOut`. The root sets one transition for every themed element, over
`background-color, background-image, border-color, color, transform`, and `popup`, `dialog`, its
`::backdrop` and `tooltip` each set one more for the opacity and scale they arrive with (record
192). `box-shadow` is deliberately not on the list: the focus ring is drawn as one, and a ring that
fades in is a ring that is not there yet (design 217). Every one of these is written inside
`@media (prefers-reduced-motion: no-preference)`, so a person who asked for less motion gets none
and no component has to remember the query. The default theme reads neither `$slow` nor `$easeOut`;
they are there for you.

**Three things move that are not a colour.** A switch's thumb crosses its pill over `$fast`, a
slider's thumb grows under the pointer over `$fast`, and a skeleton and the loading dots run their
own cycles: a skeleton breathes between full and half opacity over 2s, and the three dots run a 1s
cycle a third apart each, so the bright point travels along the row (design 218). The two thumbs
are pseudo-elements, which the root's transition on the element does not reach, so each declares
its own transition. The skeleton and the dots are not transitions at all: each is an animation on
the element itself, with its own keyframes, and the same query around it.

**States are one rule.** `hovered` and `pressed` lay a translucent tint of the element's own
foreground over whatever background it has, at two fixed strengths. No component names a hover
colour, and there is no ripple. `disabled` clears the tint.

**Focus is one rule.** The root gives every themed element, on `:focus-visible`, a border in
`$ring` and a `$ringWidth` halo of `$ring` at half strength, drawn as a box shadow. An outline is
drawn outside the border box and cannot be soft, so it reads as a second border; the halo reads as
focus. The focus rule is the one place in this package that writes `outline: none`, and it names
`$ring` twice in the same block, which is what the gate check asks of an entry that turns an
outline off.

**The border is what meets the contrast target, not the halo.** `$ring` on `$background` is 6.08:1
in light and 7.39:1 in dark, well past the 3:1 a non-text indicator has to reach. The halo as it is
actually painted is `$ring` at 50% over whatever is behind the control, which measures 2.15:1 in
light and 2.74:1 in dark. So the halo is what makes the focus easy to see and the border is what
makes it pass; a theme that keeps the halo and drops the border colour has an indicator nobody has
measured.

**Disabled dims.** `opacity: 0.5` and `cursor: not-allowed`, with the state tint off. It does not
repaint the control, because a disabled danger button repainted in `$muted` is no longer the
control it is.

**Inputs and quiet buttons carry a hairline.** `$shadowSm` is one pixel of offset and two of blur
in the element's own foreground at 6%. It is an edge, not elevation: nothing here lifts a block
off the page with a shadow.

**Overlays arrive.** `dialog`, `popup` and `tooltip` transition their opacity and a small scale in
over `$fast`, from an `@starting-style`, inside the reduced-motion query. The dialog leaves the
same way and its `::backdrop` fades with it. A popup and a tooltip arrive and do not leave, because
what hides either is a `display: none` written on the box the popup sink places, above the element
the theme reaches.

**The tick box, the radio and the select's arrow are drawn here** (design 195). Each is still the
native element: `appearance: none` takes the host's drawing and leaves the keyboard, the form and
the label. A tick box is a `$box` square with `$radiusSm` corners and the `$input` edge, filled
`$accent` when it is ticked, and the tick is two sides of an empty `::before` turned 45 degrees in
`$accentForeground`. Indeterminate is a bar. A radio is the same box as a circle with a centred
dot. A select's control says `appearance: none`, so no host draws an arrow on it, and the component
puts an empty box at the right of the control for `select_chevron` to draw one in, the same way: a
`$chevron` square with two of its sides turned a quarter turn. Nothing here is an image, an icon
pack or a name asked of one.

**The entries it ships.** These are the theme names a component of this package, or of yours, can
ask for. Everything else is yours to define.

| entry | what it is for |
|---|---|
| `button` | a filled control: the accent fill, its foreground, `$control` tall |
| `button_sm`, `button_lg`, `button_square` | the size axis, and a square for a button whose label is an icon. `size="icon"` is the prop; `square` is the segment, because `icon` is an entry of its own |
| `input_sm`, `input_lg`, `select_sm`, `select_lg`, `checkbox_sm`, `checkbox_lg`, `radio_sm`, `radio_lg`, `toggle_sm`, `toggle_lg`, `slider_sm`, `slider_lg` | the same axis on the rest of the controls |
| `button_quiet` | the same control with no fill: a border and accent-subtle text |
| `button_danger` | the same control in the danger colours |
| `input` | a text field: the surface fill, the `$input` edge, the hairline, a placeholder in `$mutedForeground` |
| `input_invalid` | that field with a danger edge |
| `select` | `input` again on a `<button>`, laid out in a line, with room on the right for its own arrow |
| `card` | a raised block: the surface fill, a border, the larger radius, `$space4` of padding |
| `popup` | the same block at popup size: the smaller radius, tighter padding |
| `text` | body copy at `$textMd`, with no margin, and a newline kept as a line break |
| `text_xs`, `text_sm`, `text_lg`, `text_xl`, `text_2xl`, `text_3xl`, `text_4xl` | that copy, one size step at a time |
| `text_h1` to `text_h6` | a heading: one step of the scale from `$text4xl` down to `$textMd`, at weight 600, with balanced lines |
| `text_p1`, `text_p2` | a paragraph at `$textMd` and at `$textSm`, with no lone last word and no width cap |
| `text_bold`, `text_regular`, `text_italic`, `text_center`, `text_inline` | one declaration each, to put after any of the above |
| `text_mono` | that copy in `$fontMono` |
| `muted` | text in `$mutedForeground`, readable on any of the three backgrounds |
| `button_round`, `button_inline` | that control as a circle, and as a run of `$link` text with no fill or padding at all |
| `textarea` | the text field again, growing to its content up to `$textAreaMax` |
| `checkbox`, `radio` | a `$box` square and a circle, drawn here: the box, the tick and the dot |
| `field_label`, `field_hint`, `field_error` | a control's label, the line under it, and its message. Parts, so each is one class token. A label under a `[data-invalid]` field takes the message's colour |
| `select_wrap`, `select_chevron` | the box a select's own arrow is placed in, and the arrow: a `$chevron` square with two sides drawn, turned a quarter turn |
| `toggle` | a switch: a pill and a thumb drawn with `::before` |
| `slider` | a range input: the track and the thumb on the vendor pseudo-elements, with `$space` of room at each end for the thumb |
| `slider_hovered`, `slider_pressed` | the one entry pair that answers the two state segments itself: the root tint goes off the box, the track takes the tint and the thumb scales (design 220) |
| `listbox` | the list a select opens: the popup's surface with rows in it, scrolling past `$listMax` |
| `listbox_item` | one row of it, a `$control`-tall line. `listbox_item_selected` is the chosen one and `listbox_item_active` is the one the keys and the pointer are on |
| `menu`, `menu_item` | the same list and the same row for a `Menu`'s actions |
| `menu_item_danger`, `menu_heading`, `menu_group` | the dangerous row in `$danger`, a group's small heading in `$mutedForeground`, and the column a group is |
| `card_tight` | that card with no padding |
| `field`, `field_inline`, `field_responsive` | what a labelled control puts around itself, and what a form is laid out with: a column, a `$control`-tall row, or a column that turns into one from 28rem of its container |
| `field_group`, `field_set`, `field_legend` | the stack a form is, a fieldset with the host's frame taken off, and its heading |
| `dots`, `dot` | the three dots of `LoadingDots`, and one of them: a 1s wave, the second and third a third of a cycle behind |
| `pulse` | a slow breathe over `$pulseCycle`, which `skeleton` extends and any block of yours can |
| `badge` and its `quiet`, `danger`, `success`, `outline`, `sm` and `lg` | a short label on a fill, sized by its padding and its text rather than by `$control` |
| `alert`, `alert_lead`, `alert_danger`, `alert_success`, `alert_symbol`, `alert_title`, `alert_body` | a message about the page: a grid of one column, two when it was given an icon |
| `avatar`, `avatar_image`, `avatar_fallback` and its `sm`, `lg`, `round` | a picture of a person and the letters shown without one; the part that is not showing carries `hidden`, and the letters are `$avatarLetter` of the box |
| `skeleton`, `skeleton_round` | a grey box standing in for something that has not arrived, breathing on `pulse` |
| `progress` and its `sm` and `lg` | a bar filling up, drawn on the three vendor pseudo-elements |
| `empty`, `empty_symbol`, `empty_title`, `empty_description`, `empty_actions` | nothing here yet, and what to do about it |
| `card_stack`, `card_head`, `card_title`, `card_description`, `card_body`, `card_foot` | what a `Card` adds when it was given a title, a description or a foot; one with none of the three reaches none of them |
| `button_current` | the one of a run that is showing now: the page a `Pagination` is on |
| `table`, `table_scroll`, `table_head`, `table_line`, `table_heading`, `table_cell`, `table_caption`, `table_foot` and the `striped`, `right`, `center`, `tight` modifiers | a table: collapsed borders, a hairline under the head and under each row, and a box a wide one scrolls in. The row's part is `line` and not `row`, because `row` is an entry of its own |
| `breadcrumb`, `breadcrumb_list`, `breadcrumb_item`, `breadcrumb_link`, `breadcrumb_current`, `breadcrumb_separator` | a trail of links and the chevron between them, drawn out of the same `$chevron` box the select's arrow is |
| `pagination`, `pagination_gap` | a row of page buttons, and the ellipsis where a run was left out |
| `input_group`, `input_group_control`, `input_group_addon` and its `sm`, `lg`, `invalid` | the `input` look on the box a `TextField` with an addon builds, and the input inside it with none of it |
| `icon` | an icon, sized in `em` so it follows the text |
| `row`, `column`, `divider` | laying things out in a line, with the seven modifiers above |
| `dialog`, `dialog_head`, `dialog_body` | a modal dialog, its heading row and its content; the scrim is on `::backdrop` |
| `dialog_sheet` and its `left`, `right`, `top`, `bottom` | the same dialog against an edge, anchored by margin and sliding in from it |
| `tooltip` | a tip: the page's own colours the other way up |
| `disclosure`, `disclosure_summary` | a `<details>` and the summary that wears the `button` entry |
| `filedrop` and its `dragging`, `prompt`, `input`, `list` and `entry` | a drop zone, its prompt and its listing |
| `validate` | the message a `Validate` shows, beside its icon |
| `colorpicker`, `colorpicker_swatch`, `colorpicker_plane`, `colorpicker_plane_thumb` and its `hovered` and `pressed`, `colorpicker_track` and its `hue` | the saturation and brightness square, its thumb, the sliders beside it and the colour they name |
| `offscreen` | off the screen and still in the reading order |

`hovered`, `pressed` and `disabled` are three more entries, and you put them in a class list
yourself: `theme={['button', hovered.bool('hovered', null)]}`. They match anywhere, so they apply
to any entry above. They are meant for the controls, `button` and its two variants, `input` and its
variant, and `select`; `card`, `popup`, the `text` sizes and `muted` have no state to show.

`slider` is the one entry that answers the first two itself. The tint is a rectangle the width of
the row and a slider's thumb is a 16px circle inside it, so `slider_hovered` and `slider_pressed`
turn the tint off the box and put the state where the control is: the track takes the tint and the
thumb scales, on both vendor pseudo-elements (design 220). Write a `slider_hovered` of your own to
have it back. Any entry of yours can do the same: two segments beat one in the chain.

**Your root entry sets the page's background and its colour.** The root `*` entry of this theme
sets neither, because it is on every themed element: a colour written there lands on an element
inside a control as well as on the control, and an `Icon` inside a filled `Button` took the page's
foreground on the button's own fill, which is an icon nobody can see (design 198). So the page's
own entry says both, once, and everything under it inherits:

```ts
Theme.define({
	page: {
		// The host's own body margin shows as a band of its default colour around your entry, which
		// is white against a dark page. Take it off, and make the entry as tall as the viewport so
		// a short page is painted to the bottom.
		'_elem_body': { margin: 0 },
		minHeight: '100vh',
		background: '$background',
		color: '$foreground',
	},
});
```

Without one the page reads in the host's own default colours, which is right in light and wrong in
dark, so a page that offers dark mode needs this entry.

**Every themed element honours `hidden`** (design 207). The root entry carries the rule inside
`@layer aweft`, because an unlayered rule loses to a layered one whatever its specificity and every
entry that lays an element out declares a `display` in there. So `hidden` on a themed element takes
it off the screen and out of the accessibility tree, the way it does on an unthemed one.

**Dark is a theme.** `dark` and `light` are partial themes handed to the provider:

```tsx
mount(document.body, <Theme value={dark}><App /></Theme>);
```

Either may nest inside the other, and each subtree resolves its own roles, because a provider's
subtree generates its own classes. Following the operating system is your call, in your own theme,
with the `_media_` directive the engine already has.

**A cell in the value is what a switch is.** `<Theme value={mode}>` with `mode` a cell holding
`light` or `dark` moves every class below it when the cell moves, on a page that is already up. A
plain object subscribes to nothing and costs nothing extra.

**No unnamed value.** A component of this package writes `$name`, never a colour, a size or a
duration. `node packages/testing/scripts/check-theme.ts` refuses one that does, over
`packages/ui/src` and `recipes/`, and `packages/ui/tokens.txt` is the committed list of every name
there is. A value with no name yet gets one in the entry that needs it:

```ts
Theme.define({ splash: { $splashHeight: '320px', minHeight: '$splashHeight' } });
```

**No segment that is an entry name.** The same check refuses a theme key whose segments after the
first name a top-level entry that lays an element out, because a class list is matched segment by
segment and that entry is compiled onto the same element: the square button was `button_icon` and
took the `icon` entry's `display: inline-block; width: 1em` along with it. The segment is `square`
now, and `size="icon"` is still what you write.

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

## Routing

```tsx
import { createRouter } from '@aweftjs/dom/router';
import { Stage, StageContext, mount } from '@aweftjs/ui';

const acts = {
	'': Home,
	'posts/:id': Post,
	docs: Docs,               // renders a StageContext of its own
	about: 'site/About',      // a module, loaded when the URL reaches it
	join: 'auth/SignIn',      // a module from a battery, on the URL you chose
	missing: NotFound,
};

const router = createRouter();
mount(document.body, (
	<StageContext
		router={router}
		sources={[app, authClient]}
		client={client}
		acts={acts}
		template={Layout}
		fallback="missing"
		refused="join"
	>
		<Nav /><Stage />
	</StageContext>
));
router.links(document.body);
```

`StageContext` holds the acts and, given a router, the URL. `Stage` renders whichever act is
current, inside the template. They are two components because one that did template selection, URL
matching, child coordination and the accessibility work at once would be unchangeable.

`stage.current` names the act the URL chose, from the moment it matches. When that act is refused,
the `refused` act's component is what shows under that name, so a test asking what a page is
showing reads the page rather than `current`.

**An act key** is a path with no leading slash. `''` is the index and matches `/` only. `:name`
takes one segment, and one trailing `*name` takes the rest. A key whose whole text is the path wins
outright, and otherwise a literal segment beats `:name`, `:name` beats `*name`, and the longer
pattern breaks a tie. There are no optional segments and no patterns.

**An act** is the component, or the name of a module. A component act may carry `entries()`, an
async function returning the parameter sets a static walk should render it at; nothing in this
package calls it.

**An act module** is an ordinary module: `deps`, `defaults`, and a factory answering
`{ component, title? }`. It is the only form of act that can declare what it needs.

**A module an act depends on is built once per page and reused on every later visit**, so its
factory must hand back live cells and handles rather than an awaited snapshot: the value it
returned on the first visit is the value the fifth visit reads.

```ts
// A getter over the handle, not `const document = await handle.ready`.
export default ({ client }) => {
	const handle = client.share('board');
	return { ready: handle.ready, get document() { return handle.document; }, stop: handle.stop };
};
```

```ts
// modules/notes/Page.tsx
export const deps = ['auth/Session', 'notes/Current'];
export const entries = async () => (await listNotes()).map((note) => ({ id: note.id }));

export default ({ imports }) => ({
	title: 'Notes',
	component: () => <Notes user={imports.Session.user} notes={imports.Current.document} />,
});
```

- **`component`** is what the stage renders, handed the same props a component act gets, `stage`
  included. An instance with no `component` function is a loud assert.
- **`title`** is what the live region announces when the act arrives, and nothing else. The
  browser tab still follows the `<Title>` the component writes.
- **`entries`** is an export beside `deps`, so a static walk reads it without running the factory:
  listing a site's URLs opens no connection and builds no page. A module that exports none answers
  `null`, which tells a walk it cannot say what its URLs are.

**`sources` and `client`.** `sources` is where named acts come from, in precedence order, as
`createLoader` takes them. The stage builds one loader over them for the whole routing tree, and a
stage inside an act inherits it and takes no `sources` of its own. `client` is the page's
connection, handed to every module as its `client` prop.

That is the page mirroring the server: the platform hands a factory `client` and nothing else, and
everything the application makes is a module that others name in `deps`. A shared document, a
session, a rules table, a gate: each is a module, built in dependency order, and none of them is
built in the boot file and threaded around by hand.

**When a named act is loaded and unloaded.** It is loaded, with its dependencies first, when the
stage decides it, and it goes through the same `suspend` everything slow goes through, with the
`LoaderContext`'s loading and failed components. It is unloaded once the next act is showing, so a
module both of them depend on is never torn down between them, and the instance's own `stop` runs
there. The modules it depended on stay loaded for the page; when the stage that built the loader is
removed, everything it loaded is unloaded in reverse load order.

**`refused`** is an act name, shown when loading a named act rejects with a refusal: an error a
factory threw that carries a `reason`. The refused act reads the error as its `refusal` prop, and
gets a `retry` beside it: call it and the act the URL chose is built again, in place, with the
address exactly where it was. `auth/SignIn` calls it after a successful `enter`, so a gated page
appears once the visitor signs in without anyone navigating. The URL never moves, so the visitor
keeps the address they asked for, and `refused` must name a key with no `:name` or `*name` segment,
since the refused act renders under the refusing URL's parameters. Anything else that goes wrong (a
name no source lists, a cycle, a factory that threw a bare `Error`) propagates as before.

**A static render has no `client`**, so the loader's props carry no `client` key at all and a
module that wants one decides what its absence means. What it must not do is wait for an answer
that will never come: `render` waits on every pending promise, so a factory awaiting one hangs the
render. `auth/Session` is anonymous at once instead, so a static render of a gated page is a gated
act refused and the sign-in act in the markup, while a module reading a document with no client
renders its waiting state.

**`{ load }` is gone.** A name is the lazy form. `about: { load: () => import('./about.tsx') }`
becomes `about: 'site/About'` in the acts map, a source that lists it, and a small module:

```ts
// modules/site/About.tsx
export default () => ({ title: 'About', component: About });
```

**The stage value** is `StageContext.read(context)`, or `StageContext.use(stage => ...)`, and every
act is handed it as its **`stage` prop**, so `const Post = (props) => <h1>{props.stage.params.get().id}</h1>`
needs no context at all. It holds `current`, `params` (the `:name` values), `query` (a cell: write
to it and the URL's query is updated with `replace`, so a filter leaves one history entry), `open`
and `close`. A prop named `stage` in an `open` does not reach the act; the stage does.

**Nesting.** An act that renders a `StageContext` of its own gets what the act above it did not
match: `/docs/install` reaches the `docs` act, whose child stage sees `install`. A deep link that
arrives before the child has mounted waits for it, and is dropped on the next navigation. One child
per stage claims it; a second stage under one act is a content swapper, not a route.

**`open({ name, template, history, ...props })`** shows an act now whatever the URL says, wrapped in
the template you name for this open. Props do not accumulate: each `open` replaces the last one's.
`history: true` pushes a history entry **at the URL the page is already on**, so back dismisses it
and a copied link is the link to the page. It is held in memory against that entry, so a reload
lands on the page under it. A stage owns one entry at a time: a second `history: true` open while
one is showing replaces that entry rather than pushing a second, so one back closes whatever is
open and lands on the page.

**`fallback`** is the 404: an act name, matched last, rendered when nothing matched. **`initial`**
is what shows when no URL decides: no router, or a parent that took the whole path.

**On every act change, in a browser**, focus moves to the act's root element (given `tabindex="-1"`
if it cannot take focus), a visually hidden live region announces the act module's `title` or, with
none, the new head title, and the page goes
to the top, or to the URL's hash, unless the router has a position saved for this entry. The first
act is not a change: a page load should not steal focus. All three are no-ops with no `window`.

`context().stage` holds one entry per live `StageContext`: its declared `acts` with a `loader` flag
saying which were declared as module names, and each act's `entries`, its `prefix` (what its parent actually matched, `posts/3` and not
`posts/:id`) and its `parent`. That is what a static walk reads to know which URLs a site has. The
acts come in the order the `acts` object itself lists them, which puts a whole-number name such as
`404` first however it was written.

A page that mounts takes its entry out again when the stage unmounts, so a live page's registry is
what is on the page now. `render` is the exception: it holds the list for the length of the call,
because it takes the page down as soon as it has serialized it and a walk reads the list afterwards
(design 145). `@aweftjs/ssg` is what does the walking.

## Head tags

```tsx
const Layout = (props) => <div><Title>My site</Title>{props.children}</div>;

const Post = () => (
	<article>
		<Head>
			<Title>{post.title}</Title>
			<Meta name="description" content={post.summary} />
			<Link rel="canonical" href={`https://example.com/posts/${post.id}`} />
		</Head>
		…
	</article>
);
```

`Head`, `Title`, `Meta`, `Link`, `Script` and `Style` render nothing where they are written and put
a tag in the render's head list. `Head` opens a deeper scope, and within a group the deepest tag
wins, then the latest, so a page beats the layout it is inside without knowing the layout is there.

A group is the tag's own identity, or an explicit `key`: a `title` is one per page; a `meta` by its
`charset`, `http-equiv`, `name` or `property`; a `link` by `rel` and `href` together, with
`rel="canonical"` a singleton; a `script` by its `src` and `type`, or inline plus type; a `style` by
its `media`. A tag with none of those and no `key` is additive, so every one of them is emitted.
**Two inline scripts of one type are one group**: give each a `key` to keep both.

Every value takes a value or a cell, and a cell rewrites the tag in place.

Tags come out in one fixed order however they were written: charset, viewport, other meta, title,
links that preload or preconnect, styles, other links, then scripts.

```ts
const ui = context();
const body = await render(<App />, { context: ui });
const page = `<!doctype html><html><head>${ui.head.markup()}</head><body>${body}</body></html>`;
```

`head.markup()` stamps each tag with `data-aweft-head`, its group. `mount` writes the list into
`document.head` as one run **at the front of it**, because `document.title` is the first title
element there is and one appended after a page shell's would do nothing. A `<meta charset>` the
shell wrote first stays first, because a charset read late is not read at all. `hydrate` adopts a
stamped tag whose group matches, updating it in place rather than removing and re-adding it.

Two renders in one page neither adopt nor remove each other's tags, and each writes its own title
into the head. `document.title` is whichever of them is nearest the front, so the one mounted last
takes the tab. **Use one render per page** and mount the whole page into it, which is what the
default shared render already does.

A static render holds its list, because `render` takes the page down as soon as it has serialized
it and `markup()` is read afterwards. Use one `context()` per page.

## What it never decides

Storage, transport, and anything server-side. Data fetching: `suspend` takes a promise and does
not make one. Upload transport. Auth. Where analytics go: `InputContext` fires and the application
listens. What your application looks like: a default theme ships so a bare `theme="button"` renders
as something readable, and every value in it is yours to replace. What your own components name
their own values, and whether you run the theme check. Which acts a site has, what a template looks
like, and whether links outside the routed root are intercepted. Writing pages to disk, which is
`ssg`. Your faces, your sizes and your measure, and what a text modifier renders. Whether text is
editable: `Typography` never becomes an input.

## Boundaries

Tier 7, client plane. It imports `@aweftjs/core` and `@aweftjs/dom` and nothing else, and nothing
in the stack imports it.

Nothing at module scope here can be seen through from one page to another. The theme definitions
are the one store, and they are data written once at import. The rest is caches keyed on an object
the caller already holds: the tag identity behind each `<mark.name>`, what a theme says as a
string, and the merge of a render's own theme with a provider's. A page's own state, its class
cache and stylesheet, its id counter and its popup sink, is on the object each render makes.
The render every default `mount` into a page shares is kept on that page's document, not here.
