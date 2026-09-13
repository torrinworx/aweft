# Security policy

## Reporting a vulnerability

Email torrin@torrin.me with the package, the version, what you found and how to reproduce it.
Do not open a public issue for it. You will hear back within seven days, and a fix goes out in
the next release, with the reporter named in the changelog if they want to be.

## Supported versions

The latest published version of every `@aweftjs/*` package. All packages version in lockstep,
and only the latest line receives fixes.

## Dependencies

The runtime dependencies are listed in each package's `package.json` and pinned in
`package-lock.json`, which is the inventory. `npm audit --audit-level=high` runs before every
push, through `.githooks/pre-push`, and before every publish; a finding at high or critical
blocks both until the dependency is fixed or replaced.

## What the stack claims

[`docs/security.md`](docs/security.md): the standard, what the stack owns and proves, and
what an application built on it still owns.
