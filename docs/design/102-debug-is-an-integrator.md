# 102: `debug` is an integrator, and nothing may import it

Amended: the enforcement claim below was wrong.

## Decision

`@aweftjs/debug` enters `boundaries.json` as an integrator, the slot `testing`, `auth`, `aweft`,
`ssg` and `build` already occupy. It may import anything. Nothing may import it, which the
integrator rule already enforces without a new exception.

It is one package rather than a `debug` subpath on each package.

## The amendment: the rule is narrower than the line above says

The claim that nothing may import `debug` and that the machine enforces it is half true.
`packages/testing/src/boundaries.ts` returns early for an integrator source, so an ordinary
package importing `debug` fails the check, and another integrator importing it does not. `auth`,
`testing`, `ssg` and `build` could all reach it today.

That is left as it stands rather than fixed, because tightening it is a rule change across five
packages that have nothing to do with this one, and the thing it would prevent has not happened.
What is enforced is the case that matters: no package in the runtime stack can pull `debug` into
an application's bundle by accident. An integrator doing it deliberately is a different problem
with a different answer.

## Why

The rule stops the runtime stack reaching `debug`, so "never pulled in by accident" is checked
by the machine instead of maintained by hand. An application imports it deliberately or not at
all.

One package because the vocabulary has to be one vocabulary. A reader asking why a node did not
update should not first have to work out which package owns the answer, and twelve subpaths is
twelve places for the same word to drift. `debug` explains a commit, a document, a scope and a
mounted node in one set of words because one package chose them.

Not inside `testing`, though `testing` is also an integrator and already reaches everywhere.
`testing` is a devDependency by convention and captures for assertions. `debug` is imported by
applications, including into a running server during triage, and formats for reading.

## What this costs

A package that exists for readers rather than for the stack, so nothing in the gate depends on
it and its own recipe is the only thing that proves it works.

## What would reverse this

An integrator importing `debug` and shipping it somewhere it does not belong. That is the case
the amendment above leaves open, and the answer to it is the boundary rule, not this tier.
