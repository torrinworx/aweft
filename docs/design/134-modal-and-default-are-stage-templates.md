# 134: `Modal` and `Default` are stage templates on the dialog behaviour

## Decision

A template is what a stage wraps an act in. Two ship: one that adds nothing, and one that puts the
act in a modal dialog.

**`Default` adds nothing.** It renders its children and no element at all. It is the function
`stage.tsx` already used as its own fallback template, exported under that name rather than written
a second time, because two functions doing that one job is two functions to keep the same.

**`Modal` renders its children inside a native `<dialog>`.** The element is driven by
`dialogControl` (design 129), the internal dialog behaviour: `showModal`, `inert` on the rest of
the page, the keyboard returned to whatever had it, and Escape through the element's own `cancel`
event. `Modal` opens it when it mounts.

**Every close is the stage's close.** Escape through `cancel`, a mousedown on the backdrop, and the
close button `Modal` renders all end in the stage's `close()`. That is what makes back and the close
button one navigation rather than two ways to be half closed: `close()` on a stage that owns a
history entry calls `router.back()`, and the entry change is what takes the modal down (design 124).
A modal that took itself off the screen and left the history entry behind would leave the person one
back press away from a page that looks unchanged.

**It reads the stage and refuses to work without one.** `StageContext.read(context)` answering null
is an assert, loud in development and stripped in a release build, naming the fix:
`stage.open({ name, template: Modal, history: true })`. Taken quietly, a `Modal` would open a dialog
nothing could close, because every one of its close paths goes through the stage.

**Its own props.** `label` is a heading rendered inside the dialog and named by `aria-labelledby`, so
the dialog has an accessible name. `noEsc` prevents the `cancel` event, so Escape does not close it.
`noClickEsc` ignores a mousedown on the backdrop. `type` is the theme variant, `theme` appends
segments, and `element` hands in a `<dialog>` to decorate, checked by `elementFor` as every control's
is (design 128).

**Naming a template's props is the caller's job.** A stage calls a template as `h(template, {}, act)`,
so there is no way to pass `label` through `open`. An application that wants one writes the template
as a function of its own:

```tsx
stage.open({ name: 'edit', history: true, template: (p) => <Modal label="Edit">{p.children}</Modal> });
```

That is in the README, because it is the first thing a reader tries and gets wrong.

**The popup sink stays outside the dialog.** Nothing here changes where a popup mounts. A dialog that
wants its own popups inside it wraps its children in a `PopupContext` of its own, which is what a
nested `PopupContext` is for and what the README's Popups section already says.

## Why

Routing and the stage are one system, so what wraps an act belongs to the stage rather than to a
component beside it. Design 124 already decided that an open can own a history entry with no URL
segment, and a modal is the case that decision was written for.

A template rather than a component with an `open` cell of its own, because the stage already owns
what is showing, and a second source of truth for "is the modal up" is a source of truth that can
disagree with the address bar.

`Default` exported rather than left internal: a page that names a template for one act and wants the
plain one for another has nothing to write today, and `template={undefined}` reads as a mistake.

## What this costs

**A `Modal` is not part of a page's markup, and does not hydrate.** It is opened by an interaction,
so a server page never has one; a page that names it as a `StageContext` template anyway gets a loud
hydration failure rather than a working page. The reason is the one design 133 already names: this
component builds a `<dialog>` and hands it to `dialogControl`, and a hydration keeps the server's
node and drops the one the component made. Settling it needs two things from `dom`: a mount that
says which node it put in the document, and a way for a component to write an attribute that a
hydration reconciles rather than compares.

A `Modal` is only reachable through a stage. An application that wants a dialog with no routing at
all writes a `<dialog>` and calls nothing here, or declares a stage with one act. The alternative
was a second close path that does not touch history, and design 124 exists to stop exactly that.

## What would reverse this

An application needing a modal that a back press should not close: a confirmation over a
destructive action, say. That is a prop on `Modal` (`history: false` at the `open` call already
does it) rather than a second component, and the assert stays.

## Evidence

`packages/ui/tests/composites.test.ts` opens a `Modal` through a stage in the light tree and asserts
the dialog is open, that a `cancel` event closes it through the stage, that `noEsc` keeps it, and
that a `Modal` with no stage above it asserts with the fix in the message.
`packages/ui/tests/browser.test.ts` opens one through `stage.open({ history: true })` on a routed
page in Chromium, presses a real Escape, and asserts the URL did not move and that the close button
and `history.back()` land on the same page.
