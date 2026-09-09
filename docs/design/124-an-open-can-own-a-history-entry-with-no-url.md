# 124: An open can own a history entry with no URL segment

Amended by design 213: the props an open carries past `name`, `template` and `history` go to the
template as well as to the act.

## Decision

`open({ name, template, history, ...props })` shows an act now, whatever the URL says.

- `name` is the act to show. It is looked up in the same `acts` object; there is no second place
  to declare one.
- `template` wraps it, for this open only. Left off, the stage's own `template` is used.
- Everything else is props, handed to the act. **They do not accumulate.** Each `open` replaces
  what the one before it held, so a modal opened a second time with fewer props does not still
  carry the first one's.
- `close()` puts the stage back on what the URL decides.

`open({ history: true })` additionally pushes a history entry **at the URL the page is already
on**. No path segment, no query, no hash: `push` is given the current URL, so the address bar does
not move and a copied link is the link to the page rather than to the page with a modal on it. The
open is remembered against the key of the entry that push created.

Back therefore dismisses it. The router reports the entry change, the stage sees that the key it
remembered is no longer the current one, and the open is dropped. Forward brings it back, because
the key comes back. A navigation to another URL drops the open too, history entry or not.

**One entry per stage.** A second `history: true` open, while one is already showing on the stage's
own entry, does not push a second entry. It calls `replace` at the same URL and keeps the entry it
already owns, so the stage owns exactly one entry at a time: one back closes whatever is open and
lands on the page under it. A stage holds one open, not a stack of them, so a second entry would be
an entry with nothing behind it, and back would spend a press on nothing before reaching the page.

The open is held in memory against the key, not written into the history state. History state has
to survive a structured clone and props do not: a component, a callback and a class instance are
all ordinary things to hand a modal. So a reload loses the open and lands on the page under it,
which is the same thing a reload does to any state the application did not persist.

`open({ history: true })` on a stage with no router opens without a history entry, because there is
no history to own. It is not an error: the same page runs routed and unrouted, and refusing here
would mean a component could not be written once.

## Why

A modal that the back button dismisses is what a phone user expects and what nothing on the web
gives them by default. The two ways to build it are a URL segment for the modal, which puts the
modal in every shared link, and a history entry with no URL, which does not. This stack takes the
second.

Keying on the entry rather than counting `back()` calls, because the user can also press forward,
open a new tab, or press back twice. A key comparison answers all of those with one rule.

## What this costs

`close()` on an open that owns an entry calls `router.back()`, so closing a modal with its own
button and closing it with the back button are the same navigation. That is the intent, and it
means `close()` is asynchronous in a browser: the entry change arrives with `popstate`, not on the
line after the call.

Two opens with history entries do not stack. The second replaces the first and one back clears
both, because the stage shows one act. An application that wants a stack of dismissable layers
builds it out of nested stages, one open each.

## What would reverse this

A URL segment for modals, which would make them linkable and is a different product decision
rather than a different implementation.
