# 127: Head identity, order, and adoption

## Decision

`Head`, `Title`, `Meta`, `Link`, `Script` and `Style` are components and only components. There is
no object form and no imperative call: one way per job. Each renders nothing where it is written
and puts a tag in the render's head list instead, taking it out again when it unmounts.

**Overriding.** `Head` opens a deeper scope: the depth inside one is the depth outside plus one.
Within a group, exactly one tag wins, deepest first and then latest. A layout writes the default
title outside any `Head` and a page overrides it from inside one, and two pages that both override
it are decided by which mounted last.

**The group.** It is the `key` prop when the tag has one, and otherwise the tag's own identity:

| tag | its identity |
|---|---|
| `title` | `title`. There is one |
| `meta` | its `charset`, or its `http-equiv`, or its `name`, or its `property`, whichever it has, in that order |
| `link` | `canonical` is a singleton whatever its href; otherwise `rel` and `href` together |
| `script` | its `src` and `type`, or, with no `src`, that it is inline and its `type` |
| `style` | its `media`, or `all` with none |
| anything with none of those | nothing. It is additive: every one of them is emitted |

**The order.** Tags are emitted by kind, in one fixed order, and by the sequence they were added
inside each kind: charset, viewport, other meta, base, title, links that preload or preconnect
(`preconnect`, `dns-prefetch`, `preload`, `modulepreload`), styles, other links, scripts, then
anything else. Nothing emits a `base` yet; the row is in the table so that the order does not have
to be renumbered when something does.

**Static output.** `use(context).head.markup()` is the tags as an HTML string in that order. Each
one carries `data-aweft-head`, its group, so a client can find it again. An additive tag is
stamped `#n` by its position among the additive tags, which is the same on the server and the
client because both walk the same page.

**In a page.** `mount` writes the list into `document.head`, as one run at the front of it, and
keeps it there: a cell in a text prop or an attribute updates the tag in place, an act change
rewrites the tags it owns, and unmounting takes the render's tags out. `hydrate` adopts instead: a stamped tag whose group matches
one the client built is kept, its attributes and text brought up to date in place, never removed
and put back. A tag with no match is created. Ownership is per render, so two renders in one page
neither adopt nor remove each other's tags.

**At the front, not the end.** `document.title` is the first `title` element in the head, so a
title appended after the one a page shell wrote does nothing at all, and does it silently. The
whole run goes in front instead. A hydration moves nothing: the adopted tags are already where the
server put them. A shell's own `<title>` stays in the markup behind the page's, which the recipe's
README says out loud.

**One tag goes in front of the run: a `<meta charset>` the shell wrote as the head's first child.**
A charset has to be read in the document's first bytes to be read at all, so pushing a shell's
charset behind a title is the one case where the front is the wrong place. Nothing else is moved
over, and a charset the shell did not write first is not treated as one.

**`Registry` was not enough.** `head` on the render object is still called `head` and is still a
registry of tags, and it now also answers `markup()` and `title()`. The field's type changed and
its name did not, so no caller changed. `title()` is there because `Stage` announces the new title
on an act change (design 125) and reading it off the resolved list is the only place it is right.

## Why

Depth then sequence is the rule a layout needs: a page is mounted inside a layout and has to beat
it without knowing it is there. Sequence alone gets that wrong the moment a layout re-renders.

Identity groups rather than a required key, because a title, a description and a canonical link
are singular in the format itself, and making an author name them again is a chance to name two of
them the same. `key` stays for the cases the format does not decide, and for splitting two tags
the table would group.

Adoption rather than replacement, because a crawler is not the only reader of these tags: a
stylesheet the server sent and the client removes and re-adds is a flash of unstyled page, and a
preload the client re-adds is a second fetch. The stamp is what makes adoption possible at all;
without it a client has no way to tell its own server's title from one an extension put there.

`markup()` on the render rather than a function taking a list, because the list is per render and
handing it out separately is how a static build renders two pages and serializes one of them
twice.

## What this costs

Two inline `<script>` tags of the same type are one group, so the second one wins and the first is
not emitted. That follows from the identity table and it is a real surprise; the fix is a `key` on
each, and the block comment says so.

Inline text that contains `</script` or `</style` is refused with an assert rather than escaped,
because there is no escape that is right in both CSS and JavaScript.

A `<link rel="stylesheet">` a page declares now comes before one the shell wrote, so the shell's
wins the cascade rather than the page's. That is the price of putting the run at the front, and it
is the right way round: the shell is the outer document. The same goes for a `charset` the render
declares when the shell already wrote one first: the shell's is the one the browser reads.

Two renders mounted into one document each write their own run at the front, so the run mounted
last is in front of the one before it and `document.title` is the last render's title. Ownership
is per render and neither run is wrong; a page that wants one title uses one render, which is what
the default shared render already gives it.

A static render holds its head list. `render` mounts the page, serializes it and unmounts it, so
every head component has been removed by the time the caller reads `markup()`; the list is held
for the length of the call and keeps what the page declared. A render object is therefore for one
page, which design 109 already said.

## What would reverse this

The rule "deepest wins" turning out to be wrong for an application that renders a page inside a
preview of itself, where the inner page is deeper and should not win. That would be an explicit
scope root rather than a change to the comparison.
