# recipes/ui

A gallery page: every system `@aweftjs/ui` ships, in each of its states, on one page.

## See it

```
npx vite recipes/ui
```

Open what it prints. The page is the same file the gate builds, so what you click is what CI
drives.

## What the gate does with it

```
node recipes/ui/main.ts
```

Builds the page with vite through `aweft()`, serves it, opens it in Chromium, drives it, and
exits nonzero when an assertion fails. It asserts the things only a real browser can answer:
that the theme's CSS is in the head and applied, that a real click and a real key reach the
handlers, that focus moves, that a popup is measured and placed against its anchor, and that
the popup asks for the top layer with the `popover` attribute rather than a z-index.

## What it does not do for you

It does not decide what an application looks like. Every theme entry on the page is written in
`page.tsx`, and `ui` ships a default theme only so a bare `theme="button"` renders as something.
