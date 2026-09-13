# 267: `audit` and `walk` read the page a test drives

## Decision

`@aweftjs/testing/browser` is a subpath with two functions, each taking the page object a browser
driver already handed the test.

**`audit(page, options?)`** puts axe-core into the page and runs it over the document, or over
`options.root`, with the WCAG 2.x A and AA tags (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
`wcag22aa`; `options.tags` replaces the list). It answers `{ violations, passes }`, and a
violation is `{ rule, impact, wcag, help, helpUrl, nodes }` with axe's rule id, its `wcag*` tags
as axe wrote them, its help sentence and link, and the nodes it found as a selector and the
markup. The function returns; it never throws on a violation, so the test says what a violation
means for it.

**`walk(page, options?)`** presses Tab until the focus comes back to the page body or
`options.limit` (300) presses have gone by, and answers `{ stops, problems }`. A stop is what the
focus landed on: tag, id, role, accessible name as the page gives it, and whether the element
draws a ring (`outline` or `box-shadow` while it matches `:focus-visible`). A problem carries a
reason, a fix and the element it is about: `focus-not-visible` for a stop with no ring,
`focus-stuck` when a press left the focus where it was, `focus-loops` when a press sent the focus
back to an element the walk had visited without passing the body (the page itself sends it round,
so Tab never leaves it), `unreachable` for an element the page made focusable (`a[href]`,
`button`, `input`, `select`, `textarea`, `summary`, `[tabindex]` not `-1`; not disabled, `hidden`
or inert) that the walk never landed on, and `never-cycles` when the limit ran out before the
body came round. The walk starts from the top: whatever the page had focused loses it first.

**The page is structural.** `PageLike` is `evaluate(source)`, `addScriptTag({ content })` and
`keyboard.press(key)`, which Playwright's `Page` satisfies and the suite proves by passing one,
and the code that runs in the page is written as source text, so nothing is serialised across
the boundary but strings. The package imports no browser driver.

**What a stop is.** A radio group is one stop, because Tab lands on the ticked radio or the first
and the arrows do the rest. An element with no box (inside a closed `details`, a closed dialog, a
hidden parent) is not expected. A frame, a shadow host and a media element with its own controls
are one stop each: the focus moves inside them where the document cannot say, so a press that
leaves the active element where it was is not a trap there. A ring is the element's own
`outline` or `box-shadow`, or one an ancestor draws for it through a rule about focus that
matches the ancestor now; the rules are read rather than the element blurred and refocused,
because a blur runs the page's own handlers.

**axe-core is an optional peer**, resolved when `audit` is called and refused as
`axe-not-installed` when it is not there, in the shape of design 140. `options.locate` says where
the script is for a project that keeps it elsewhere, and is how the refusal is reached in a test
without uninstalling anything. It answers a path where `throwaway`'s `load` answers a module,
because axe is a file put into a page and never imported here.

## Why

The build refuses what the source settles (design 265) and the mount throws on two page facts
(design 266). Everything else WCAG asks that a machine can check needs the rendered page:
contrast as painted, a name that arrives through a relationship, a role that contradicts the
element, a landmark missing, a heading order, a duplicate id. axe-core is that check, kept by
people who do nothing else, and writing a second one would be the mistake the governing rule in
`AGENTS.md` names. What axe cannot do is press a key: whether every control is reachable, whether
the focus is visible where it lands, whether it can leave, are criteria of the keyboard, and the
walk is that check.

Both existed as inline copies, once in the `ui` recipe and once in the `ui` suite, each with its
own tag list and its own idea of a result. A third copy in the scaffold would have made the
application's drive the fourth. The harness is where the stack keeps the check that every page
runs (design 254), and deleting the copies is the proof the shape was right.

A structural page rather than Playwright's type, because the harness would otherwise depend on
a browser driver to name a type, and the check is the same whichever driver opened the page.

## What this costs

`audit` adds about 550 KB of script to the page it runs in, once per call, and axe takes a few
hundred milliseconds over a page of ordinary size. A drive that audits both colour schemes pays
twice. `walk` is one round trip per focusable element.

The ring check reads `outline` and `box-shadow` and nothing else, so a page that shows focus by
changing a border colour is reported as ringless. The `ui` theme draws one ring (design 118),
and an application drawing its own is told what the walk reads. A walk with a modal dialog open
reports the inert page behind it as unreachable; the walk is for a page with nothing open.

A stop is identified by the element the walk saw, held inside the page for the walk's duration
under one property on `globalThis`, which a page that enumerates its globals can see.

## Evidence

`packages/testing/tests/browser.test.ts` in Chromium: `audit` reports a planted violation with
its rule and node and nothing on a clean page; `axe-not-installed` when the resolver finds
nothing; `walk` reports a stop without a ring, a press that moved nothing, a press that sent the
focus back round, a focusable element the walk never reached, nothing on a clean page, and starts
from the top whatever the page had focused. `recipes/ui/main.ts` and
`packages/ui/tests/browser.test.ts` run `audit` and hold no axe code of their own.
`recipes/full-stack/main.ts` runs both and fails on either.

## What would reverse this

A driver whose page cannot evaluate source text or add a script by content. Then `PageLike`
grows a second shape and the note says which drivers each is for.
