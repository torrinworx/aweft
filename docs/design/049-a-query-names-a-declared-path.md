# 049: A query names a declared path, and an undeclared one is refused

Amended: `compare` and `holds` are on the surface for driver authors, so every driver orders
values and answers a condition the same way; the example file driver uses both and the driver
conformance suite checks the order they produce.

## Decision

`store` keeps a **projection**: one record per document, one value per **declared path**. A
path is declared as a list of literal steps. Every driver builds its own index from the same
declaration, and a query names a declared path or it is refused.

Refused, not scanned. `scan` exists separately, takes a required limit, and is named for what
it is, so an application that reaches for one knows it did.

A declaration holds literal steps only. `ANY` and `REST` are not declarable, because a pattern
with a wildcard names many paths inside one document and a projection has one value per path
per document.

The projection is written in the same transaction as the commit that changed it, so a query
never reads a document state that was never committed.

## Why

**Because one query has to mean one thing on every driver.** A query language that reads as a
single feature need not be one: a Postgres driver can build a real index while an IndexedDB or
memory driver opens a cursor over the whole store, matches in JavaScript, and throws past
5,000 records. The same query is then an index lookup on one driver and a capped scan on
another, and nothing in the API says so. That is the failure this design exists to prevent.

**Because a declaration does compile to a real index on the weakest driver.** On IndexedDB,
measured against 3,000 documents: 0.55 ms through the index
against 21.87 ms for the cursor that answers the same question, and the lookup stays flat as
the collection grows (0.021 us at 100 keys, 0.009 at 5,000). Compound indexes give filter plus
sort plus cursor pagination. So the surface belongs to `store` rather than to the drivers that
happen to be able to serve it.

**Because declaring up front is the only thing IndexedDB allows anyway.** `createIndex` is
legal only inside a version change. A path declared later is a schema version, not a lazy
`CREATE INDEX` on first query the way a Postgres driver can manage.

**Because keeping it fresh is cheap.** Finding the path a delta lands on is a walk up the rows
`store` already holds, so it needs nothing from `schema`: 0.299 us per delta at depth 2.
Matching that path against the declarations costs 0.7 us per delta at 2 declarations and 1.25
us at 20. On Postgres, inside the commit's transaction, the projection takes a commit from
0.125 ms to 0.212 ms at one declared path and 0.287 ms at twenty.

**Because the read is worth it and the alternative is not portable.** A declared read is 0.051
ms on Postgres at 20,000 documents. The same question against an undeclared path scans the
rows at 1.6 ms, 32 times slower and growing with the collection, and on IndexedDB the
equivalent pulls every record into JavaScript. An undeclared read is not slow in the same way
on two drivers, which is why it is refused rather than served.

## What this costs

**Declaring is a schema decision, made before the query.** An application that wants to filter
on something new declares it and takes a migration, which on IndexedDB is a version bump.

**Indexes are not free at the twentieth path.** Measured at 20,000 documents: 2.2 MB of rows
against 3.3 MB across twenty single-column indexes. Declaring everything is the whole-document
index by another route, and design 047 already measured what that costs.

**"Which documents have an urgent task" is not expressible.** `['tasks', ANY, 'status']` matched
834 deltas across 834 different array positions inside one document, and a projection has one
slot for it. That question wants one row per match rather than one per document, which is a
second index shape and is not built. It is a real gap and it is named rather than approximated:
a projection that silently held the last matching value would answer about one task while
looking like it answered about the document.

## What would reverse this

An application shape where the useful queries are mostly one-to-many inside a document, which
would make the missing index shape the main one rather than the exception. Or a driver target
that can serve an ad-hoc predicate with an index, which would make refusing an undeclared path
a restriction with no remaining reason.
