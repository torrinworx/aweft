# @aweftjs/dom

The DOM binding: state from `@aweftjs/core` onto real nodes, with no virtual tree. `h` makes
an element the moment it runs, a slot binds straight to a node, and a list binds straight to
the commits its array produces. The same page mounts in a browser, renders to markup with no
browser, and takes over that markup in place.

## Quickstart

```ts
import { mutable } from '@aweftjs/core';
import { html, mount } from '@aweftjs/dom';

const count = mutable(0);

mount(document.body, html`
	<button $onclick=${() => count.set(count.get() + 1)}>
		Button clicked ${count} times
	</button>
	<button $onclick=${() => count.set(0)}>Reset</button>
`);
```

`mount` returns the function that unmounts. Everything `mount` takes:

| item | what happens |
|---|---|
| a string, number or boolean | a text node |
| `null` | nothing. `undefined` is refused, so a typo cannot render as silence |
| a node | inserted as it is |
| `h()` output, `html` output | the element, with its reactive parts bound |
| an array or any iterable | each item in order |
| a document array (`createArray`), a mutable array (`mutableArray`) | a list that follows every edit |
| a scope, a cell or a derived value | its value, replaced in place as it changes |
| a component's mounter (`h(Component)`) | the component's result |

**An item may be mounted, unmounted and mounted again**, which is what a slot component whose
branches are written out as markup hands the binding: the branch is built once and mounted every
time it comes back. Unmounting takes what the mount put in back out, so the element is left
holding the static nodes `h` built and the next mount renders once (design 204).

**The one exception is a list.** A list edit takes a row's nodes out itself and then tells the row
its nodes are already gone, which is what keeps a list edit to one write. So an element the page
holds, put into a list, removed by an edit and put back, keeps what its last mount left in it, and
the second mount renders its reactive parts on top: `<em>one</em>` comes back as `<em>oneone</em>`.
Build list items per row, with a component under `each`, and there is no element to hand back.

## Elements: `h` and `html`

`h(tag, props, ...children)` is what `html` compiles to at runtime, and what a JSX transform
targets. A bare prop name is an attribute; `$name` is a property on the element, which is
how `value`, `checked`, `textContent`, and every event handler (`$onclick`) are set. `$style`
takes an object and writes each key onto `element.style`.

```ts
h('input', { type: 'text', $value: draft, $oninput: (e) => draft.set(e.target.value) });
h('div', { class: active.bool('on', 'off'), $style: { color, fontWeight: 'bold' } }, 'label');
```

Any prop or child may be a scope, cell or derived value, and follows it. A `null`, `undefined`
or `false` attribute value removes the attribute; `true` sets it empty. An element with no
reactive parts is returned as itself, so `const box = h('div', { class: 'box' })` is a node
you can hand to the browser.

`html` is a tag for template literals. A tag may be an expression (`<${Component}>`), `</>`
closes the innermost open element, `<!-- ... -->` is a comment and goes, and `${value}` between
tags is a child. Whitespace works as in JSX: lines are trimmed, blank lines go, and a line break
inside text is one space. Close void elements yourself (`<br/>`).

Inside a tag, these are all the forms there are:

| written | means |
| --- | --- |
| `hidden` | the attribute set to `true` |
| `id=plain` | the unquoted text up to the next space or `>` |
| `class="row ${tone}"` | the quoted parts as one value, derived when a cell is among them |
| `title=${t}`, `$onclick=${fn}` | the expression itself, followed if it is a cell |
| `=${props}` or `${props}` | a spread: every key of the object becomes a prop |

A spread is the one form with two spellings. `=${props}` is the explicit one; a hole on its own,
with no name in front of it, means the same thing. Either way it must be an object, and a page
that hands it anything else gets `a spread in a tag must be an object` in development.

`htm(h, { join })` binds the parser to another `h`; `join` says how a quoted attribute of
several parts becomes one value, by default the parts concatenated, and derived when a cell
is among them.

## Components

A component is a function called once, with its props, when it mounts:

