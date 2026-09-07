# recipes/ui

Two pages.

- **The gallery** (`index.html`): every system `@aweftjs/ui` ships, in each of its states.
- **The preview** (`preview.html`): the look itself, light and dark side by side. Button, input,
  select, card, popup and text, written the way an application writes them, out of the roles and
  nothing else. This is the page the look is judged from.

## See them

```
npx vite recipes/ui
```

Open what it prints, and `/preview.html` beside it. They are the same files the gate builds, so
what you click is what CI drives.

## What the gate does with it

```
node recipes/ui/main.ts
```

Builds both pages with vite through `aweft()`, serves them, opens them in Chromium, drives them,
and exits nonzero when an assertion fails. It asserts the things only a real browser can answer.

On the gallery: that the theme's CSS is in the head and applied, that a real click and a real key
reach the handlers, that focus moves, that a popup is measured and placed against its anchor, and
that the popup asks for the top layer with the `popover` attribute rather than a z-index.

On the preview: that a button computes the `$accent` of the mode its pane is in and that the two
modes differ, that `$target` is 24px and body type is one rem with its line height, that a real
hover lays the state tint on and leaves the role underneath it, that a real Tab draws a 2px ring
in `$ring`, that reduced motion takes the transition to zero, and that axe-core finds no WCAG 2.2
AA violation.

## What it does not do for you

It does not decide what an application looks like. The gallery writes every one of its own theme
entries in `page.tsx`; the preview uses the library's default theme, which is what it is there to
show. Either is replaced by an application's own.
