---
name: aweft-app
description: Build an application with the aweft stack. Use when writing a page, a server module or both against the @aweftjs packages. Scaffolds from recipes/full-stack, applies the five rules an application trips on, and drives the page in a real browser before reporting.
---

# Building with aweft

The stack's root is this repo, or `aweft/` in an application that carries it as a git submodule.
Every path below is relative to that root.

## Read, in this order, and no further

1. `README.md`, then `AGENTS.md`, the half headed *Building with aweft*. Stop at *Changing
   aweft*; it does not apply to an application.
2. `recipes/README.md`, and the recipe for the task you have. A recipe is a whole program that
   runs in the stack's gate and ends with what it does not do for you.
3. The README of each package you touch. It says what the package will not do, and that is the
   part to read twice.

Do not read `packages/*/src` or `packages/*/tests` to learn a rule. If a README did not say it,
report that in your findings as a documentation defect and keep going; the workaround is worth
less than the report.

## Procedure

1. **Scaffold from `recipes/full-stack/`.** Its README carries the application's `package.json`
   (each `@aweftjs/*` name as a `file:` dependency on the submodule's package directory), the
   `tsconfig` that includes `packages/ui/src/jsx.d.ts`, the vite config with `aweft({ defaultH:
   '@aweftjs/ui' })` and the proxy to the backend, and the backend boot. Copy the shape, not the
   files.
2. **Write the server as modules and the page as components.** A server module shares a
   document by name or answers a call; the page shares the same name and holds the same object.
   Public exports only: a deep import into a package fails at import time by design.
3. **Hold the five rules.** Theme segments are a list (`theme={['button', 'quiet']}`, never
   `"button_quiet"`); `each` builds one shape per list; your page entry paints the page
   (`background`, `color`, `minHeight`) and the HTML carries `<style>body { margin: 0 }</style>`; the Node loader runs from
   the application root with `AWEFT_DEFAULT_H` equal to the vite `defaultH`; the page reaches
   the backend in development through the dev server's proxy, the auth routes and a socket
   path of its own (`/ws`, `ws: true`), never a proxy entry for `/`.
4. **Read a refusal's `fix` before anything else.** Every error the stack raises carries a
   `reason` and a `fix`; `packages/<name>/errors.txt` lists them. The fix is usually the whole
   answer.
5. **Drive the page before reporting.** Start the backend and the dev server, open the page in
   a real browser, walk every state by keyboard in both modes, and listen for page errors and
   console messages at error level: there must be none. Then run `audit` and `walk` from
   `@aweftjs/testing/browser` over the page, in both modes, and there must be nothing to report.
   `recipes/full-stack/main.ts` shows the two listeners and both checks, with playwright, and
   `recipes/accessible-page/` a page that passes and three that do not. The build has already
   refused an element no one can read, and the mount throws on a nameless `Button` and a page
   with no `lang` or title; what stays yours to write is what no tool reads: a meaning carried
   by colour alone, the reading order, a heading that describes its section, a time limit, the
   same navigation on every page, an error message that says what to do.
6. **A stack bug is fixed in the stack.** Its regression test goes in the package that has the
   bug, inside the submodule, and the fix is pushed from there. The application never carries a
   patched copy of a stack file.

## Report

What you built, the command that runs it and its last lines, and the findings: each thing a
README did not tell you, with what you needed and where you expected to find it.
