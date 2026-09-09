# 100: The create path reaches the bar the performance pass was given

## Decision

The create path question is closed. It stood open as the create path in `core`, measured against
the reference page, with `build` named as the thing that would settle it, and `build` has landed.

The bar: the CPU geometric mean at or under 1.00 against the
reference page for the reference page's own row idiom, prebuilt elements in a list cell, with the
document idiom as close as the pass gets and its residual named. Measured over four passes of the
framework row table:

| | Before `build` | After `build` |
|---|---|---|
| create 10,000 rows, prebuilt elements in a list cell | 1.200, 1.206 | 1.092, 1.098 |
| create 10,000 rows, a document array with a component per row | 1.254, 1.258 | 1.127, 1.158 |
| CPU geometric mean, the reference page's own idiom | 1.052 | 1.003 |

The create line is about 9% faster in both idioms, and the geometric mean is 1.003, best of two
passes, against a bar of 1.00. That is inside the noise band `bench/README.md` records, so the bar
is met rather than beaten.

The document idiom stays above the reference page and its residual is the one named when the
question was left open, unchanged by `build` because it is not construction: creating 10,000 rows
runs 178 ms of JavaScript in that idiom against 109 ms in the prebuilt one, and the difference is
the commit itself, one entry built, inverted, ordered and grouped per attach edge and per field,
plus a position chosen and a component body run per row. Hoisting removes construction, and
construction was never the document idiom's residual.

## Why

The question stayed open because a runtime pass had taken the create path as far as measurement
said it would go and the next lever was a compile-time one that did not exist yet. It does now.
Static hoisting is what closed the gap: the same benchmark row costs 28.5 ms per 10,000 built
through eight `h` calls and 13.4 ms as one template instance (`bench/hoist.ts`, design 089).

Leaving a question open past the thing that settles it is how it turns into a standing one. The
work that builds the thing a question names is what answers it.

## What this costs

Nothing in the code. What it costs is that the numbers above are the last word on the create path
until somebody re-measures: they came from the framework row table, which lives outside this repo,
so no script in the gate reproduces them. `bench/dom-rows.ts`, `bench/perf-lab.ts` and
`bench/hoist.ts` measure the same shapes here, and `bench/README.md` holds the numbers to beat and
the loop for proving a change against them.

## What would reverse this

A measurement showing the geometric mean back above the bar, which would mean something in the
row path regressed. Or the document idiom becoming the one an application is told to reach for
first, which would make its residual the bar rather than a named cost.