```ts
const Timer = ({ children }, cleanup, mounted, pending) => {
	const seconds = timer(1000);
	cleanup(() => console.log('gone'));
	mounted(() => console.log('in the document, descendants included'));
	return h('p', {}, 'up for ', seconds, 's ', ...children);
};

mount(document.body, h(Timer, {}, 'and counting'));
```

`props.children` is always an array. `cleanup` takes functions to run after the component
and everything below it is unmounted; calling it after that runs them at once. `mounted`
takes functions to run once the component's nodes are in the document, children before
parents, and may only be called while mounting. `pending` takes a promise `render` will wait
for (below). A component may return anything `mount` takes, including another component or
a mounter of its own.

The body runs from a queue the mount drains once its own walk is done, never from inside a
reconciliation, so a component that edits state while mounting cannot corrupt the tree. A
body that throws names the component in the error, the rest of the queue still runs, and the
error reaches whoever made the change.

An assert reports a defect and does not recover: what was inserted before the throw stays in
the page, the caller of `mount` gets no remove function, and an array edited from the
delivery that threw keeps its edit. Fix the defect rather than catching the assert.

**`each`** mounts a component once per item, the item in `props.each`:

```ts
const Todo = ({ each: todo }) => h('li', { class: observer(todo).path('done').bool('done', '') },
	observer(todo).path('title'));

h('ul', {}, h(Todo, { each: state.todos }));
```

**A component under `each` renders the same node shape on every call.** The first row is
built and remembered; every row after it is a clone of that one with this row's values
written in, which is what makes a long list cheap. So the tags, their order, the prop keys
and which children are present have to be the same for every item. What changes per row is
values: text, attribute and property values, and what a scope or cell drives.

**A function is a value like any other, and it belongs to its row.** Each row's body is called
with a props object of its own, so a handler written in the body reads that row's `props.each`
whenever it fires, whether it goes on a nested component or straight onto an element as
`$onclick` (design 205).

Most of this is unchecked, and breaking it is quiet. A tag that varies keeps the first row's
tag, and a prop key or a child that only some rows have is dropped. Branch on the item inside a
value, not around the markup:

```ts
// Good: one shape, a value that varies.
({ each: todo }) => h('li', { class: observer(todo).path('done').bool('done', '') }, todo.title);

// Wrong: two shapes from one component. Every row takes the first row's tag, silently.
({ each: todo }) => (todo.done ? h('s', {}, todo.title) : h('li', {}, todo.title));
```

The prop keys have to match too, including the keys inside a `$style` object: a row that names
fewer of them than the first row did keeps the first row's, because a clone carries the style
it was cloned from. And what `h` returns inside such a body is only good for handing to another
`h` or returning; a body that keeps it, reads a property off it or mounts into it is not using
`h` to build the row, and the list quietly stops cloning when it can tell.

Two shapes means two components, each with its own `each`, or one component whose body mounts
the varying part as a child. Two breaks are caught. A row whose body returned something other
than the element `h` built for it, such as text or a pair, runs its body a second time, and the
list stops cloning from then on: its rows are correct and slower. A row that called `h` a
different number of times than the first row asserts, naming both counts, because its values no
longer line up with anything.

## Lists

A document array or a mutable array delivers every edit as the edit: a push inserts one
node, a splice removes one, a swap inside one `atomic` block moves the two row nodes
themselves, so an input inside keeps what it holds. Emptying the whole list when it is the
parent's whole content is one write. A plain array in a cell is diffed by reference when the
cell is replaced: rows that are the same value stay, others are made or removed.

```ts
state.todos.push(createObject({ title: 'ship', done: false }));   // one insert
atomic(() => { const t = todos[0]; todos[0] = todos[1]; todos[1] = t; }); // two moves
```

Register a scope where you read it, on the row rather than the document root: `observer(row)
.path('title')` costs nothing on writes elsewhere.

## Static render

```ts
const markup = await render(h(App, { url }));
```

`render` mounts the item into a light document this package ships, waits until nothing a
component declared `pending` is still pending, and returns the markup. Every dynamic part (a
scope, a component, each item of a list) is bracketed with `<!--[-->` and `<!--]-->`, which is
how `hydrate` finds it. No doctype is added. Inside `render`, `h` and `createElement` make
nodes in the light document, so a component works unchanged. `render(item, { context })`
hands `context` to every mounter below, as `mount` does.

