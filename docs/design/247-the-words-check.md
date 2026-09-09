# 247: The words check

## Decision

`packages/testing/scripts/check-words.ts` reads every tracked file for the vocabulary of how the
stack was built and prints each line that carries a word from the list, with what to write
instead. `npm run words` runs it, and the root gate runs it first.

The list is in `packages/testing/src/words.ts`, one entry per word with its fix: a maintainer by
name, a calls file id, a record or decision id in the old spelling, a log id, a review step, a
build step or the branch it ran on, a comparison to another library, a session, an agent by model,
an application by name, a date in prose. Each pattern is written against the spelling the process
used, not the bare word, so `batch` in a delivery loop and `session` in `auth` are left alone.

Four tracked files are not read: `spec/CHANGELOG.md`, because a changelog carries dates on
purpose; `package-lock.json`, which is not prose; and the two files that define and test the
check, which have to spell the words to look for them.

With paths, the script reads those files and directories instead of the whole tree, so one
directory can be checked on its own.

## Why

Design 246 says the process leaves the repo. A rule like that is a sentiment until something
fails when it stops holding, and the place it stops holding is a comment written in a hurry
that says who asked for the thing. A word list is checkable; "no process vocabulary" is not.
The check was red over the whole tree when it was written. The design notes were cleaned
against it first and the rest of the tree after them, and it joined the gate only once it was
green over everything, which is what makes the cleaning finished rather than mostly done.

The fix beside each entry is the point of the list. "Do not write this" is a refusal; "state the
rule the call settled" is an instruction.

## What this costs

A legitimate sentence that happens to use a listed spelling has to be reworded. The list is
written against the process's own spellings to keep that rare, and it errs toward missing a
sentence rather than refusing one that belongs: a sentence that narrates the work without a
listed word is caught by a reader, not by the machine.

The check reads text, not syntax. It cannot tell a comment from a string, so a string a test
plants on purpose has to avoid the list or the test file has to be added to the skipped set.

## Evidence

`packages/testing/tests/words.test.ts`: one planted line per entry in the list, each reported
under its name; the words the code needs left alone (a `batch` variable, an expired session, the
calls document, "leave the equals sign off"); a line carrying two words reported twice; every
entry naming a fix; and the script run on a temporary directory, red with the line and its fix
and then green.

## What would reverse this

A word the code needs in a spelling the list refuses. That is a change to the list, not to the
rule. The rule itself is reversed by design 246 being reversed: a repo that names owners and
dates on purpose has no use for a check that refuses them.
