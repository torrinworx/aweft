# 077: Mount, hydrate and static render are one path with a mode

## Decision

`dom` has one mounter. It walks an item (a primitive, a node, an iterable, a document array,
a mutable array, a cell or derived value, a component, or the output of `h`) and produces
node operations against a parent. What differs between a page, a static render and a
hydration is only where nodes come from and what an insert does:

- **mount** creates through the page's `document` and inserts.
- **render** creates through a light node tree the package ships, inserts, brackets every
  dynamic mount with a comment marker pair, waits until nothing is `pending`, and serializes.
- **hydrate** creates through the page's `document` and, on insert under a parent whose
  children came from the server, claims the next unclaimed server node instead (design 078).

The surface is unchanged: `mount(target, item, before?, context?)`
returning the remove function, `h(tag, props, ...children)` with `$name` for a property and a
bare name for an attribute, `html` and `htm`, components as `(props, cleanup, mounted,
pending)`, `children` always an array, `each`, duck-typed targets, `getFirst`.
`render(item, { context? })` and `hydrate(target, item, context?)` are the two new entry
points, and `createDocument`, `toHtml` and `parseHtml` expose the light tree so a page can be
rendered, parsed and hydrated with no browser. Every type a signature names is exported, the
light classes as types only: nothing constructs a light node but its document.

User code runs from a deferred queue per mount root, never from inside a walk. A throw is
caught, the rest of the queue runs, and the first error is rethrown to whoever made the
change, so one failing component cannot wedge the queue for every later change.

## Why

Three implementations drift: every ordering rule the mounter learns has to be learned three
times, and where a compiled fast path is kept beside a runtime path, nine of the runtime
path's bugs have needed a second fix of their own. One mounter with a host seam learns each
rule once.

Creating nodes through the ambient host rather than a description keeps `h` what it is: it
makes real nodes, so `const box = h('div', { class: 'x' })` is an element the application can
hand to the browser. There is no virtual tree and no reconciliation; a slot binds to a node
through an effect and a list binds to commits.

Claiming at insert time rather than at creation is what makes hydration sound: `h` evaluates
children before parents and applications create nodes ahead of mounting them, so creation
order is not document order, but the mounter always knows the parent and the anchor when it
inserts.

## Where the binding registers

A list registers a shallow scope on the array it renders and a row's field registers on the
row (`observer(row).path('label')`), never on the document root. That is the rule the core
README states, and it answers an open question for this package: the
first package that registers the way a page does registers at the thing it reads, so the
root form does not need to be made cheap on its account. A page that builds every scope from
the root pays the walk `bench/write.ts` measured, and the README says where to register.

## What this costs

Hydration builds the client tree and throws it away after pairing. The markers are comment
nodes in the page. A component that does something with a node between creation and mount
sees the client node, not the server one, until it is mounted.

## What would reverse this

A render target where creating a real node is the wrong first step, such as a string-only
renderer that must not allocate a tree. That would be a second host, not a second mounter.