A component that fetches declares it: `pending(fetch(url).then((r) => r.json()).then(fill))`.
A component that forgets renders its loading state into the page, which is visible. The
continuation runs outside the mount: set state in it and let the component's bindings build
the nodes, because `h` called from the continuation itself has no render document to make
them in.

## Hydration

```ts
hydrate(document.body, h(App, { url: location.pathname }));
hydrate(document.body, () => h('main', {}, 'ready'));
```

`hydrate` takes what makes the item: a component call, `h(App, props)`, or a function that
makes it, which is mounted as a component with no props. It cannot take the element itself.
Only a mount records which nodes the binding made, so an element built before the call was
made outside every mount and has nothing recorded about it; handed straight in, or returned by
the maker, it is refused, and the refusal names the maker form as the fix.

`hydrate` mounts that item over markup `render` wrote and adopts the server's nodes in
place: a matching element keeps its identity and gains the properties and listeners the
client gives it, text is adopted, lists keep working. Nothing is wiped and nothing flashes.

A mismatch between the markup and what the client renders is a defect: it asserts in
development, and in a release build the region that differs is replaced with what the
client built while the rest is kept. Only the top-level item is refused for being built
outside the mount. Deeper in the tree a node the application made outside the mount, by `h`
or by the page, is inserted as it is and stands in for the server's node of the same tag,
which is how a component keeps a canvas or a map it owns. Markup must parse back into the
tree `render` wrote: write `tbody` yourself, and avoid whitespace-only text where the browser
drops it.

**`hydrate` waits for what the page is still loading.** The pairing walk stays open until every
promise a component declared `pending` during the hydration has settled, so a page whose content
arrives one microtask later still claims the markup the server wrote for it. Until then nothing
has been checked and nothing the server sent has been taken away: what is on screen is the
server's markup, untouched.

```ts
const page = hydrate(document.body, h(App, { url: location.pathname }));
await page.ready;                       // every pending load settled, the markup checked
```

`ready` is on the remove function `hydrate` answers, and it resolves for a page with nothing
pending before the call has even returned. It never rejects: a mismatch found after the wait is
thrown on a fresh task, where the host reports it. Removing the hydration while a load is in
flight closes the walk and checks nothing, because the page it was pairing has gone.

A component that waits with `pending` and shows a loading state runs again on the client, and
showing that state over the server's finished markup is a mismatch, whatever the wait does after.
Either render what you know (give the resolved value as a prop from data the page embeds,
`h(Status, { known })`, which is what `recipes/dom/` shows) or show nothing while a hydration is
open: `hydrating()` answers whether the mount running right now is claiming server nodes, and
`@aweftjs/ui`'s `suspend` uses it to keep its fallback off the page during one.

An empty text node is inserted rather than paired. `''` renders to no characters, so the
markup holds no node to pair it with, and a form's error line that is empty until something
goes wrong is the ordinary case. The node goes in where the cursor is and the cell behind it
writes into a node that is really on the page.

One live hydration per target: a second `hydrate` over the same target asserts, because it
would claim the nodes the first one holds. Remove the first, then hydrate again.

## The light tree

`createDocument()` makes a document with no browser behind it: `createElement`,
`createTextNode`, `createComment`, `body`, `head`, attributes, `style`, `classList`, listeners
that are kept and dispatched only by `dispatchEvent`. `toHtml(node)` serializes. It applies no
auto-closing or implied elements.

`parseHtml(markup, document)` reads markup back into light nodes and **answers the top-level nodes
it read, not a document**. Put them somewhere yourself, which is what makes a page renderable,
parseable and hydratable in a test with no browser:

```ts
const document = createDocument();
for (const node of parseHtml(markup, document)) document.body.appendChild(node);
hydrate(document.body, h(App, {}));
```

