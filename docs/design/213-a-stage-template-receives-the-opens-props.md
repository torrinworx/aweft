# 213: A stage template receives the props `open` was given

Amended: `Modal` reads its own named props and forwards nothing else, and the stage strips four
fields rather than three. Amends design 124, which defined what `open` carries, and design 125,
which defined what a stage builds.

## Decision

**A stage calls its template as `h(template, props, act)`**, where `props` is what the `open` call
carried minus the four fields the stage reads for itself: `name`, `template`, `history` and
`children`. So a modal is named at the call:

```tsx
stage.open({ name: 'signout', template: Modal, label: 'Sign out?' });
```

**The act still receives what it received.** `{ ...props, stage }` goes to the act exactly as
design 125 has it, with `stage` written last because the stage an act is in is not something an
open gets to name. The template and the act are handed the same props; the template takes the ones
it declares and passes the rest nowhere, which is what a component does with props it does not
name.

**An act reached from the URL calls its template with `{}`**, as it was. There was no `open`, so
nothing was carried. The rule is one line and does not ask which template this is: the template and
the act get the open's props when there is an open for this act, and nothing when there is not.

## Why

A confirmation dialog is the ordinary thing a stage opens, and it used to be paid for the same way
every time: `h(template, {}, act)` meant there was no way to give the `Modal` its `label`, so
every call built a closure to name one.

```tsx
stage.open({ name: 'confirm', template: (p) => <Modal label={question}>{p.children}</Modal> });
```

That closure is a component built per call, so the stage rebuilds the subtree on every open, and
the question has to be hoisted into a cell the closure can read, and reaching the stage from a
table cell means capturing it into a module-level cell. The whole shape came from one missing
argument.

`open` already carries props: design 124 says everything past the named fields is props for
the act, and the stage already spreads them there. Handing the same object to the template is the
smaller rule, not a bigger one: the props an open carries go to the two components the open builds,
rather than to one of them.

**Why not a fourth named field, `templateProps`.** Two prop bags on one call is a caller having to
decide which half each value belongs in, and for the case that motivated this, `label`, the answer
is both: the dialog's accessible name and the question the act asks are the same string.

The cost of one bag is a name collision: a prop the act wants and the template also declares is
read by both. That is the ordinary behaviour of a prop passed to two components, it is visible in
the call, and the act is the one that also gets `stage`, so nothing the template does can take a
prop away from it.

### A template of this package reads its own props and forwards nothing else

**`Modal` reads `label`, `noEsc`, `noClickEsc`, `type`, `side`, `element`, `theme` and `class`, and
passes nothing else to the `<dialog>`.** It used to spread everything it did not name onto the
element, which was right while a template was called with `{}` and is wrong now that the props are
the act's as well: `stage.open({ name, template: Modal, label: 'Sign out?', session: row })` wrote
`session="[object Object]"` on the dialog. An act prop spelled like one of the eight is still read by
`Modal`, which is the collision the section above accepts and is visible in the call.

A page that wants an attribute of its own on the dialog writes a template of its own around
`Modal`, which is the shape this note made unnecessary for `label` and did not take away.

## Evidence

`packages/ui/tests/stage.test.ts`: a template that records its props is opened with `label` and a
value of its own, and sees both and neither `name`, `template` nor `history`; the act mounted
inside it sees the same props plus `stage`; an act reached with no `open` calls the stage's own
template with no props; and a second `open` replaces the props rather than accumulating them, which
design 124 already promised for the act.

`recipes/ui/main.ts`: the catalogue's modal example opens with a `label` through `open` and the
dialog's accessible name is that label. The driver finds the dialog by its element, because the
example no longer carries an `id` through `open`: that id reached the act and never the element.

`packages/ui/tests/composites.test.ts`, "a modal reads the props it names and writes none of the
act's own on the dialog": an open carrying a row and a string of the act's own leaves neither on the
`<dialog>` and hands both to the act. Before this amendment `session` and `extra` were written on
it as attributes.

The suite pins both halves of the rule: the template is not called with `{}`, and it is not handed
the whole `OpenOptions` including `name` and `template`.

## What this costs

A template that declares a prop an act also wants now sees it. The cost is a template of an
application's own that spreads its props onto an element and now spreads one more, which is why
`Modal` stopped doing that.

An `open` can no longer put an attribute on the `<dialog>` in passing. Anything the element needs
goes through one of the eight props `Modal` names, or through a template of the page's own.

## What would reverse this

A template that has to be given something the act must not see. Then the fourth field this note
turned down comes back, and it comes back beside this rule rather than instead of it.
