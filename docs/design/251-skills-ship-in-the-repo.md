# 251: Skills ship in the repo, and an application links them

## Decision

Two skills live in this repo under `.claude/skills/`: `aweft-app`, the building-with half of
`AGENTS.md` as a procedure (scaffold from `recipes/full-stack/`, the five rules, run the
page's own check before reporting), and `aweft-stack`, the changing half as a procedure (the
design note before a concept change, the gate, the surface diff in the commit).

An application that carries this repo as a git submodule links each skill into its own
`.claude/skills/` directory:

```
ln -s ../../aweft/.claude/skills/aweft-app .claude/skills/aweft-app
```

It does not copy the directory. `recipes/full-stack/README.md` carries the line.

## Why

One skill per reader, not per package. What a program written from the docs alone gets wrong is
between packages (a page reaching a server, a `.tsx` compiled two ways, a theme string in the
wrong spelling), which a per-package skill cannot see and a README restated as a skill does not
add to.

Whether a skill inside a submodule loads in the application above it was measured, not
assumed. A probe skill placed in a submodule's `.claude/skills/` is not listed by a session
opened in the parent project; the same probe is listed by a session opened inside the
submodule; and a symbolic link from the parent's own `.claude/skills/` to the submodule's
directory is listed. So the skill ships once, in the repo, and the application's setup is one
link.

## What this costs

One more step for an application, and one that depends on the discovery rules of a tool this
repo does not control. A copied directory would work the same way and go stale; the link is
preferred because a fix to a skill lands in every application on the next submodule update.

## Evidence

The two files exist and `recipes/full-stack/README.md` states the link. The measurement above
is repeatable in a minute with an empty parent repo and a submodule holding one probe skill.

## What would reverse this

The tool loading a nested `.claude/skills/` on its own. Then the link line leaves the README
and nothing else changes.
