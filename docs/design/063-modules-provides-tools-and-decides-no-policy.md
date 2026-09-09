# 063: `modules` provides load and unload, and decides nothing about when

## Decision

`createLoader({ sources, props })` returns a loader. A loader is an instance: two loaders
share nothing, and an application makes as many as it wants.

- `load(names)`: evaluate the named modules and everything they depend on, sort by
  dependency, instantiate in order whatever is not already loaded, inject, and return the
  named instances. A name in no source, a name with no implementation, a cycle, or a factory
  that throws is an error naming the module; what was instantiated before the failure stays
  loaded.
- `unload(name)`: call the instance's `stop` if it has one, drop the instance, and answer
  whether anything was loaded. Exactly that module: a loaded dependent keeps the reference it
  was handed.
- `loaded()`, `get(name)`, `dependencies(name)`, `dependents(name)`: the loaded graph, read
  only, so an application can cascade or refuse on its own terms.
- `follow(loader, document, handlers?)`: an opt-in helper. While it runs, a loaded module
  whose entry's `source` changes is unloaded and loaded again together with its loaded
  dependents, and a loaded module whose entry is removed is unloaded together with its loaded
  dependents. Reloads run one at a time. A reload that fails goes to `handlers.failed`, or is
  thrown from a fresh microtask when there is none, where nothing catches it and the process
  reports it as uncaught; one that finishes, and an unload, go to `handlers.applied` with the
  module's name, so a caller knows the loader has caught up without polling it. One change
  failing never ends the follow: a `stop` that throws during a reload is reported and the
  reload still lands, a handler that throws is reported the same way, and the queue goes on
  (an earlier shape died on either). Returns the function that stops
  following.

Nothing in the package loads a module nobody asked for, unloads one nobody asked about,
limits how many are loaded, watches memory, manages a process, or runs anything on a schedule.

## Why

The package imposes no rules on loading, unloading or how many modules are held in memory. It
provides the basic tools to load and unload, and nothing more. Which modules run, when, for
whom and at what rate are the application's reasons (tenancy, billing, throttling, a security
mark), and a rule here would be one every application has to work around.

Reloading on a changed source is opt-in rather than the default: a helper that reloads is a
policy, and an application that wants an approval step, a delay, or a different unit of reload
writes its own from the tools.

`unload` touching exactly one module, and `load` leaving earlier instances loaded on a failure,
are the literal tools. A cascade or a rollback is a policy, and `dependents` exists so the
application can write either.

## What it costs

An application writes its own cascade if it wants one. A dependent left holding a stale
reference is documented rather than prevented.

A factory that calls `load` re-entrantly for a module whose factory is waiting on it waits
forever. The loader cannot tell that call from an ordinary concurrent load, because nothing
isomorphic carries the identity of the caller across an `await`; the README says to declare
the dependency in `deps`, where a cycle is refused by name. A factory that unloads a sibling
named in the same `load` gets a `missing` refusal naming it.

## What would reverse this

Nothing foreseeable in the library. A default policy belongs above it, in `server` or in an
application.
