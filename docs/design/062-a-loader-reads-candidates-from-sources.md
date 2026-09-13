# 062: A loader reads candidates from sources, and a document is one of them

Amended by design 263: the order of `sources` is the load order as well as the precedence, and a
document source lists its entries sorted.

## Decision

A source answers `candidates()`: a list of `{ name, exports() }`, where `exports()` evaluates
that candidate and returns its exports (design 061). Listing evaluates nothing. Only `load`
calls `exports()`, and only for the names it needs.

Three sources ship:

- `fromDirectory(path)`, on the `@aweftjs/modules/node` subpath: every `.js`, `.mjs` and `.ts`
  file under the directory, named by its path relative to the directory without the extension,
  evaluated with `import()`. On its own subpath because it reads the filesystem, and the main
  entry has to load in a browser.
- `fromBundle(map, options?)`: a record of path to exports, or of path to a function returning a
  promise of exports, the two shapes a bundler produces. A name is the key with any leading
  `./` and the file extension removed, or with `options.prefix` removed when it is given.
- `fromDocument(document, options?)`: an observable object whose keys are module names and
  whose values carry a `source` string. Other fields are the application's and are ignored.
  `exports()` is `compile(source)`, with `options.compile` standing in for the default.

`compile(source)` turns module text into exports. The default imports the text as an ES module
through a data URL. An application passes its own when its modules need a transform, and
`compile` is exported on its own so an application can check a source before it stores it.
Nothing in this package checks a source on its own.

Precedence is the order of the loader's `sources`, one rule for every kind: the first
candidate with a factory is the implementation, and every candidate's `config` and
`extensions` contribute, earlier winning. Within one source there is no precedence: a source
that lists one name twice (`thing.js` beside `thing.ts` in a directory, two bundle keys that
reduce to one name) is refused by the loader as `duplicate`, because shadowing inside a source
would be silent.

A path becomes a name by one rule for both path-reading sources: the prefix or a leading `./`
goes, then the last extension, whatever it is. A path that leaves no name is refused as
`invalid-name`.

## Why

One shape for a definition is what lets a module from a file and a module from a document go
through the same graph, which is the point of a module that can be stored and sent:
nothing about a module changes when it moves from disk to a document to a peer over a link.

An object rather than a map, measured on core: a map's keys are ids, so `createMap` refuses a
module name as a key (`invalid-id: an id is 16 characters`). A collection keyed by module name
is therefore an object.

Keyed by name rather than a list of `{ name, source }`, because `follow` (design 063) maps a
changed key to a module without a scan, and because a keyed collection cannot hold two entries
under one name.

The default compile was measured on this repo's Node: a source exporting `deps` and a default
factory imports through a data URL and runs, with no dependency. Its cost is that every
distinct source stays in the runtime's module cache for the life of the process. An
application that compiles many versions supplies a compile that does not keep them, which is
what the seam is for; the README carries the number.

## What it costs

Nothing is cached: reading a source twice lists twice, so a document that changed between two
loads is read as it is now. The subpath for `fromDirectory` is one more entry to know about.

## What would reverse this

A source kind that cannot list without evaluating. None of the three is one.
