# Benchmarks

Nothing here is part of any package and nothing here is gated. These scripts exist so a
performance claim can be re-run instead of believed: every claim in a README or a design
note cites one of them and the
numbers it printed.

## The loop for proving a change

Follow it in order. A step skipped is how a change that did nothing gets kept.

1. **Baseline.** Run the committed script, unchanged, on the machine you are about to measure
   on. Numbers from another machine, another day or another script are not a baseline.
2. **A hypothesis with a number.** Say what you think is slow, why, and how much you expect to
   get back. "This should help" is not a hypothesis; "one system call per id is most of the
   cost of making ten thousand objects, so pooling should take the create path from 61 ms to
   about 35" is.
3. **The change on a copy.** Make it outside the repo, on a copy of the sources the script
   reads. A change measured in place is a change you have already decided to keep.
4. **The same script again.** Same script, same shapes, same machine, back to back with the
   baseline. Alternate the two if the machine is busy.
5. **Keep it only if it moved.** The move has to be larger than the noise band below, nothing
   else in the script may regress, and the root gate has to be green with it. A change that
   wins one line and loses another has not been measured yet, it has been chosen.
6. **Write both numbers down.** Before and after, naming the script. An experiment that showed
   a change was unnecessary is a good result and gets written down too: the plan loses a change
   it did not need.

## The scripts

| Script | What it answers | Run |
|---|---|---|
| `derived.ts` | What derived value propagation costs, on four graph shapes | `node bench/derived.ts` |
| `write.ts` | What a write costs before anything derived from it runs | `node bench/write.ts` |
| `store-postgres.ts` | What a write costs on the Postgres driver, in milliseconds and write-ahead log bytes, and what a declared read costs through its index at 20,000 documents | `node bench/store-postgres.ts` |
| `replicate.ts` | What replication costs: position bytes, commit bytes, distinctness | `node bench/replicate.ts` |
| `guard.ts` | What a guard costs per commit as the document grows | `node bench/guard.ts` |
| `compile.ts` | What loading a module costs per distinct source | `node --expose-gc bench/compile.ts` |
| `dom-grain.ts` | Which grain the DOM binding consumes, against a linked fake tree | `node bench/dom-grain.ts` |
| `dom-rows.ts` | The row table in Chromium: create, update, swap, remove, clear | `node bench/dom-rows.ts` |
| `dom-heap.ts` | Ten create-and-clear cycles in Chromium, heap after each, both idioms | `node bench/dom-heap.ts` |
| `dom-alloc.ts` | What creating 10,000 rows allocates in Chromium, by the function that allocated it, both idioms | `node bench/dom-alloc.ts` |
| `dom-live.ts` | What 1,000 rows still hold in Chromium once they are up, by the function that allocated it, both idioms | `node bench/dom-live.ts` |
| `hoist.ts` | What static hoisting is worth in Chromium: the benchmark row built through `h` calls against one `template` instance, inside a mount and outside one | `node bench/hoist.ts` |
| `perf-lab.ts` | The row path in Chromium at a finer grain: small operations repeated inside the timed block, the cell-of-array idiom that is the only caller of `setItems`, the same row as a hoisted template on the `compiled:` lines, and the DOM calls per row for both | `node bench/perf-lab.ts [label]` |

`npm run bench` runs all of them in order. The six browser scripts, `dom-rows.ts`,
`dom-heap.ts`, `dom-alloc.ts`, `dom-live.ts`, `perf-lab.ts` and `hoist.ts`, need the Chromium the root gate installs (`npm run browser`); they emit the
packages to plain JS with `tsc` first, so they measure the sources as they stand, not a stale
build.

`dom-alloc.ts` and `dom-live.ts` read Chromium's sampling heap profiler over a CDP session. Both
are sampled, so two runs of one shape on one machine compare cleanly and one line inside a run
does not compare to another to the byte. `dom-alloc.ts` counts everything, short-lived objects
included, and `dom-live.ts` counts only what survives a collection.

`derived.ts` compares against other libraries only when they are installed, which is deliberate:
`npm i --no-save alien-signals @preact/signals-core @vue/reactivity` before running it, and
nothing in the repo depends on them.

## The noise band

Measured on this machine by running `dom-rows.ts` five times back to back with nothing else
running. Each invocation already takes the best of five inner repetitions, and these are the
spreads *between* those five invocations, as a share of the median:

