# 242: An act may be a module name, and the stage builds one loader per mount

## Decision

An `acts` value is a component, as it always was, or the name of a module. The stage builds the
loader that finds it, the same way `createServer` builds the server's (design 240).

```tsx
<StageContext
	router={router}
	sources={[app, authClient]}
	client={client}
	acts={{ '': Home, notes: 'notes/Page', join: 'auth/SignIn', missing: NotFound }}
	fallback="missing"
	refused="join"
>
	<Stage />
</StageContext>
```

### What `StageContext` takes

Three more fields, all optional, and a static site names none of them.

- **`sources`**, the module sources, in precedence order, exactly as `createLoader` takes them.
- **`client`**, the page's connection. It is typed `unknown` because `ui` may not import
  `@aweftjs/client` (`boundaries.json`, and the tier rule), and its block comment says what it is.
- **`refused`**, an act name, for a load that rejects with a refusal (design 244).

**The stage builds the loader inside the provider, one per mount.** It calls
`createLoader({ sources, props: { client } })`, and leaves `props` out entirely when no `client`
was given, so a module's factory can tell a connection it was never handed from one that is
there. This is design 240's rule on the other plane: the platform hands in `store` on the server
and `client` on the page, and nothing else. Anything the application makes is a module that others
name in `deps`.

**A nested stage inherits its parent's loader**, through the same internal context that carries
the router, the query cell and the tail. It shares the parent's sources too, so a named act of a
child stage resolves out of the same list. **A nested stage that names `sources` of its own is a
loud assert**, naming the rule: one loader per routing tree, declared at the top. Two loaders
under one page would build two instances of a shared module and each would think it owned the
document, the socket or the timer inside it.

**A stage given no `sources` has no loader**, and a named act in its `acts` is a loud assert
saying to pass `sources`. That is the same class of mistake as a `fallback` naming an act that is
not declared, and it is caught at mount.

### What an act module is

An ordinary module (design 061). It declares `deps` and `defaults` like any other, and its
factory returns an object:

```ts
export const deps = ['auth/Session', 'notes/Current'];
export const entries = async () => (await listPosts()).map((post) => ({ id: post.id }));

export default ({ imports }) => ({
	title: 'Notes',
	component: () => <Notes user={imports.Session.user} notes={imports.Current.document} />,
});
```

- **`component`** is the component the stage renders. An instance whose `component` is not a
  function is a loud assert naming what to return.
- **`title`** is optional, and it is **the live region's announcement and nothing else**. When
  the act carries one, the stage says it after the act has mounted, instead of reading the head's
  title. The head is not touched: an act that wants the browser tab to change writes `<Title>` in
  its own component, the way every act already does, and the two are separate because a page
  whose title is `Docs: install` should not announce a string built out of the site name. An act
  with no `title` announces the head's title, exactly as before.
- **`entries`** is a **named export of the module**, beside `deps`, not a field on the instance.
  The static walk reads it from the candidate's exports, so listing a site's URLs runs no
  factory, opens no connection and builds no component (designs 126 and 145). The stage resolves
  it lazily, on the first ask, and answers `null` for a module that exports none.
- The instance is a module instance like any other: a `stop` on it runs when the stage unloads
  it.

### When a named act is loaded, and when it is unloaded

**Loaded when the stage decides it**, which is when the URL reaches it or `open` names it. The
stage calls `loader.load([name])`, so the module's dependencies are built first, in dependency
order, and the act's factory sees them in `imports`. The load goes through `suspend`, so a plain
mount shows the `LoaderContext`'s loading component while it arrives and its failed component if
it never does (design 112); under a hydration design 243 applies instead.

**Unloaded when the stage leaves it, after the next act is showing.** Exactly: the stage calls
`loader.unload(name)` from the incoming act's mount callback, the same callback that moves focus
and announces the title, and therefore after the incoming act's factory has run and its content
is in the page. The outgoing instance's `stop` runs there. When the stage leaves a named act for
nothing at all (no act matched and no fallback), the unload happens as soon as the stage knows
that, because no mount is coming to hang it on.

The order matters for a shared dependency. Both acts naming `notes/Current` in `deps` is one
instance, and unloading the outgoing act after the incoming one is loaded means the shared
document is never torn down and rebuilt between two pages that both hold it.

**The modules an act depended on stay loaded.** `unload` lets go of exactly the name it is given,
so a dependency stays for the page's life. That is what makes a shared document a
module: it is opened once, on the first page that needs it, and it is still there on the fifth.

**The page unloads them by going away.** When a stage that built its own loader is removed, it
unloads every loaded module in reverse load order, which is a dependency order reversed, so a
module stops before the modules it depends on. That mirrors `server.stop()` (design 240) and it
is the only thing in reach: the loader belongs to that mount, nothing else can be holding it, and
leaving a socket or a timer running after the page came down is a leak with no owner. A nested
stage that inherited its loader unloads only the act it was showing.

