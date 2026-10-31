# 319: The SQLite driver takes a handle, and a write takes the file's write lock

Applies designs 140 and 160 to a second SQL target. Design 161's write and tables, 162's
reconcile and 163's bytes carry over unchanged in what they promise.

## Decision

`@aweftjs/store/sqlite` exports `sqliteDriver(db)`, a `Driver` that keeps documents in one
SQLite database. It is a subpath on `store`, as design 140 says an adapter is.

**The application hands in the handle.** `db` is anything with `exec(sql)` and `prepare(sql)`
whose statements answer `run`, `get` and `all`, which is what `node:sqlite`'s `DatabaseSync` is.
The types are structural and written in this package, as `Database` and `Statement` on the
subpath and nowhere else, so the subpath imports nothing and lists no peer. Node ships the
module, so there is nothing to install and nothing to refuse when it is missing. The driver
never closes the handle and sets no pragma: journal mode, the synchronous level, the busy
timeout and the file's path are the application's, set on the handle it opened.

**The same six tables as the Postgres driver**, under the same names, made on the first call
that needs them, behind the same version row. The projection keeps a value in typed columns
behind a kind rank, as design 161 does, so the index pages in the order `compare` puts values;
a boolean is held as 0 or 1, because `node:sqlite` binds no boolean. No table references
another: foreign keys are a pragma, so a cascade would depend on a setting the driver does not
own, and `remove` deletes from each table itself, inside one transaction.

**A write is one `BEGIN IMMEDIATE` transaction**, and everything between `BEGIN` and `COMMIT`
is synchronous. `BEGIN IMMEDIATE` takes the database's write lock before the head is read, so
`head + 1` is read under the lock that makes it contiguous, which is the job design 161's row
lock does. Inside one process the synchronous block is what serialises writers on one handle:
nothing can run between two of its statements. Across handles, threads or processes, the lock
is the file's, and a second writer waits for the busy timeout its application set and is
refused with `SQLITE_BUSY` after it. The install and the reconcile take the same lock, which
replaces the Postgres driver's advisory lock.

**Slots merge in the driver, under the lock.** The row's slots are read, the patch's sets and
unsets applied, and the row written back, rather than in SQL with JSON functions. It is one
process with no round trip, so the statement count costs nothing, and the merge reads as the
memory driver's does. The reconcile's search for documents missing a field passes the field
names through `json_each`, which every SQLite since 3.38 has.

**Bytes in a slot are `{ bytes: <base64> }`** in the slots' JSON (design 163). The tail's body is
a blob.

**A zero byte in a string is refused with `zero-byte`**, in the same places the Postgres driver
refuses it, before the transaction opens. Measured on Node 25.2.1: SQLite stores the string, an
equality lookup finds it, and reading it back through `node:sqlite` stops at the zero byte, so a
document name comes back shortened. A slot inside the JSON survives, but a projection computed
from it in the reconcile would not, so the refusal covers slot names and values as well, and
the two SQL drivers refuse the same writes. A declared field name is refused the same way, in
`declare`, because the field is a text column too; Postgres refuses one with its own error
(`22021`) rather than `zero-byte`.

**Integers are read through `Number`.** A handle opened with `readBigInts: true` answers a
`bigint` for every integer column, and `head + 1` would then throw. Coercing the three integer
columns the driver reads keeps the driver working on a handle configured either way.

**Cursors** are the same JSON triple of sort field, value and name the memory and Postgres
drivers mint (design 060).

The exported surface is `sqliteDriver`, `Database` and `Statement`: the function and the two
types a caller writing its own wrapper around the handle needs, as `Pool` and `PoolClient` are
for Postgres.

## Why

**A handle rather than a path.** An application that keeps its own tables in the same file
needs the same handle, and the pragmas that decide durability and concurrency belong to the
place that opened it. A path would have the driver open the file, pick those settings, and own
a handle the application also needs.

**`BEGIN IMMEDIATE` rather than `BEGIN`.** A deferred transaction takes a read lock on its first
read and asks for the write lock on its first write. Two handles that both read the head first
then cannot both upgrade, and SQLite refuses one of them without waiting, whatever the busy
timeout. `packages/store/tests/sqlite.test.ts` runs four worker threads writing one document
on one file and asserts every write lands with contiguous sequences; with a deferred `BEGIN`
that test is red.

**No foreign keys.** `node:sqlite` turns `foreign_keys` on by default and an application may turn
it off. A cascade that silently does nothing then would leave rows behind a removed document.

## What this costs

The write lock is the whole database's, not one document's: writers to different documents take
turns, where Postgres lets them run together. Whether two processes write one file at all is the
application's decision; the driver only makes them take turns when they do. `node:sqlite` is
synchronous, so a write waiting for the lock holds the thread, event loop included, for up to the
busy timeout. For the one-process application this driver is
for, the synchronous block already serialised them. `node:sqlite` prints an `ExperimentalWarning`
on Node 25 when it loads, once per process; the driver cannot silence it without touching the
process's warnings, which are the application's. Text orders by UTF-8 bytes, which matches
`compare` for every string inside the basic plane, as the Postgres driver's `C` collation does. A document name holding a lone surrogate is not
refused: two such names can share one document here, as they do on Postgres and do not in the
memory driver.

## What would reverse this

`node:sqlite`'s API changing shape, which would widen the structural types. A consumer whose
write rate across documents makes the database-wide lock the cost that matters, which would
move it to Postgres rather than change this driver. A release of `node:sqlite` that reads text
past a zero byte, which would drop the refusal.
