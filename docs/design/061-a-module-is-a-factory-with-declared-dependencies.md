# 061: A module is a factory with declared dependencies, and an instance may say how it stops

Amended by design 263: a tie in the dependency order breaks by the order the sources listed the
modules, not by name.

## Decision

A module is what a file, a bundle entry or a document entry exports:

- `deps`: the names of the modules it needs, in the loader's namespace (`auth/Session`).
- `defaults`: its configuration when nothing configures it.
- `config` and `extensions`: what an extension-only module contributes to the module of the
  same name.
- `default`: the factory, `(props) => instance`, synchronous or not.

The factory receives `imports`, `config`, `extensions`, and whatever props the loader was made
with. `imports` is keyed by the last segment of a dependency's name, so `deps: ['auth/Session']`
is reached as `imports.Session`; two dependencies of one module sharing a last segment are
refused at `load`, by name. `config` is `defaults` with every extension's `config` merged over
it, the earliest source winning. `extensions` is every extension's `extensions` merged the same
way.

An instance is whatever the factory returns. If it carries a `stop` function, `unload` calls it
and awaits it before dropping the instance. Nothing else is ever read off an instance.

## Why

This is the contract every module in an application is already written to, and the module
system meets what it has to meet by carrying that contract rather than improving it. `stop` is
the one addition: a module that can be unloaded and loaded again while the process runs
(designs 062, 063) may hold a timer, a socket or a subscription, and without a hook nothing can
let go of it. Optional, because existing modules return none.

The short `imports` key is how modules are written today. Refusing a shared last segment fails
loudly where the same key would otherwise overwrite one dependency with the other in silence.

## What it costs

A module cannot depend on two modules whose names end the same way. Renaming one is the fix.

## What would reverse this

A real module that needs two such dependencies. Then `imports` gains the full name beside the
short one, which is additive.
