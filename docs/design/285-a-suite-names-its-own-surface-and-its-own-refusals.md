# 285: A suite names its own surface and its own refusals

## Decision

The gate fails a package whose own suite does not name every value export in its `surface.txt`
or does not quote every reason in its `errors.txt`. `packages/testing/scripts/check-exercised.ts`
is the check and `npm run exercised` runs it. A test counts when it is a file directly in
`packages/<name>/tests`, which is where the runner reads suites from, is not `surface.test.ts`
and is not an `internal.*` file, and names the export or quotes the reason outside a comment. A reason that is the whole of a regular expression counts as quoted,
because a refusal's message opens with its reason and `assert.throws(fn, /reason/)` is the
shortest way a test asks for it.

The check covers a package once its suite is whole and never lets it go again: the list is in
the script, beside the coverage floors in `run-tests.ts`, and it only grows. It starts at the
five packages under `modules`: `codec`, `core`, `schema`, `sync`, `store`. A package not yet on
the list has its counts printed so the gap is visible on every run. `testing` is exempt for good:
its surface is the suites of the other packages and the gate's own scripts, so a test of its own
naming each export would be the padding the policy bans.

## Why

The definition of done says every public export is exercised by the package's own suite, and
a block comment saying `Throws: not-open` is a stated guarantee. Neither was checked by anything.
With branch coverage between 92 and 97 on the five packages, six exports were named by no test
in their own package (`assertValue`, `slotKeyOf`, `mirror`, `rootFrom`, `projectionOf` and a
re-export) and ten refusal reasons were produced by no test in the whole repo, five of them in
`store`. Coverage says a line ran; it cannot say that a caller can reach a refusal and read its
reason, which is the thing the refusal vocabulary promises.

## What this costs

A name is not a call. A test can name an export in a string or reach a reason by accident, and
the scan cannot tell. The check is a floor, and the operator sweep (design 287) is what stands
above it: a guard nobody tests survives the sweep whatever the scan says.

The scan reads text, not syntax. A `//` counts as a comment where one can start, at the line's
start or after a space, so the slashes of a URL in a string are left alone; a `//` written any
other way inside a string still ends the line for the scan, which shows up as a miss, never as a
pass.

One list to maintain. Adding a package is one line, once its suite is whole; the message says so.

## Evidence

`packages/testing/tests/exercised.test.ts`: a package whose suite misses one export or one reason
is reported by name, a name inside a comment does not count, and a whole suite passes. Each
covered package's suite, which the check reads.

## What would reverse this

A second package whose surface is consumed only by other packages' suites, the way `testing` is.
One is an exemption with a reason; two is a rule the check should state.
