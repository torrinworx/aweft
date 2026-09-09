# 097: What the assert strip removes

## Decision

In a release build the transform removes one shape and nothing else: an expression statement
whose whole expression is a call to a name imported by name from a neighbouring `assert` module.
A neighbouring module is a relative specifier whose last path segment is `assert`, with or
without an extension, which is how every `assert` in this repo is imported.

Once the calls are gone, the import specifier goes too if nothing else in the file still names
it, and the whole import declaration goes if that was its only specifier.

Three things are deliberately left alone:

- `import assert from 'node:assert/strict'`, because it is a default import and the specifier is
  not relative. Tests keep their assertions.
- `assert` used as a value rather than called: passed to something, or stored.
- A call to `assert` that is not the whole of a statement, so `const ok = assert(x, 'm')` keeps
  its call rather than losing its initializer.

## Why

`assert()` throws in development and compiles out in production, and dev-only bookkeeping hides
inside assert side effects. Removing the statement removes both, which is what that promises.

The three exclusions are all the same rule: remove a statement whose only effect is the assert,
and never remove anything whose value something else reads. A call in an expression position has
a value, even if it is `undefined`, and taking it out changes the expression around it.

Matching on the import rather than on the name means a variable called `assert` that came from
somewhere else is untouched, and a page that imports `node:assert` for real reasons keeps it.

## What this costs

2.8 KB of the 40.2 KB browser bundle is what it takes back, measured. What it costs is that an
application whose own asserts are not imported from a neighbouring `assert` module does not get
them stripped. That is a naming convention the transform imposes on anyone who wants the strip,
and it is documented in the package's README rather than inferred.

## What would reverse this

A configured list of names to strip, if applications start wanting their own asserts removed and
their own file layout. That is an option on `transform`, not a change to this rule: the default
would stay what it is.
