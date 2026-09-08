# recipes/ui

Four pages.

- **The gallery** (`index.html`): every system `@aweftjs/ui` ships, in each of its states.
- **The preview** (`preview.html`): the look itself, light and dark side by side. Button, input,
  select, card, popup and text, written the way an application writes them, out of the roles and
  nothing else, with the whole `Typography` family in its own section. This is the page you read to
  judge the look as a whole.
- **The controls** (`controls.html`): every control in every state, in both modes.
- **The composites** (`composites.html`): the modal, the tip, the disclosure, the drop zone, the
  checked form and the colour picker, in both modes.

## See them

```
npx vite recipes/ui
```

Open what it prints, and `/preview.html`, `/controls.html` and `/composites.html` beside it. They
are the same files the gate builds, so what you click is what the gate drives.

## What the gate does with it

```
node recipes/ui/main.ts
```

Builds the four pages with vite through `aweft()`, serves them, opens them in Chromium, drives them,
and exits nonzero when an assertion fails. It asserts the things only a real browser can answer.

On the gallery: that the theme's CSS is in the head and applied, that a real click and a real key
reach the handlers, that focus moves, that a popup is measured and placed against its anchor, that
the popup asks for the top layer with the `popover` attribute rather than a z-index, and that
typing into the note field re-renders the badges its `TextModifiers` make of it.

On the preview: that a button computes the `$accent` of the mode its pane is in and that the two
modes differ, that `$target` is 24px and body type is one rem with its line height, that the type
section's `h1` specimen is 36px and its `h2_bold` computes weight 600, that a real
hover lays the state tint on and leaves the role underneath it, that a real Tab draws a 2px ring
in `$ring`, that reduced motion takes the transition to zero, and that axe-core finds no WCAG 2.2
AA violation.

On the composites: that a modal opened through the stage is a real `<dialog>` showing as a modal
with a name, and that its close button takes it down; that a real hover shows a tip that asked for
the top layer as a hint; that Space on a disclosure opens it in the page's flow; that a real file on
the hidden input lands in the list; that nothing is checked before the submit signal and everything
after it, with a formatting validator writing the value back; that the picker's sliders are real
range inputs and End on the hue writes the cell; and that axe-core finds no WCAG 2.2 AA violation.

## What it does not do for you

It does not decide what an application looks like. The gallery writes every one of its own theme
entries in `page.tsx`; the preview, the controls page and the composites page use the library's
default theme, which is what they are there to show. Any of it is replaced by an application's own.
