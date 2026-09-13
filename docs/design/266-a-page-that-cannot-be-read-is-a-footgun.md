# 266: A page that cannot be read is a footgun

## Decision

Two checks in `ui` run in development and are gone from a release build, the way the contrast
warning of design 120 is: each is written as statements that are nothing but an `assert(...)`,
which the transform strips (design 097). Neither reads a value the page would only have later, so both run
in the same tick as the mount and throw where the mount threw, like a missing icon does.

**A `Button` with no accessible name throws when it mounts.** From the component's `mounted`,
which runs once the element and everything inside it are on the page, the component reads the
element back out of the mount (the way `Popup` does, so a hydration reads the server's node) and
asks whether anything names it: text inside it, an `aria-label`, `aria-labelledby` or `title` on
it, or a descendant carrying an `aria-label`, an `alt` or a `title`, which is what a labelled
`Icon` and an `img` are. Nothing does, and the mount throws with the fix: give the button a
`label`, an `aria-label`, or a `label` on the `Icon` inside it. `mounted` rather than the
mounter's return, because a child component runs from the mount's queue and the element holds
nothing when the mounter returns. The button is read as it first mounts; a `label` cell that
starts empty is a nameless button at that moment and is reported as one.

**The public `mount` and `hydrate` throw once per document when the page has no language or
no title.** After the mount, when the target sits in a browser document that is the top of its
window, `documentElement.lang` empty throws with the fix (`lang="en"`, or the page's language,
on `<html>`), then `document.title` empty throws with its fix (a `<title>` in the shell, or a
`Title` on the page). Each fact is read once per document, on the first mount into it, and marked
read before it is answered, so a page of many mounts pays once and a fault is reported once
however many mounts follow. A light document, a server render and a document
inside a frame are not checked: the first two are not a page anyone reads, and a frame's
document is part of the page around it, whose `<title>` and `lang` are the ones a reader gets.

## Why

The build refuses what the source settles (design 265). Two faults it cannot settle are the
ones a page written entirely from `ui` components makes first: an icon-only `Button` whose name
depends on what the `Icon` inside it was given, and a document whose `<html>` and `<title>` are
in a shell the transform never reads. Both are a screen reader's whole way in: a button with no
name is announced as "button", and a page with no title or language is announced as its URL in
whatever voice the reader was last in.

A throw rather than a warning, because both are footguns in the sense `AGENTS.md` uses: a page
that mounts with one is wrong on the first read, and the stack's rule for that is a loud
assert. The throw comes with the fix, lands in the console at error level, and so fails the
drive `AGENTS.md` asks for and lands in the logs battery's record of the visit.

In the same tick as the mount, because everything either check reads is there by then: a
`Button`'s text and its `Icon`'s `aria-label` are on the page when its `mounted` runs, and the
head tags a `Title` declares are attached before `mount` returns. A check that waited for a
later act to bring a title would have to guess how long to wait, and a shell that carries a
`<title>` for the first paint is what a page should have in any case.

## What this costs

One `textContent` read and one walk of its children per `Button` mounted, in development only, and
one read of two document properties on the first mount into each document. A release build has
none of it: the statements are gone, not switched off, and the imports that fed them go with them
(design 097). What a release build keeps of the `Button` check is one uninitialised `let` in the
component's body, which nothing there assigns or reads.

The name check runs wherever `mounted` fires, so a static `render()` of a nameless `Button` throws
in development as well, which is the same fault caught one step earlier.

A page that mounts a `Button` whose `label` cell fills in later throws in development. Give the
button a static `aria-label` for the empty state, which a screen reader wants in any case.

A test page that mounts into a shell with no `lang` or `<title>` throws. The shells in this
repo's own browser suites carry both.

## Evidence

`packages/ui/tests/browser.test.ts`, the page checks, in Chromium: a `Button` with only an
unlabelled `Icon` throws with the fix and one with a `label`, an `aria-label`, text or a
labelled `Icon` does not; a mount into a shell with no `lang` throws once and a page that then
declares one mounts; a shell with a `lang` and no `<title>` throws the title's fix, and a
`Title` on the page is a title; a document is read once; the same source compiled with
`release` has no call to either check. `recipes/accessible-page` mounts both faults as pages.

## What would reverse this

A shape of page that cannot carry a title at first mount and is still a page: then the title
check moves to the settled point of the first act, and the note says how that point is found.
