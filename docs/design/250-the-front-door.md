# 250: The front door

## Decision

The repo opens for a reader building an application before it opens for a reader changing the
stack, and the three files that reader meets first are written for that job.

- The root `README.md` says what aweft is in four sentences, shows a document, a page and a
  server in a few lines each, maps the packages, and points at three places: the recipes by
  task, `AGENTS.md`, and `spec/`.
- `AGENTS.md` is two halves. *Building with aweft* is the rules an application trips on and
  nothing else, each stated once with a one-line example and the recipe that shows it: theme
  segments are a list, `each` builds one shape per list, the root entry paints nothing, the
  Node loader resolves from the working directory and reads `AWEFT_DEFAULT_H`, a page reaches
  a backend in development through the dev server's proxy with `ws: true`; and the three
  ideas underneath: the document is the API, cells against documents, a refusal carries its
  fix. *Changing aweft* is the gate, the coding standards, the tier and plane rule, the test
  policy, the definition of done, the two tests for deciding and the new-concept rule.
- `recipes/full-stack/` is the scaffold: a page and a server in one directory, the page
  reaching the server in development through the dev server's proxy, a sign-in that sets the
  cookie on that origin, and the application's own manifest and `tsconfig` shape in its
  README. The gate runs it.
- `packages/ui/README.md` opens with its rules, before the reference.
- The manifests are publishable: no package is `private`, each names its `files`. `LICENSE`
  is MIT and `CONTRIBUTING.md` points at the second half of `AGENTS.md`.

## Why

A program written from the docs alone is what judges the docs, and the ones written against
this stack said the same three things. A recipe taught more than a README, because it is a
whole program that ends with what it does not do. A refusal that carries its fix is usually the
whole answer. And the READMEs failed at the rule level, not the reference level: every export
was documented, and the five rules above were each stated nowhere, or shown once and never
said, so their writers reached for source to learn them. The rules are cheap to state and were
the largest share of what those readers had to learn that way.

A front door is where a reader decides how much of the rest to read. Without a root README the
first file an agent opens is whichever the directory listing puts first.

## What this costs

A rule stated in `AGENTS.md` and again in the ui README can drift; the recipe is the check on
both, because it runs. `recipes/full-stack/` starts a server, a dev server and a browser, so
it is among the slowest recipes in the gate.

## Evidence

`recipes/full-stack/main.ts` runs in the gate and fails if the page cannot reach the backend
through the proxy or the cookie does not land on the page's origin. What judges the prose is a
program written from the docs alone once this is in: what its writer still has to learn from
source has to be less than the five rules above.

## What would reverse this

A program written from the docs alone whose writer still reaches for source to learn these
rules. Then the rules leave prose for the machine: a theme string naming a variant without its
base is refused by name, and the README stops having to say so.