### `{ load }` is gone

`Act` was `ActComponent | LazyAct`, and `LazyAct` was `{ load: () => import('./page.tsx') }`. A
name is the lazy form now, and there is one way to write a lazy act rather than two.

The migration is one line in the acts map and one small file:

```ts
// before
acts = { about: { load: () => import('./about.tsx') } };

// after: acts = { about: 'site/About' }, sources = [fromBundle({ './site/About.tsx': () => import('./modules/About.tsx') })]
export default () => ({ title: 'About', component: About });
```

An act that has no dependencies and no title is three lines longer than it was. What it buys is
the thing the two forms could not share: a `deps` list, so the act declares the document, the
session and the rules it needs and gets them built in order, and a name, so another source can
replace it.

### The never-opening client

A static render has no connection. `render` is called with the acts map and no `client`, so the
loader's props are `{}` and a module that reads `client` off its props finds nothing.

**`ui` hands nothing, and the module decides what an absent connection means.** The alternative
was for the stage to hand in a stand-in client, and it cannot: `ui` may not import
`@aweftjs/client`, so it cannot name the type it would have to satisfy, and a duck-typed object
of `ui`'s own invention would be a second definition of what a client is, in the package furthest
from the one that owns it. The battery decides instead: handed no `client`, `auth/Session` is
anonymous at once (design 245), so `user` reads `null` from the first read, a gate refuses at
once, and the sign-in act is what a static render of a gated page holds. An
application module does whatever suits it, and the choice is visible in the module rather than
hidden in the stage. What it may not do is wait forever: `render` waits on every pending promise,
so a factory that awaits an answer nothing will ever give hangs the whole render.

**`ui` re-exports `Source` as a type**, the way it re-exports `Hydrated` from `dom`, so an
application annotates the sources it passes `StageContext` without importing `@aweftjs/modules`.

## Why

Four applications each carry a hand-built acts map inside a several-hundred-line file, with the
same two auth wrappers written out twice and a hand-written session file per page. Every one of
those is a thing a page needs before it renders and cannot declare: there was no
`deps` on the page plane, so the shared thing was built in the boot file and threaded through by
hand, exactly as it was on the server before design 240.

The acts map is the right place for the name because it is already the place the route lives: acts
are declared as data, and the name is one more piece of that data. A file-name grammar, a prefix
or a second folder would be a second routing system beside the one the page already has, and the
whole value of the module system is that it is one system on both planes.

## What it costs

**An act name that no source lists is a mount-time failure rather than a type error.**
`acts: { about: 'site/Abuot' }` compiles. The load rejects with the loader's own `missing`, which
names the module, and with no `refused` act it reaches the page as a rejected `suspend`.

**Every named act is a `suspend`**, so it is a dynamic mount with its own marker region even when
the source is eager and the load settles in a microtask. That costs two comment nodes in the
server markup per act and one region entry per hydration.

**A component act cannot declare `deps`.** Natives and composites stay plain components, and a
page that wants dependencies on one converts it to a module. That is the intended
gradient: a leaf component stays a component.

**The loader lists its sources twice for a named act with `entries`**: once for the load and once
for the lazy `entries` resolution. Listing evaluates nothing by contract (design 062), so for a
bundle this is a second walk of a map.

## What would reverse this

An application that has to run two independent module graphs under one page (a host page and a
guest page in one routing tree). That is the sandbox on the page, and it would reopen whether a
nested stage may build its own loader rather than being refused. A second thing the platform has
to hand every page module would reopen the props rule, and would be a note of its own.

## Evidence

`packages/ui/tests/stage.test.ts`: a named act loaded with its dependencies first and its
`component` rendered; the `stage` prop still reaching it; leaving it running its `stop` exactly
once, and only after the next act is showing; a dependency both acts name kept across the move
with its factory run once; a nested stage resolving a name through its parent's loader; a nested
stage with `sources` of its own refused with the rule in the message; a named act with no
`sources` anywhere refused; an instance with no `component` function refused; `title` announced
through the live region and the head's title announced when the act has none; a plain component
act unchanged; `entries` read from the candidate's exports with the factory never run; the
`LoaderContext`'s loading component shown on a plain mount while a named act loads; and a stage
unmounted with everything it loaded stopped in reverse load order.

`recipes/routed-site` renders and hydrates a site whose `about` act is the module `site/About`,
and the walk's URL list for that site is unchanged. `recipes/client` is a small application whose
whole page is modules: a gate, a shared document, three acts and the battery's sign-in form.
