# 106: A refusal carries a suggested fix

**Not built.** The reasoning is written down ahead of the change, because a key concept changes only
behind a design note.

## Decision

`Refusal`, the shape an application's own rule hands back from an interceptor, grows a fix
beside its code and message:

```ts
interface Refusal {
	readonly code: string;
	readonly message: string;
	readonly fix?: string;
	readonly path?: readonly string[];
}
```

Every refusal in this stack then carries the same three parts, whoever wrote it: a stable token
to branch on, what was seen, and what to do about it.

`fix` is optional here, and that is the one difference from design 101. A library refusal is
written by this repo and the gate can require its remedy. A `Refusal` is written by application
code, and a gate in this repo cannot reach it.

## Why

Design 101 made every refusal the library throws say what to do. It could not reach the ones an
application writes, and those are the ones a user meets most: a guarded document throws
`RefusedError`, and its reasons all came from rules the application registered. So the reader
who most needs a remedy is the one least likely to get one, which is backwards.

`@aweftjs/debug` already lays a `RefusedError` out one line per refusal, and the line has
nowhere to put a remedy today. This gives it one.

## What the change touches

- `Refusal` in `core`, its one exported definition.
- `WireReason` in `sync` and the refusal rows in `sandbox`, which are the same three fields on
  a wire and would otherwise drop the fix at the boundary. Whether the fix crosses is part of
  this change, not a separate one.
- `schema`, which builds refusals from a failing shape and can offer a real remedy naming the
  field and what it wanted.
- `debug`'s `refusedOf`, which prints the fix when there is one.

## What this costs

A field on a wire shape, so it needs a `spec/CHANGELOG.md` entry and a fixture if it crosses.
Optional means most application refusals will not carry one, and a field that is usually empty
is a fair thing to be suspicious of. It is optional anyway, because the alternative is refusing
an application's own rule for not writing prose, which is not this library's business.

## What would reverse this

The field staying empty in real applications, including the ones migrated onto this stack. If
nothing fills it, the honest move is to delete it rather than keep a slot nobody uses.
