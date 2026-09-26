# 297: The bundler serves the source Node runs

Amends design 256, which gave Node and the compiler the `aweft-source` condition and left the
bundler out.

## Decision

`aweft()` gains vite's `configEnvironment` hook. When the plugin was itself loaded from
`plugin.ts`, it adds `aweft-source` to the resolve conditions of every environment the bundler
builds, so a page is served each `@aweftjs/*` package from `src/`, the same files the process
running vite reads. When it was loaded from the compiled `plugin.js`, it adds nothing and the
bundler resolves `dist/` as it did before.

An environment that names no conditions of its own gets vite's documented defaults with the
condition in front: `module`, `browser` and `development|production` for a page, and `module`,
`node` and `development|production` for a server render. An environment that names its own gets
the condition added to them, because vite joins a plugin's list onto the configured one rather
than replacing it.

That only holds when the plugin itself came from source, and under vite's default config loader
it never does. The loader bundles the config file and resolves every bare import in it to a file
path with a resolver of its own, whose conditions are fixed at `node`, so `@aweftjs/build` came
back as `dist/index.js` whatever Node was asked. So the config is loaded natively: every recipe
passes `configLoader: 'native'` beside `configFile`, and the scaffold's scripts and every README
that starts vite say `--configLoader native`. Node imports the config, `.npmrc`'s condition
reaches it, and the plugin loaded is `plugin.ts`.

The plugin's file extension is the test, the same one `sandbox`'s child runner reads to choose
its mode. A process that loaded `@aweftjs/build` from source asked for source, and the bundler
it configures should answer the same.

## Why

`.npmrc`'s `node-options` reaches Node. vite's resolver for the page is not Node's: it has a
condition list of its own, and `aweft-source` was not on it. So in an application carrying the
stack as a submodule, the process ran `packages/ui/src` and the page ran `packages/ui/dist`,
whatever age that was. `dist/` is written by `npm run build` and never committed, so after a
fix to the stack a page kept the build from before it with no message at all. The case that
showed it: a theme's `lineHeight: 1.5` came out `1.5px` on the page, a fault design 292 had
already fixed in `src/`, and every line of multi-line text overlapped.

The two other places to put the condition were weighed.

- **In the scaffold's vite config**, one line an application writes. Every existing application
  would need to learn it, the symptom does not name the cause, and the plugin every page already
  registers is the one piece that knows whether the stack came from source.
- **Always, whatever the plugin was loaded from.** A published package ships `src/` too, so the
  path exists, but an npm consumer's page would then compile the stack's TypeScript and `.tsx`
  from `node_modules`, which is the thing `dist/` exists to spare it.

## What this costs

Every vite command in an application carrying the submodule carries `--configLoader native`, and
one that leaves it off gets the compiled packages with no message where a `dist/` exists, and
fails to load its config where none does, as in a submodule that was never built. vite names the native loader
as the one it plans to make its default, which would retire the flag.

The gate's browser recipes ran each package's `dist/` before this, so their checks read a build
from whenever `npm run build` last ran rather than the source under review. They now read the
source, and a fault that existed only in `src/` shows there for the first time.

The plugin carries vite's two default condition lists, as written in vite's configuration
reference. A vite that changes its defaults leaves an environment with no conditions of its
own resolving the old ones until the lists here change.

A bundler that is rollup rather than vite does not call `configEnvironment` and is unchanged.

## Evidence

`recipes/full-stack/main.ts` asks the dev server it starts to resolve `@aweftjs/ui` from the page
and fails unless the answer is `packages/ui/src/index.ts`. With the default loader it answered
`packages/ui/dist/index.js`, and with the native loader and the hook taken out it answered the
same, so each half is needed. `packages/build/tests/modes.test.ts` checks the lists the hook
returns for a page, a server render, and an environment with conditions of its own.

## What would reverse this

The same thing that reverses design 256: Node running TypeScript under `node_modules`, so no
package needs two entries. Short of that, a vite that exposes its default condition lists to a
plugin's hook, so the plugin can extend them rather than repeat them, and a vite whose default
config loader is the native one, which retires the flag.