It is also where `h` makes a node when nobody has said where: inside a mount the mount says,
outside one the page's `document` does, and where there is no page the light tree registers
itself as the answer. Nothing imports the light tree to arrange that: it registers the
no-page fallback from its own file, and `html` is built with a pure annotation, so a bundler
that follows both can leave the tree and the template parser out of a page that writes neither.

A bundle without the light tree has no fallback, so a program with no page document mounts,
renders, or makes a document with `createDocument()` before it calls `h` at module scope. `h`
with no mount, no page and no registration asserts `no document to make nodes in: mount or
render into one` rather than guessing.

## Mount targets and mounters

The target of `mount` is any element, or anything with `insertBefore`, `removeChild` and
`replaceChild`, so a component can intercept what its children mount by handing them an
object of its own. `mount(target, item, before, context)` places the item before another
mount's first node (`before` is that mount's remove function) and hands `context` down
unchanged to every mounter below. A component may return a mounter, `(elem, item, before,
context) => remove`, and call `mount` itself with a context of its own; `before(getFirst)`
answers the node to insert before. The binding never reads the context.

`createElement`, `createTextNode`, `setAttribute` and `watch` are the pieces a custom `h`
needs: they create through whichever document the current mount renders into and apply the
binding's rules for attributes. `watch(value, fn)` is `effect` for a value that may or may
not be reactive: a plain value is delivered once, a cell's value now and after every commit.

The light tree's classes are exported as types (`LightDocument`, `LightElement`,
`LightNode`, `LightText`, `LightComment`), with the host shapes `NodeLike`, `ElementLike`,
`TextLike`, `CommentLike`, `ParentLike` and `DocumentLike`, and `H` for the `h` that `htm`
binds.

## The router

```ts
import { createRouter } from '@aweftjs/dom/router';

const router = createRouter({ base: '/docs' });
const stop = router.links(document.body);

router.url.effect((url) => console.log('now at', url));
router.push('/guide/install');
```

A subpath export, so a page that never routes never loads it. `createRouter({ url, base })`
gives you:

| name | what it is |
|---|---|
| `url` | a read-only cell: the path, query and hash showing now, relative to `base` |
| `key` | a read-only cell naming the history entry. The same key comes back with back and forward |
| `push(url)`, `replace(url)`, `back()` | the three ways to move. Both take a path relative to `base`; a whole URL, or a path that already carries `base`, is a loud assert |
| `links(root)` | takes over same-origin anchor clicks under `root`, and returns its unsubscribe |
| `saved()`, `restore()` | the scroll position kept for the entry showing now, and putting the page back on it |
| `stop()` | stop listening for entry changes |

One history path: `popstate`, `pushState` and `replaceState`. `history.scrollRestoration` is
`manual` and positions are kept per entry key in `sessionStorage`, saved before a navigation
leaves an entry. The router restores nothing on its own: it answers `saved()` and does what
`restore()` says, and when to use them is the component layer's decision.

`links` leaves a click alone when a modifier key is held, when it is not the primary button, when
something already prevented it, when the anchor has `target` (other than `_self`), `download` or
**`data-no-route`**, when the href is cross-origin, another scheme, or outside `base`, and when the
href is this same page with a different hash on it. That last one is the browser's work: it scrolls
to the target and writes the entry, and the router picks the new URL up like any other entry change.

**One router per page.** A second one over the same history mints keys from the same counter and
writes into the same scroll slots, so the two would trade entry keys and restore each other's
positions. Make one and hand it to whatever needs it.

**With no `window` it is the same router over a stack in memory.** `push`, `replace` and `back` all
still move `url`, which is what lets a static render open the page a URL names and a headless test
drive a whole navigation. `links` returns a working unsubscribe that removed nothing, `saved()`
answers null and `restore()` answers false.

## What it never decides

What a component renders, how a site walks its pages, head tags, themes, and what any of the
router's URLs mean. Storage and transport are not here: a document array on the page is the same
document array a store persists or a link shares.

## Boundaries

`@aweftjs/dom` imports `@aweftjs/core` and nothing else. The complete program using all of
the above, with its DOM operations asserted one by one against the recording host in
`@aweftjs/testing`, is `recipes/dom/`.
