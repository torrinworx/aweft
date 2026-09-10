# @aweftjs/modules

Modules from a directory, a bundle or a document, loaded in dependency order with their
dependencies injected. Tools to load and unload. No opinion about which, when, or for whom.

**Loading a module runs its code**, with the privileges of the process that loaded it. Nothing
here isolates anything. Load what you trust, or put your own boundary in front of this.

## Quickstart

```ts
import { createLoader, fromDocument } from '@aweftjs/modules';
import { fromDirectory } from '@aweftjs/modules/node';

const loader = createLoader({
	sources: [fromDirectory('./modules'), fromDocument(plugins)],
	props: { store },
});

const { 'posts/Create': create } = await loader.load(['posts/Create']);
await loader.unload('posts/Create');
```

`load` instantiates what you name and everything it depends on, dependencies first, and hands
back what you named. `unload` lets go of exactly one module, calling its `stop` if it has one.

**`props` is for what the platform hands in**, such as the store an application made before
there was a loader; anything the application itself makes is a module that others name in
`deps`. `@aweftjs/server` builds its loader that way and hands in `store` alone.

## A module

A module is a file, a bundle entry or a document entry that exports:

```ts
export const deps = ['auth/Session', 'lib/Log'];   // what it needs, by name
export const defaults = { maxLength: 80 };         // its configuration when nothing configures it

export default ({ imports, config, extensions, store }) => ({
	make: (title) => { imports.Log.log(imports.Session.userOf()); return title.slice(0, config.maxLength); },
	stop: () => { /* let go of whatever this holds */ },
});
```

The factory receives `imports`, `config`, `extensions`, and whatever props the loader was made
with. `imports` is keyed by the **last segment** of each dependency's name: `auth/Session` is
`imports.Session`. Two dependencies whose names end the same way are refused at `load`.

An **extension** is a same-named entry from another source that exports `config` or
`extensions` and no factory. Its `config` merges over the implementation's `defaults`, plain
objects one level at a time, arrays and everything else replaced whole. When several sources
carry one name, the earliest source's implementation wins and every source's config
contributes, earliest winning.

Whatever the factory returns is the instance. If it has a `stop` function, `unload` calls and
awaits it. Nothing else is read off an instance.

## Where modules come from

A **source** lists candidates and evaluates nothing until `load` asks for a name.

| source | names | evaluates by |
|---|---|---|
| `fromDirectory(path)`, on `@aweftjs/modules/node` | the file's path under `path`, no extension: `auth/Session` | `import()` of the file |
| `fromBundle(map, { prefix })` | the key without `prefix` (or a leading `./`) and its extension | the entry, or calling it when it is a function |
| `fromDocument(document, { compile })` | the document's keys | `compile(entry.source)` |

`fromDirectory` is on its own subpath because it reads the filesystem; the main entry loads in
a browser. `fromBundle` takes the two shapes a bundler's glob import produces, eager or lazy.

`fromDirectory` hands its path to `node:fs`, which resolves a relative one against the process's
working directory rather than the file that called it, so `'./modules'` finds nothing when the
program is started from anywhere else. Build an absolute path from `import.meta.url`:

```ts
const here = fileURLToPath(new URL('.', import.meta.url));
const loader = createLoader({ sources: [fromDirectory(join(here, 'modules'))] });
```

**A module document** is an observable object whose keys are module names and whose values
carry a `source` string. Every other field in an entry is yours: an author, a note, a list of
earlier versions. The loader ignores them.

```ts
const plugins = createObject({
	'plugin/Shout': createObject({ source: 'export default () => ({ ... })', author: 'ada' }),
});
```

That document is an ordinary document. Open it through a store and it is persisted. Share it
over a link and a second node loads the same modules. Its commit history is its version
history. This package does none of that and knows none of it: it reads `source` and nothing
about how it got there.

## Compile

