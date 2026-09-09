# aweft

A full-stack toolkit for applications whose state is a document. An observable document is
the model, the wire and the storage format at once: assign to it, and the change is a commit
that a page renders, a peer receives and a store keeps. Every piece is a package with one job,
and a package that does not need another does not know it exists.

## Hello, three ways

A document:

```ts
import { atomic, createObject, observer } from '@aweftjs/core';

const doc = createObject({ title: 'plan', done: 0 });
const stop = observer(doc).path('title').watch(() => console.log(doc.title));

doc.title = 'plan b';                                   // one commit; the watcher runs once
atomic(() => { doc.title = 'plan c'; doc.done = 1; });  // one commit, however much it writes
stop();
```

A page:

```tsx
import { mutable } from '@aweftjs/core';
import { h, mount } from '@aweftjs/ui';

const Counter = () => {
	const clicks = mutable(0);
	return <button theme="button" onClick={() => clicks.set(clicks.get() + 1)}>clicked {clicks} times</button>;
};

mount(document.body, <Counter />);
```

A server:

```ts
import { auth, paths } from '@aweftjs/auth';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';

const store = createStore({ driver: memoryDriver(), declare: { ...paths } });
const server = createServer({ sources: [fromDirectory('./modules'), auth], store, gate: 'auth/Gate', listener: node({ port: 8080 }) });
await server.start();
```

That is the whole boot. Everything else the server does is a module in `./modules`, and the
page reaches it over one socket that carries both the shared documents and the calls.
`recipes/full-stack/` is the two halves in one directory, with the page reaching the server in
development through the dev server's proxy; its README carries the manifest and `tsconfig` an
application starts from.

## The packages

Everything from `codec` to `sandbox` runs anywhere. `dom`, `ui`, `icons` and `client` are the
page; `server` and `jobs` are the Node side; `auth` has a half on each. A package imports only
from its own tier or below, never across that line.

| Package | What it is |
|---|---|
| `@aweftjs/codec` | the encoding: values, deltas, commits, ids, positions |
| `@aweftjs/core` | observables, the deltas they produce, commits, scopes, identity |
| `@aweftjs/schema` | the shape a document must keep, checked before a commit lands |
| `@aweftjs/sync` | commits between two documents over any channel, both ends equal |
| `@aweftjs/store` | persistence over a driver; a memory driver and a Postgres driver ship |
| `@aweftjs/modules` | modules from directories, bundles or documents, loaded in dependency order |
| `@aweftjs/sandbox` | isolated rooms for module code that came from a document |
| `@aweftjs/dom` | direct DOM binding, hydration and static render; `@aweftjs/dom/router` for URLs |
| `@aweftjs/ui` | components, theming, a stage for routed pages, head tags |
| `@aweftjs/icons` | icon sets as modules, one icon per import |
| `@aweftjs/client` | one connection to a server for the life of a page |
| `@aweftjs/server` | connections and requests behind a gate, over a listener you supply |
| `@aweftjs/auth` | the first battery: the gate, sessions, sign-in and sign-up, per-user state |
| `@aweftjs/jobs` | a scheduler over an array of jobs the application holds |
| `@aweftjs/ssg` | a routed site written out as files, taken over in place when the browser arrives |
| `@aweftjs/build` | the vite plugin and the Node loader: JSX and markup to `h`, static hoisting, asserts out of a release |
| `@aweftjs/testing` | the harnesses the stack tests itself with, for a driver or a listener of your own |
| `@aweftjs/debug` | a document or a commit read back as text |

**Getting them.** Nothing is published to a registry yet. An application carries this repo
as a git submodule (`git submodule add <this repo's url> aweft`) and resolves each `@aweftjs/*`
name through a `file:` dependency on the package's directory; `recipes/full-stack/README.md`
shows the manifest and the two skills under `.claude/skills/` an application links. Node 24.12
or later.

## Where to read

- [`recipes/README.md`](recipes/README.md): everything that works, as programs the gate runs,
  indexed by the task you arrived with. Each ends with what it does not do for you.
- [`AGENTS.md`](AGENTS.md): the rules, in two halves. The first is for building an application
  with the stack, the second for changing the stack.
- [`spec/`](spec/): the wire format, the id scheme and the conformance fixtures, which are
  what a second implementation in another language would be held to.

Each package's README says what it is for and what it will not do for you, and every public
export carries a block comment with its parameters, what it returns, what it throws and an
example. `docs/architecture.md` is the plan, and `docs/design/` is one note per decision.

## License

MIT.
