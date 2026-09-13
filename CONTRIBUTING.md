# Contributing

The rules for changing this stack are the second half of [AGENTS.md](AGENTS.md), *Changing
aweft*. Read that first; it is short and it is binding. The first half is for building an
application with the stack and does not apply here.

The short version:

- The gate is `npm test` at the repo root. It typechecks, checks the dependency rules and the
  tier table, regenerates and compares every package's public surface and refusal vocabulary,
  checks the theme contract and the security table, runs every package's tests with coverage,
  and runs every recipe. A change is done when the gate is green, and a result is reported with
  the command and its exit code. `npm install` at the root points git's hooks at `.githooks/`,
  where `pre-push` runs the gate and `npm audit` before anything leaves the machine.
- A security claim is a row in `docs/security/asvs.csv` with its check beside it; `docs/security.md`
  says what the stack owns and what an application built on it still owns. To report a
  vulnerability, `SECURITY.md`.
- A change to a key concept (the list is in `docs/architecture.md`) gets a design note in
  `docs/design/` before it is built, in the shape the notes there have: what was decided, why,
  what it costs, the evidence, and what would reverse it.
- Every public export carries a block comment with Params, Returns and an Example, and its
  package's README says what the package will not do for you.
- Say what the code is, not how it was built: `npm run words` names any sentence that does the
  latter.
- One logical change per commit, an imperative title of 72 characters or fewer, a body that
  says what and why, no attribution trailers.
