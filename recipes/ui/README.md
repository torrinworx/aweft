# recipes/ui

Three pages.

- **The gallery** (`index.html`): every system `@aweftjs/ui` ships, in each of its states. Themes,
  contexts, control flow, a popup, a suspend and the text modifiers, on a theme of the page's own.
- **The preview** (`preview.html`): the look itself, light and dark side by side. Button, input,
  select, card, popup and text, written the way an application writes them, out of the roles and
  nothing else, with the whole `Typography` family in its own section. This is the page you read to
  judge the look as a whole.
- **The catalogue** (`catalogue.html`): every component the package exports, in every state, type
  and size, in both modes, one routed page per component. This is the page you read to find out what
  a component looks like.

## See them

```
npx vite recipes/ui
```

Open what it prints, and `/preview.html` and `/catalogue.html` beside it. They are the same files
the gate builds, so what you click is what the gate drives. The config says `appType: 'mpa'`,
because these are three pages and not one application: a path that is not one of them answers 404,
where a single-page server would answer 200 with the gallery's markup and leave a typo looking like
a page whose every assertion fails.

The catalogue names each component in the URL's hash, `/catalogue.html#/Button`, which is a link you
can copy and reload. That is why it is the hash and not a path: a path per component is a path this
server has no file for, and it answers 404 (design 226).

## What the gate does with it

```
node recipes/ui/main.ts
```

Builds the three pages with vite through `aweft()`, serves them, opens them in Chromium, drives
them, and exits nonzero when an assertion fails. It asserts the things only a real browser can
answer.

On the gallery: that the theme's CSS is in the head and applied, that a real click and a real key
reach the handlers, that focus moves, that a popup is measured and placed against its anchor, that
the popup asks for the top layer with the `popover` attribute rather than a z-index, and that
typing into the note field re-renders the badges its `TextModifiers` make of it.

On the preview: that a button computes the `$accent` of the mode its pane is in and that the two
modes differ, that a control is `$control` tall and body type is one rem with its line height,
that the type section's `h1` specimen is 36px and its `h2_bold` computes weight 600, that a real
hover lays the state tint on and leaves the role underneath it, that a real Tab draws the halo of
`$ring` and takes the border with it, that reduced motion takes the transition to zero, and that
axe-core finds no WCAG 2.2 AA violation.

On the catalogue: that every component the package exports has a page, that the nav lists them
alphabetically with the one showing marked, that its box is no taller than the viewport and scrolls
inside it, that typing in the search narrows the list to the names that match and Escape brings them
back, that a copied URL reloads onto the page it names and the back button returns to the page
before it. Then, on each component's own page: that every control is the native
element and nothing on the page is drawn out of `div`s; that a button is 32, 36 and 40 pixels tall
at `sm`, nothing and `lg`, that an icon button is a square at each of the three, and that a select
carrying its own arrow is still 36 pixels tall with the arrow an 8 pixel box 12 pixels in from its
right edge, drawn by the theme rather than asked of an icon pack; that a modal opened through the
stage is a real `<dialog>` showing as a modal with a name, and that its close button takes it down;
that a real hover shows a tip that asked for the top layer as a hint; that Space on a disclosure
opens it in the page's flow; that a real file on the hidden input lands in the list; that nothing
is checked before the submit signal and everything after it, with a formatting validator writing
the value back; that the picker's sliders are real range inputs and End on the hue writes the cell;
that a form laid out with the `field_group`, `field_set` and `field` entries puts its responsive
field in a row at the pane's width, with the group declaring the container that measurement is taken
against; and that axe-core finds no WCAG 2.2 AA violation on any page with both modes showing.

The catalogue is read with motion turned off. A component's colours arrive on a transition when the
page it is on is built, so a colour read in the frame after a navigation is a colour on its way
somewhere; the motion itself is asserted on the preview page, where nothing navigates.

## Writing an example (designs 197 and 226)

A file under `examples/` exports `name`, the component's export name from `@aweftjs/ui` (or, for the
one page that shows theme entries rather than a component, a name `main.ts` lists as needing no
export); and `Example`, a component taking `{ mode }` that renders every state, type and size of
that one component. Every id on the page is `<part>-<mode>`, made with `ids(props.mode)` from
`example.ts`, so `at('button-quiet')` is `button-quiet-light` in the left pane and
`button-quiet-dark` in the right. The page finds the file itself, with the bundler's glob, and makes
one act of it: `name` is the act, its URL after `#/`, and the id of the article the page renders.
The nav lists the names in alphabetical order. A component the package exports with no example file
turns the gate red, unless the driver names it as one of the contexts, systems or head tags there is
nothing to look at.

Every example imports `h` from `@aweftjs/ui`, whether or not it calls it. That import is what its
JSX compiles to, and a file that binds no `h` of its own gets `dom`'s, which knows nothing about
themes.

## What it does not do for you

It does not decide what an application looks like. The gallery writes every one of its own theme
entries in `page.tsx`; the preview and the catalogue use the library's default theme, which is what
they are there to show, and the catalogue adds nothing but layout entries named `catalogue*`. Any
of it is replaced by an application's own.
