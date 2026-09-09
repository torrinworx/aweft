# 126: What a stage puts in the render's registry

Design 152 adds `fallback` and `current` to the entry.

## Decision

Every `StageContext` adds one entry to the render's `stage` registry (design 109) while it is
mounted, and takes it out when it unmounts. The entry is read-only and holds three things:

| name | what it answers |
|---|---|
| `acts` | the declared keys, in the order the `acts` object itself lists them. Each carries `name`, `loader` (whether the act arrives through a loader) and `entries`, the act's own async parameter source or null |
| `prefix` | the path this stage's act keys are relative to. `''` at the root; for a nested stage it is what its parent actually matched, so `posts/3` and not `posts/:id` |
| `parent` | the entry of the stage above, or null |

**One spelling of `entries`.** It is on the act's row and nowhere else. The entry used to answer
`entries(name)` as well, which is the same function reached two ways, and one way per job is the
rule. A caller with a name rather than a row writes `acts.find((act) => act.name === name)`.

**The order is the object's own, not the order the source was written in.** A key that is a whole
number, `404` say, is listed first by every JavaScript object, wherever it appears in the literal.
Saying "declaration order" would promise something the language does not give, so a walk that needs
a particular order sorts the rows itself.

An act may declare `entries()`, an async function returning the parameter objects a static walk
should render it at:

```tsx
const Post = (props: { id?: string }) => <article>{props.id}</article>;
Post.entries = async () => [{ id: 'hello-world' }, { id: 'second' }];
```

**Nothing in the routing layer calls it.** It is declared here so that an act written now is
already walkable, and `ssg` reads it. An act with no `entries` and a `:param` in its key is a page a
static walk cannot enumerate, which is a thing the walk has to be able to say.

**How an act is declared, and how a loader is told from a component.** An act is either a
function, which is the component, or an object with a `load` field, which is the loader:

```tsx
const acts = {
	'': Home,
	'posts/:id': Post,
	'about': { load: () => import('./about.tsx') },
};
```

There is no marker on the function and no helper to wrap one. A component and a
`() => import(...)` are both functions of no useful arity, so nothing can tell them apart by
inspection, and calling one to find out runs an application's component body to answer a question
about its type.

## Why

Static generation has to enumerate the pages of a site from a render, and the alternative is
reading the source, which means a second implementation of the matcher living in a build tool. The
registry is already there for exactly this reason (design 109 reserved the slot), and a walk that
starts from one render of the site gets the nesting for free: each entry names its parent, so the
tree the URLs come from is the tree the components made.

The prefix is the matched path rather than the pattern, because that is what makes a child act's
URL: a nested stage under `posts/:id` at `posts/3` writes URLs beginning `posts/3/`, and a walk
that had the pattern would have to re-substitute the parameters to get there.

## What this costs

`entries` is surface with no consumer in the routing layer, which is the thing this repo usually
refuses. It is here because the alternative is that every act declared before `ssg` exists has to
be revisited when it arrives, and because static generation enumerates from the declared acts plus
an async `entries()`.

## What would reverse this

`ssg` finding it cannot walk from a render at all and needing a declaration file instead, which
would move the whole enumeration out of the component tree.
