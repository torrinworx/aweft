# 033: Nothing is granted by default, and a deny wins over any allow

Superseded by design 057.

## Decision

A rule states its effect, `allow` or `deny`, and the field is required. There is no default
effect.

A delta is authorized when at least one `allow` rule matches it and no `deny` rule matches it.
A deny wins whatever order the rules are written in. A path no rule matches is refused.

An empty policy authorizes nothing. Allowing everything is one rule and has to be typed:

```ts
const trusted: Policy = [{ effect: 'allow', path: [REST] }];
```

## Why

**Default deny is the only default that fails safe.** A policy is written once and read by
whoever changes the application later. A gap in it should refuse a write, not permit one, and
this is the direction every mistake wants to go: a region nobody thought about, a field added
next year, a role added next month.

**A required effect for the same reason.** A default of `allow` would mean a rule with a typo
in the effect field grants rather than refuses. A default of `deny` would mean a rule that
does nothing at all, which is a policy that reads as protection and delivers none. Making the
field required is one more word per rule and removes both.

**A deny wins, regardless of order, because order is a bug factory.** The alternative is
first-match or last-match, and both make the meaning of a rule depend on where it sits in a
list. Policies grow by having rules appended to them, so under last-match every append can
silently widen an earlier restriction, and under first-match every append can be dead on
arrival. Neither failure is visible in the rule being written. With deny winning outright, a
restriction cannot be undone by anything added later, and the reading of a policy does not
change when two of its rules swap places.

This also matches the shape of the thing being judged. A commit is an unordered set, and its
deltas are order-independent by `spec/format.md` 3.2. A policy that had to be read in order to
be understood would be the one ordered thing in a system that has deliberately removed
ordering everywhere else.

**The cost is that an exception takes two rules.** "Everything under a profile except the
verified flag" is one allow and one deny rather than an enumeration of the fields that are
allowed. That is the trade being bought: the enumeration is what goes stale when a field is
added, and the deny does not.

**And a deny cannot be reopened, which is not the same as a deny being unscoped.** An earlier
reading said a deny is about the path rather than about who, and that was wrong about the
code, which has always narrowed a deny by `roles` exactly as it narrows an allow. Design 038
settles it and this design keeps the part that is true: because a deny wins outright, there is
no way to write "deny everyone except moderators" as one rule. So a field that some actors may
write and others may not is granted rather than denied, and it must not also be covered by a
broader subtree grant, since two allows are still an allow. The proof program shows it: a
blanket grant of `['notes', REST]` hands every member the moderator-only field sitting inside
it, and the fix is the honest one, which is to name the fields the broad grant was
covering. Not being able to reopen a deny for some actors
is the same property that makes a deny worth having.

## What would reverse this

A policy set in a real application where the deny rules end up shadowing allows the author
wanted, often enough that authors start writing narrower allows to work around the denies. The
symptom would be denies whose paths keep growing more specific over time.