`compile(source)` turns module text into exports. The default imports the text as an ES module
through a data URL, with no dependency. If your modules need a transform, pass your own as
`fromDocument(document, { compile })`.

`compile` is exported on its own so you can check a source before you store it:

```ts
try { await compile(draft); } catch (error) { /* refuse the draft */ }
```

Nothing here does that for you.

The default keeps every distinct source in the runtime's module cache for the life of the process.
[`bench/compile.ts`](https://github.com/torrinworx/aweft/blob/main/bench/compile.ts) measured it
on Node 25: about 5.6 KB of heap per distinct source, 53 MB for 10,000, and the same text imported
twice is one module. An application that compiles many versions of many modules supplies a compile
that does not keep them.

## The tools

| | |
|---|---|
| `load(names)` | instantiate these and what they need; returns the named instances |
| `unload(name)` | call `stop` if present and drop the instance; true if it was loaded |
| `loaded()` | the loaded names, in the order their factories finished, always a dependency order |
| `get(name)` | a loaded instance, or undefined |
| `dependencies(name)` | what a loaded module declared, or undefined |
| `dependents(name)` | the loaded modules that depend directly on it |

`unload` unloads exactly the named module. A loaded module that depends on it keeps the
reference it was handed, and will use it; ask `dependents` and unload those first if that is
what you want. A `load` that fails part way leaves what it already instantiated loaded and
throws naming the module that failed.

A loader is an instance. Make one per tenant, one per module, or one for everything; two
loaders share nothing.

Every error this package raises carries a `reason` you can branch on and the `module` it is
about: `missing` (in no source, or gone from it while loading), `no-implementation`,
`duplicate` (one source lists a name twice, such as `thing.js` beside `thing.ts`),
`invalid-name`, `cycle`, `ambiguous-import`, and `failed` (with `cause`). A `stop` that
throws is the module's own error and reaches you from `unload` as it was thrown.

**Declare dependencies in `deps`; do not load them from inside a factory.** A cycle written in
`deps` is refused by name. A factory that calls `load` for a module whose own factory is
waiting on this one cannot be told apart from an ordinary concurrent load, so it waits forever.
The loader has no way to see who called it.

## Following a document

Nothing here reloads a module on its own. If you want a loader's modules to track a document,
say so:

```ts
const stop = follow(loader, plugins, {
	failed: (name, error) => log.warn(name, error),
	applied: (name, action) => log.info(`${name} ${action}`),   // 'reloaded' or 'unloaded'
});
```

While following, a loaded module whose entry's `source` changes is unloaded and loaded again,
together with its loaded dependents: dependents first on the way out, dependency order on the
way back. A loaded module whose entry is removed is unloaded with its dependents. Anything else
does nothing: a changed field other than `source`, an entry nothing has loaded. Reloads run one
at a time, in the order the changes landed.

A reload happens after the commit that changed the source, not during it, so the loader has not
caught up the moment your assignment returns. `applied` is told when it has, with the module's
name and what happened to it; by then the new instances are in place. A reload that fails goes
to `failed` instead, or is raised where nothing catches it when you gave no handler, and the
process reports it as uncaught. One change failing never stops the follow: a module whose
`stop` throws is reported to `failed` and the reload still lands, a handler that throws is
reported the same way, and the next change is followed as usual. `stop()` stops following.

```ts
const caughtUp = new Promise<void>((resolve) => {
	const stop = follow(loader, plugins, { applied: () => { stop(); resolve(); } });
});
plugins['plugin/Count'].source = newSource;
await caughtUp;
```

## What this package never decides

Which modules load, when, how many, for how long, in which process, or at what rate. Who may
read, write, load or run one. Where a document comes from, whether anything persists it, or
what its history is. Whether the code is safe to run.

## Reading on

The design notes are in
[`docs/design/`](https://github.com/torrinworx/aweft/tree/main/docs/design) 061 to 065. The
contract this package is built to is the one an application's own modules are written to.