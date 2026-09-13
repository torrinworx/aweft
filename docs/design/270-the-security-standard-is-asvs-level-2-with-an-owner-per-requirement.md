# 270: The security standard is ASVS 5.0 at level 2, and a table says who owns each requirement

## Decision

The stack's security standard is the OWASP Application Security Verification Standard, version
5.0, at level 2, the way its components hold to WCAG 2.2 AA. `docs/security.md` says what that
claim means: the stack meets every level 1 and level 2 requirement it owns, each backed by a
named check the gate runs, and every other requirement has an owner.

`docs/security/asvs.csv` is the claim as data: one row per level 1 and level 2 requirement,
`id,level,owner,check`. The owner is one of four words. `stack`: the check names the case that
proves it, `suite: <name>` for a case of `securityChecks()` on `@aweftjs/testing` (design 271)
or `test: <file>#<title>` for a test in a package's own suite. `application`: the check names
the pattern or the recipe an application follows. `operator`: what the deployment in front of
the process owns, such as TLS. `none`: why the requirement does not apply here. The table
carries ids and the stack's own columns only; the requirement text is the standard's, read
beside it.

`npm run security` runs `packages/testing/scripts/check-security.ts` over `checkSecurityTable`
in `packages/testing/src/security-table.ts`, in the root gate. Red: a `stack` row naming a suite
case that does not exist, or a test file or title that does not exist; a suite case citing an id
the table lacks; a row with an unknown owner, an empty check or a malformed id; a duplicate id.

## Why

The client and ui side follow a standard whose requirements are numbered, testable and
levelled, and that is what turns "accessible" from a sentiment into a check. Security had no
such thing here, and a claim no check backs is a defect by the rule in `AGENTS.md`. ASVS has the
same shape: numbered requirements, three levels, testable one by one.

A standard for applications cannot be met by a framework alone, because a framework does not
know what the application stores or who its users are. What a framework can do is own the
requirements it builds (sessions, the gate, the bounds, the encoders) and say, per requirement,
what is left. The owner table is that residual list, and it is what lets a small agent build on
the stack without an audit of its own: the `application` rows are its whole checklist.

Level 2 rather than 1, because anything with a sign-in is past level 1 by the standard's own
guidance; rather than 3, because level 3 asks for things outside one process, such as hardware
keys and an operations story.

## What this costs

Two hundred and fifty rows to keep true. A new version of the standard is a re-mapping. A
reader wanting a requirement's words opens the standard, since the table does not copy them.

## Evidence

`packages/testing/tests/security-table.test.ts`: a good table passes; each malformation named
above is refused with its row named; a case citing an id the table lacks is refused. The gate
runs the check over the real table and the real suite.

## What would reverse this

A newer ASVS, or a standard written for a stack of this shape, a document protocol over one
socket, rather than for HTTP applications.
