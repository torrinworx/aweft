# 287: An operator sweep runs beside the gate

## Decision

`packages/testing/scripts/sweep.ts` copies the repo into a scratch directory, flips one operator
at a time in one package's sources, runs that package's own suite against each flip, restores the
file, and prints every flip the suite let through with its file, line and the operator. The
flips are the comparison operators, the logical operators and the boolean literals in a return.
`npm run sweep -- <package>` runs it, on request, never inside `npm test`, and `--only=<file>`
narrows it to one file or a few. Each suite run takes two test files at a time rather than one
per core, because a sweep is hundreds of runs in the background of a machine someone is using.

The rule for what it prints: every survivor is either killed by a test or written down as
equivalent, with the reason, wherever the change that ran the sweep is written up. A survivor
nobody classified is a guard nobody tested.

The site finder and the flip are in `packages/testing/src/sweep.ts` with their own tests, so what
the script does to a line is pinned; the script is the copy and the loop.

## Why

The test policy already says how to find out whether a guarantee is checked: delete the code
that implements it and watch for red. This is that rule made mechanical. Run once against the
five packages under `modules` at branch coverage above 92, a first crude version left 33 of 173
flips alive in `codec` and 7 of 53 in `schema`. Some were equivalent (a `<` that becomes `<=`
behind a guard that already excludes equality). Others were not: the decoder's tag-width guard
was tested from neither side, three refusal guards kept passing when their `||` became `&&`
because each had a fixture for one side only, and the nesting and integer limits were tested one
past the boundary and never at it.

## Why beside the gate and not in it

One flip is one run of a suite. `core` has hundreds of sites and a suite that takes seconds, so a
sweep of it is the better part of an hour. The gate has to stay something a person runs before
every commit. The sweep is run when a package's tests change, and its numbers are recorded with
the change, the way `bench/` records performance.

## What this costs

Equivalent survivors, classified by hand each time. A crude operator set, and a finder that
reads lines rather than syntax: a `<` in a type parameter is not a site because the finder wants
spaces on both sides; a line carrying a line comment, one that starts a line or follows a space,
is left alone rather than parsed; an operator is skipped as inside a string when an odd number
of one quote character precedes it on its line, which is right for a string that opens and
closes on that line and wrong for an apostrophe in a string, a regular expression, or a
template literal spanning lines. The wrong cases surface as a survivor that a reader classifies
in a glance, or as a site never tried, never as a false kill. The finder is deliberately dumb so
that what it does is obvious from the survivor line.

## Evidence

`packages/testing/tests/sweep.test.ts`: the finder names every site on a line and none inside a
string, a comment or a type parameter, a URL's slashes do not make a comment, and each flip
produces the line the survivor report shows. The script is the copy and the loop, and its
evidence is each run's numbers: for `codec`, 33 of 173 survivors before the tests this note came
with and 18 of 186 after, every one of the 18 read and classified as equivalent.

## What would reverse this

A suite fast enough that the whole sweep fits inside the gate. Then it joins `npm test` and this
note is amended to say so.
