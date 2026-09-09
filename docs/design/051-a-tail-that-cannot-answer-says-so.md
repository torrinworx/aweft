# 051: A commit tail that cannot answer the question refuses it

Re-scoped by design 053: "the host's window" is the application's own catch-up read; nothing in
`sync` resumes.

## Decision

`since(doc, seq)` refuses with `truncated` when the tail no longer reaches back to `seq`,
rather than returning the entries it happens to still hold. A caller either gets every commit
after `seq` or gets told it cannot have them.

## Why

**The documented way to detect this could not work.** The README and `since`'s own block
comment told a resuming caller to compare the first sequence it got back with the one it asked
for. After a full truncate there is no first sequence: `since(1)` returns `[]` while `head` is
5, which is byte for byte what a caller that is already current gets back. So a session that
missed four commits was told it had missed nothing, and the commit tail is the one mechanism
design 045 leaves for a session that fell behind.

The documented check, with `head` at 5 and the tail truncated whole:

```
ok     a partly truncated tail is detectable (first seq != asked+1) first seq = 4
BROKEN a fully truncated tail is detectable since(1) = []  while head = 5
```

**The partial case is detectable and the whole case is not**, which is the worst
shape: the check a caller writes from the docs passes its own tests and fails on the case that
loses the most.

**A refusal is what the caller can act on.** There is exactly one recovery, and every consumer
already has it: stop asking what changed and take the document. `sync` does this today for a
client outside the host's window. An empty array cannot be told from success, so it is the one
answer that leads nowhere.

## What it costs

One extra `head` read, and only when the tail comes back empty. A caller that treated `[]` as
"nothing new" now has to catch, which is the point: that reading was wrong whenever it was
also true.

## What would reverse this

A tail that is never truncated, which design 047 rejects, or a return shape that carries the
floor beside the entries. The second is a better answer if a caller ever needs to know how far
back the tail does reach, and nothing needs that today.
