# 256: A published package ships JavaScript, and the repo still runs TypeScript

Amends design 252, which said the manifests are publishable. They were not: every package pointed
its `exports` at `src/index.ts`, and no consumer installing from a registry can run that.

## Decision

A package on npm ships compiled JavaScript and declarations in `dist/`. The repo, and an
application carrying the repo as a submodule, keep importing `src/*.ts` and keep the edit-and-run
loop that has no build in it. One `exports` map serves both, through a condition:

```json
"exports": {
	".": {
		"aweft-source": "./src/index.ts",
		"types": "./dist/index.d.ts",
		"default": "./dist/index.js"
	}
}
```

Whoever wants the source asks for it by name. `--conditions=aweft-source` is that ask, and an
`.npmrc` carrying `node-options=--conditions=aweft-source` is how a repo asks once for every
script npm runs in it. This repo has one. An application with the submodule writes the same line,
and its `tsconfig` names the condition in `customConditions`.

`dist/` is built, never committed. `npm run build` writes every package's, and each package's
`prepack` writes its own, so no publish can carry a stale one. The packages compile in
dependency order, read from their manifests, because `tsc` resolves a bare `@aweftjs/x` through
that package's `dist/`: from a clean tree, or over a stale one, every package a package imports
is built before it.

The compile is two passes, because the stack compiles its own JSX:

- `.tsx` goes through `transform` from `@aweftjs/build` first, which is what turns markup into
  `h` calls (design 110). TypeScript's own `jsx` setting would emit `.jsx`, which Node cannot run.
- Everything then goes through `tsc` with `--rewriteRelativeImportExtensions`, so `./value.ts`
  in the source is `./value.js` in the output and a bare `@aweftjs/core` stays bare.

`erasableSyntaxOnly` already forbids every construct that compiles to something, so the second
pass erases types and rewrites extensions and does nothing else.

### What a room may read

`sandbox`'s child runner granted the room `<repo>/packages/` and `<repo>/node_modules/`, found by
walking three directories up from its own file. Installed, that walk lands outside the
application. The rule it was reaching for holds in both layouts and is now written directly: a
room may read the directory holding this package's siblings, and the nearest `node_modules` above
it. In the repo those are `packages/` and the workspace's `node_modules/`; installed they are
`node_modules/@aweftjs/` and `node_modules/`, and the first is inside the second.

The child also runs whichever mode its host runs. A host loaded from `.ts` spawns the room with
`--conditions=aweft-source` and the `.ts` bootstrap; a host loaded from `.js` spawns neither. The
runner reads its own extension to know which, because a path inside `new URL()` is a string the
compiler does not rewrite.

### The versions packages name each other by

`^0.1.0`, not the exact version. Two copies of `@aweftjs/core` in one install would give a page
two `RefusedError` constructors and two id sources, and `instanceof` stops answering. A caret
range lets a resolver collapse the set to one copy; an exact pin invites the second.

## Why

Node refuses to strip types from a file under `node_modules` and offers no flag, no hook and no
condition that changes its mind. That is not a policy this repo can argue with, so publishing
source was never available. The choice was only ever where the compile goes.

Putting it at publish time and nowhere else keeps what the repo is good at. The stack is read and
changed as TypeScript that runs as it stands, a recipe is a program someone runs directly, and a
bug found in an application is fixed in the submodule and seen on the next run. A build in that
loop would cost every one of those to serve a consumer who is not in the loop at all.

A condition is what separates the two readers without a second manifest. The alternative was a
`prepack` that rewrites `exports` before packing and puts it back afterwards, which means the
manifest in the commit is not the manifest that ships, and the gate checks the wrong one.

## What this costs

`node packages/core/tests/x.test.ts`, run directly rather than through npm, resolves to `dist/`
and fails when there is none. The flag is what the runner needs and the `.npmrc` only reaches
what npm starts. The failure names the missing file, which is a thin clue to a missing flag.

An application with the submodule now carries two lines it did not carry before, one in `.npmrc`
and one in `tsconfig.json`, and nothing checks that it did until something fails to resolve.

Two compilers touch `ui`, so a `.tsx` fault can come from either. The transform's own errors name
the file and line (design 110); `tsc` names the generated intermediate.

The room's read grant is wider when installed: `node_modules/` holds every dependency the
application has, not only the stack's. The seat belt is looser than it was in the repo, and it was
never the wall; `wrap` still is.

## Evidence

`packages/testing/scripts/check-publishing.ts` runs in the root gate and refuses a manifest whose
`exports` names no `aweft-source`, whose `files` omits `dist`, whose version is not the one the
rest carry, whose internal ranges are `*`, or which would publish private. `packages/testing/tests/behavior.publishing.test.ts` is its suite.

What proved the problem and each half of the fix:

- Node, importing a package whose `exports` names a `.ts` file:
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. A `load` hook returning that source as
  `module-typescript` gets the same refusal, because the check runs after the hook.
- `npm pack` on a manifest carrying `publishConfig.exports` packs the original `exports`
  unchanged, so that route to two manifests does not exist.
- A package reached through a `file:` symlink resolves to `src` under
  `--conditions=aweft-source` and to `dist` without it, which is the submodule application and
  the npm consumer reading one map.
- `node-options=--conditions=aweft-source` in `.npmrc` reaches every script npm runs and nothing
  it does not.

## What would reverse this

Node allowing type stripping under `node_modules`. Then `dist/` and the condition both go, the
map points at `src` again, and design 252's claim becomes true as written.

Short of that: a bundler-only future, where no consumer runs the stack under Node directly and
`dist` can be one file per package rather than a mirror of `src`.
