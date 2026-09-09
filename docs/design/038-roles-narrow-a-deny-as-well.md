# 038: `roles` narrows any rule, a deny included

Superseded by design 057. Corrects a sentence in design 033.

## Decision

`roles` narrows the rule it is on, whichever effect that rule has. A deny naming roles refuses
only actors holding one of them. A deny naming none refuses everyone.

An actor holding no roles is reached by no role-scoped rule at all, allow or deny. So
enumerating roles on a deny does not cover an actor whose roles are empty.

## Why

Design 033 said "a deny is about the path, not about who", and the code has never behaved
that way: `applies()` has always filtered both effects by `roles` identically. The sentence
was written to explain a real limitation, which is that a deny cannot be scoped to "everyone
except", and it overreached into claiming denies cannot be scoped at all. The sentence and the
code disagreed, and nothing in the sentence said which was meant.

**The code is what stays**, for three reasons. One field with one meaning across both effects
is the smaller design, and making `roles` mean something on an allow and nothing on a deny is
exactly the two-meanings-for-one-word trap design 033 was trying to avoid. The behaviour is
order-independent, which is the property design 033 actually turns on: a role-scoped deny
still cannot be reopened by an allow written later. And a deny that quietly ignored `roles`
would be a rule that reads as narrow and refuses broadly, which is a worse silent failure than
the one being fixed.

**The limitation 033 was reaching for survives, stated correctly.** "Deny everyone except
moderators" is not one rule. It is a deny per other role, and it still misses an actor with no
roles, so the reliable shape remains an allow scoped to the actors who may write, with nothing
granting it to anyone else.

## What would reverse this

A policy set where authors keep writing role-scoped denies that miss roleless actors, which
would argue for refusing `roles` on a deny outright rather than for the current meaning.
