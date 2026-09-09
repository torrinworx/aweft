# 160: The Postgres driver takes a pool, owns its tables, and tells nobody anything

## Decision

`@aweftjs/store/postgres` exports `postgresDriver(pool)`, a `Driver` that keeps documents in
Postgres. It is a subpath on `store`, as design 140 says an adapter is.

**The application hands in the pool.** `pool` is anything whose `connect()` answers a client
with `query(text, values)` and `release()`, which is what `pg`'s `Pool` is. The type is
structural and written in this package, as `Pool` and `PoolClient` on the subpath and nowhere
else, so the subpath imports nothing, lists no peer, and needs no declaration package. The root
entry of `store` is untouched. `close()` marks the driver finished; the pool belongs to whoever
made it and is never ended here.

**The driver makes its own tables**, on `declare`, idempotently, in whatever schema the pool's
`search_path` names. Two applications on one database keep apart by schema, which the pool
already decides, so the names are fixed (`aweft_documents`, `aweft_rows`, `aweft_tail`,
`aweft_projection`, `aweft_version`) and nothing configures them. A version row is written
beside the tables. A version the driver does not know is refused before anything is read, in the
stack's one refusal shape, with the fix in the message.

**The driver tells no other process that a document changed.** The contract stays at twelve
methods. Live updates go through `sync`, and two processes holding one document live at once is
the topology the stack refuses: one end decides a document's commits (design 053).

**It is proven on a real Postgres in the gate.** `embedded-postgres` and `pg` are development
dependencies of `store`, allowed for that package only. The suite and the recipe start a server
per run, the way `sandbox` runs a real Chromium (design 070): the obligations this driver
takes on are transactional, and nothing but a real server enforces a row lock.

## Why

**A pool rather than a connection string.** Every application this stack is for already makes
one for its own SQL, so the driver joining it is one line, and the application keeps every
decision a pool makes: how many connections, how it authenticates, when it ends. A string would
have the driver import `pg` as an optional peer and refuse when it is missing; taking the pool
leaves nothing to be missing.

**The driver's tables are the driver's.** Design 049 says a driver builds its own index from
the declaration, and `declare` is where that happens. The alternative, SQL the package ships for
the application to run, puts a step between install and first write that a reader forgets.

**No notification.** A live remote watch is the one thing this driver does not do. The gap is
real and it is left open on purpose: a thirteenth method would be a
concept the application did not give the library, and nothing in the stack reads it. What
brings it back is written below.

**A real server.** Measured on one machine: initdb 380 ms, start 18 ms, stop 13 ms.
Half a second a run, against a suite that would otherwise prove its transactions on nothing.
The machine's own Postgres through an environment variable was rejected because a suite that
skips when the variable is unset is a guarantee without its check.

## What this costs

A 60 MB platform binary as a development dependency, downloaded once at install. An
application that wants the stack to own the connection writes `new Pool(...)` itself. A
deployment whose role may not run DDL cannot use the driver until the tables exist; that
deployment is the evidence for shipping the SQL as text as well.

## What would reverse this

The first migration running two server processes over one database, which would bring
notification back as an optional method. A deployment role without DDL rights, which would add
the shipped SQL. A second SQL target wanting the same driver, which would make the pool type
the thing to widen rather than the driver.
