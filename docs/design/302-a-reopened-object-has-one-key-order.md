# 302: A reopened object has one key order

## Decision

When the store rebuilds a document from its rows, every observable's slots are ordered the way a
Postgres jsonb value orders an object's keys: by length in UTF-8 bytes, then by those bytes. A
document reopened from any driver has its object keys in that order. A driver carries no order
obligation of its own.

## Why

The spec gives an object no order (`spec/format.md`, section 1), and the Postgres driver keeps a
row's slots as jsonb, which reorders keys whatever order they were written in. The memory driver
kept them in the order they were written, so an application whose tests ran on it could depend on
key order without knowing, and see the order change the first time production reloaded the
document. Keys added in one commit already came back sorted; keys added across commits did not.

One function, `snapshotOf`, rebuilds every document, whatever driver stored it. Sorting there gives
every driver the same order, including one written outside this repo, and adds no rule to the
driver contract. Sorting inside the memory driver instead would have left the file driver in
`recipes/store`, and any other driver an application writes, with an order of its own.

Making Postgres keep insertion order would need a second column or a different type for every row,
to give objects an order the spec says they do not have.

## What it costs

A sort per observable on every open. A row's slot count is the width of one object, and an open
already walks every slot once to rebuild it.

A live document still holds its keys in the order they were written until it is closed and
reopened. An application that wants an order keeps it in an array or a field, which it had to do
for Postgres already.

## What would reverse it

The spec giving objects an order. Then the store would keep that order and every driver would
have to store it.
