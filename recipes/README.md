# Recipes

Everything in this stack that works, as programs you can run.

Every recipe here runs in the gate and asserts its own outcome, so a recipe that has gone out
of date turns the build red rather than teaching you something that is no longer true. Run any
of them directly:

```
node recipes/todo-list/main.ts
```

They are indexed two ways, and the second is the one you probably want.

## By task

Start here if you know what you are trying to build.

| Recipe | The job | Packages it crosses |
|---|---|---|
| `full-stack/` | A page and a server in one directory: the page reaching the server in development through the dev server's proxy, and a sign-in that sets the cookie on that one origin | client, server, auth, store, modules, ui, build |
| `todo-list/` | A list you add to, toggle, filter and reorder, with the list following each edit rather than being rebuilt | core, dom |
| `two-clients/` | Two people editing one document at once, including what happens when they write the same slot and who yields | core, sync |
| `optimistic-write/` | A write that applies locally before the server sees it, is refused, and is rolled back | core, sync, debug |
| `debug/` | Finding a bug in a document you did not write | core, debug |
| `ui/` | A page with themes, contexts, control flow, a popup and a suspend, built by vite and driven in a real browser | core, dom, ui, build |
| `icons/` | Icons named three ways, and what each way puts in the bundle | ui, icons, build |
| `routed-site/` | A site with real URLs: nested pages, a page with a parameter, a page that arrives later, a dialog the back button dismisses, and a title per page | core, dom, ui, build |
| `ssg/` | A routed site written out as files, served by anything, and taken over in place when the browser gets to it | dom, ui, build, ssg |
| `static/` | A generated site served by the stack's own server: one process is the whole deployment, and the page still comes alive where it stands | modules, server, ui, build, ssg, static |
| `health/` | A deploy's verification: the health endpoint polled until the shipped build is the one answering, and the two states a poll must not mistake for health | store, modules, server, auth, health |
| `logs/` | A page recorded end to end in a browser and the visit read back: an error, a rejection, a console line, a failed call on both sides, a commit's shape with a private slot absent, a typed character never stored, sign-in mid-visit | store, modules, server, auth, logs, ui, client |
| `room/` | An act module stored on the server, run in a frame on the page: the board it shares reaches the server, its ask carries the page's identity, its own stage navigates on the page's URL under the host act, an error inside reaches the page's logs, and the frame paints but cannot fetch | sandbox, server, auth, logs, ui, client, build |
| `documents-on-postgres/` | Documents kept in Postgres: a writer killed mid-edit, eight processes opening one name at once, and a path declared after the data was there | store |
| `posts-to-pages/` | Pages written while the application runs: a post published over a socket becomes a page, and a scheduled full write refreshes the sitemap | store, modules, server, jobs, ui, ssg |
| `backend/` | The boot pattern to copy: a twelve-line boot file and a folder of modules, one holding a document, one the rules, one a scheduler, one the gate, and one configuring a battery module | store, modules, server, auth, jobs, client |

## By package

Start here if you know which package you need and want to see it do its hardest thing. What
each of these has to demonstrate is the table in `docs/architecture.md`.

`codec/`, `core/`, `schema/`, `sync/`, `store/`, `modules/`, `sandbox/`, `server/`, `jobs/`,
`dom/`, `ui/`, `icons/`, `build/`, `ssg/`, `static/`, `health/`, `logs/`, `debug/`.

## What a recipe is

A small real program that does a job someone would actually have. It uses public exports only,
exactly as you would from outside this repo. It asserts what it expects and exits nonzero when
an assertion fails.

A recipe that restates a unit test does not count, and neither does one that works around a
rough edge: friction found while writing one is a defect in the package, fixed there.

Each ends by saying what it does **not** do for you, because the thing you are about to assume
is usually the thing that will cost you an afternoon.

## Adding one

A package is not finished until it has a recipe (`AGENTS.md`, definition of done, item 6). A
task recipe needs no permission: if you had a question and the answer took you more than a few
minutes to work out, that is a recipe.

Register it in the `recipes` script in the root `package.json`, and add its directory to a
`tsconfig.json` that can see the packages it uses, so it is typechecked as well as run.