| Line | Spread across five invocations |
|---|---|
| create 1,000 rows | 15% |
| replace all 1,000 rows | 16% |
| create 10,000 rows | 9% |
| clear 10,000 rows | 25% |
| append 1,000 rows to 1,000 | 74% |
| the sub-millisecond lines (update, select, swap, remove) | the timer's own resolution |

The band is wide, and it is wider than it looks from one invocation. So:

- **Run each script five times and compare the best of the five**, never one run against one
  run. The best is the run with the least interference in it; the mean measures the machine.
- **Treat a move under 15% of the best as unproven** on the millisecond lines, and do not read
  the sub-millisecond lines at all except to see that they have not become millisecond lines.
- `append 1,000 rows to 1,000` and `clear 10,000 rows` swing far enough that only a large move
  means anything on them.

`dom-grain.ts`'s clear line swings about 40% the same way. This is why the gate does not check
speed: a guard at this spread is either flaky or toothless.

## The numbers to beat

The comparison target is **the reference page**: a page built with another library, doing the
same job, measured on the same machine in the same run. It is not in this repo and nothing here
depends on it; these are the numbers it produced.

On `bench/dom-rows.ts`'s shapes, in Chromium:

| Shape | The reference page |
|---|---|
| create 1,000 rows | 5.7 ms |
| create 10,000 rows | 64 ms |

On the framework row table, the CPU geometric mean across benchmarks 01 to 09 with the
reference page as 1.00:

| | Target |
|---|---|
| Prebuilt row elements in a list cell, the reference page's own idiom | at or under **1.00** |
| A document array with a component per row | as close as the pass gets, with the remaining gap named and its cause taken from a profile |

Both row idioms are supported and both are documented. Which one an application uses is the
application's choice, not a recommendation this file makes: the first is faster and the second
replicates.

On `bench/dom-heap.ts`, the target is a **flat** series for both idioms: the heap after the
tenth create-and-clear cycle is the heap after the first, give or take the collector's own
slack. A rising series is a leak, and it is invisible to every other script here.

### What designs 154 to 157 moved

Measured on this machine, before and after the pass on `core` and `dom` (designs 154 to 157),
each script run three times and the best kept. The before column is the same scripts on the same
machine minutes earlier.

| Line | Before | After |
|---|---|---|
| `dom-rows.ts` create 10,000 rows | 103.3 ms | 74.8 ms |
| `dom-rows.ts` clear 10,000 rows | 17.3 ms | 13.9 ms |
| `perf-lab.ts` create 10,000 | 99.8 ms | 88.8 ms |
| `perf-lab.ts` compiled: create 10,000 | 87.6 ms | 78.3 ms |
| `dom-alloc.ts` total, a document array | 125.5 MB | 94.6 MB |
| `dom-alloc.ts` total, prebuilt elements | 46.9 MB | 38.0 MB |
| `dom-live.ts` total, a document array | 5.48 MB | 3.43 MB |
| `dom-live.ts` total, prebuilt elements | 2.29 MB | 1.59 MB |

On the framework row table, one run, medians of ten, taken with nothing else on the machine,
the reference page as 1.00. The CPU geometric mean is over benchmarks 01 to 09 on the
benchmark's `total` metric, the library's script time plus the browser's paint of the same DOM.
`script` alone is given beside it: paint does not change with the library and swings with the
order the entries run in. The result files hold per-metric statistics; read
`values.<metric>.median`, not the first value of the object, which is the minimum.

| | Before | After |
|---|---|---|
| A document array with a component per row, `total` | 1.087 | 1.076 |
| Prebuilt row elements in a list cell, `total` | 1.027 | 0.993 |
| A document array with a component per row, `script` | 1.900 | 1.765 |
| Prebuilt row elements in a list cell, `script` | 1.501 | 1.253 |
| A document array, run memory (benchmark 22) | 6.01 MB | 4.91 MB |
| Prebuilt elements, run memory (benchmark 22) | 6.52 MB | 4.40 MB |
| A document array, run and clear memory (benchmark 25) | 1.37 MB | 1.40 MB |
| Prebuilt elements, run and clear memory (benchmark 25) | 1.75 MB | 0.94 MB |

After against before in that run: the document idiom 0.990 on `total` and 0.929 on `script`, the
prebuilt idiom 0.968 and 0.835. What did not move is the document idiom's clear line, 30.2 ms
against the prebuilt idiom's 24.2: the commit's part of a clear is under a millisecond per
thousand rows, and the rest is the row teardown, which those changes did not touch.
