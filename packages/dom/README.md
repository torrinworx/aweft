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

`html` is a tag for template literals. A tag or attribute value may be an expression:
`<${Component} title=${t}>`, `$onclick=${fn}`, `=${props}` spreads an object, `</>` closes
the innermost element. A quoted attribute may mix text and expressions (`class="row ${tone}"`)
and follows any cell inside it. Whitespace works as in JSX: lines are trimmed, blank lines
go, and a line break inside text is one space. Close void elements yourself (`<br/>`).
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
```

`hydrate` mounts the same item over markup `render` wrote and adopts the server's nodes in
place: a matching element keeps its identity and gains the properties and listeners the
client gives it, text is adopted, lists keep working. Nothing is wiped and nothing flashes.

A mismatch between the markup and what the client renders is a defect: it asserts in
development, and in a release build the region that differs is replaced with what the
client built while the rest is kept. A node the application made itself (rather than through
`h` or `createElement`) is inserted as it is. Markup must parse back into the tree `render`
wrote: write `tbody` yourself, and avoid whitespace-only text where the browser drops it.

A component that waits with `pending` runs again on the client, and starting its wait again
would render the loading state over the server's finished one, which is a mismatch. Give it
the resolved value as a prop from data the page embeds (`h(Status, { known })`), so it renders
what it knows and only waits when it has nothing; `examples/dom/` shows the pattern.

One live hydration per target: a second `hydrate` over the same target asserts, because it
would claim the nodes the first one holds. Remove the first, then hydrate again.

## The light tree

`createDocument()` makes a document with no browser behind it: `createElement`,
`createTextNode`, `createComment`, `body`, `head`, attributes, `style`, `classList`, listeners
that are kept and dispatched only by `dispatchEvent`. `toHtml(node)` serializes; `parseHtml
(markup)` reads markup back into light nodes, so a page can be rendered, parsed and hydrated
in a test with no browser. It applies no auto-closing or implied elements.

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

## What it never decides

What a component renders, how a site walks its pages, routing, head tags, themes. Storage
and transport are not here: a document array on the page is the same document array a
store persists or a link shares.

## Boundaries

`@aweftjs/dom` imports `@aweftjs/core` and nothing else. The complete program using all of
the above, with its DOM operations asserted one by one against the recording host in
`@aweftjs/testing`, is `examples/dom/`.
