# 101: A refusal carries its fix

## Decision

A refusal is `{ reason, detail, fix }`. `reason` stays the stable token a caller branches on,
`detail` stays what was actually seen, and `fix` is one sentence saying what to do instead. The
message renders as `reason: detail. fix`.

`fix` is required. `codecError(reason, detail, fix)` takes three arguments and the generated
error index goes red on a refusal that has none.

The shape stays in `codec`. `error.ts` imports nothing, `codec` is tier 1, and the three
packages that reach it only through `core` already carry it in their bundles, so a direct import
adds no runtime weight. Every package throws this and nothing throws a bare `Error`.

## Why

An agent reading a refusal has to decide what to do next, and today every message stops at what
went wrong. `unreachable: <id> has no attach path from the root` is accurate and leaves the
reader to infer the remedy.

The evidence is not local taste. A type-error ablation study across 2,400 repair trials found
agent success rising with the detail an error carries, from 24 to 41 percent with the least
detail to 41 to 63 percent with the most, and detail still helped models already near ceiling.
Errors are the one documentation a reader is guaranteed to meet.

Required rather than optional because an optional field on an error is a field that stays
empty. The gate is what makes it true.

## The one exception, and why

An error that crossed the wire keeps the far end's message. `sync`'s `requests` renders the
answerer's message as it was sent, because a caller asking a remote question wants the remote
answer and re-rendering it would print a reason and a fix twice over. The `reason` and `fix`
still ride on the object, and `explain` shows all three, so nothing is lost to anyone reading
the error rather than only its message. `sync`'s README says so where a caller meets it.

## What this costs

Roughly ninety sentences to write, once: 46 existing reason tokens and 45 converted `new Error`
sites. Bytes in every build, production included, because the fix ships in the message.

## What would reverse this

A measurement showing the fix text costs more bundle than it is worth on a page that never
throws. That would move the fix out of the message and into the index the reason points at,
keeping the field and changing where it renders.
