# 197: a catalogue example is a module, and every component has one

Amended: three more `order` ranges, for the display pieces, the grouping pieces and the navigation
pieces. Amended by design 226: each example is a routed page of its own rather than a section of
one long page, the nav is alphabetical and searchable, and `order` is read by nothing. What an
example file is, and the rule that a component without one turns the gate red, still hold; the
paragraphs about the one page, its drop-downs and the two buttons over them are superseded.

## Decision

**One page shows every component, and one file per component feeds it.** `recipes/ui/catalogue.html`
replaces the two pages that came before it, `controls.html` and `composites.html`, and their
sections of `recipes/ui/main.ts` move onto it unchanged apart from the URL.

### What an example file is

`recipes/ui/examples/<file>.example.tsx`, exporting three names:

```tsx
export const name = 'Button';
export const order = 10;
export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	return <Button label="Save changes" id={at('button')} />;
};
```

- `name` is the component's export name from `@aweftjs/ui`, and it is the `id` of the section the
  page renders for it, so `#Button` is the link target and `#Button-pane-light` is its light pane.
- `order` groups the list: controls from 10, fields from 30, composites from 40, text from 50, the
  display pieces from 60, the grouping pieces from 70 and the navigation pieces from 80 (amended,
  designs 199, 200 and 201). The page sorts by `order`, then by `name`, so two files
  with the same number still land in a fixed place, which is what `Toggle` and `ToggleGroup` do at
  15.
- `Example` takes `{ mode }`, `light` or `dark`, and renders every state, `type` and `size` of that
  one component. It is mounted twice per section, once under each mode's theme.

`recipes/ui/example.ts` holds the two types and `ids(mode)`, which is the id convention in one
place: `ids('light')('button-quiet')` is `button-quiet-light`. Every id on the page is
`<part>-<mode>`, so an assertion names a part and a mode and nothing else.

An example is written the way an application writes the component: the component, a cell, and
entries the library ships. No example defines a colour, and no example defines a theme entry. The
page's own layout entries are all named `catalogue*` and are defined in `catalogue.tsx`.

Every example imports `h` from `@aweftjs/ui`, whether or not it calls it. That import is what its
JSX compiles to, and a file that binds no `h` of its own gets `dom`'s (design 147), which knows
nothing about themes: an earlier shape of these files left it out and the whole page rendered
unthemed, with a stylesheet of zero bytes and controls in the host's own colours.

### How the page collects them

`catalogue.tsx` reads the directory at build time:

```ts
const found = import.meta.glob('./examples/*.example.tsx', { eager: true });
```

The bundler resolves that to one static import per file, so adding a file is the whole act of
adding a component to the catalogue; nothing lists them. Measured on a two-line probe
under `recipes/ui`: the glob is gone from the built bundle and the matched module is in it, so the
plugin at `enforce: 'pre'` and the glob transform after it agree.

Each section is a `DropDown` of `type="quiet"`, open by default, with `id="panel-<name>"`, holding
two panes side by side under the `light` and `dark` providers. Quiet because a summary wears the
`button` entry, and the default one is a filled control: twenty of them down a page is twenty black
bars where the reader wanted twenty headings. One button collapses every section and one expands
every section, over the `open` cells the page collected. A list of anchors down the left, one per
example, is sticky.

### A component with no example fails the gate

`recipes/ui/main.ts` reads the exported component names out of `packages/ui/surface.txt`, which the
gate already regenerates from the package's exports, and asserts that the page has a section for
each one. The exceptions are named in the driver with the reason each is not a thing to look at:
the head tags (`Head`, `Link`, `Meta`, `Script`, `Style`, `Title`), the providers (`Theme`,
`ThemeContext`, `Icons`, `InputContext`, `LoaderContext`, `PopupContext`, `StageContext`,
`TextModifiers`, `ValidateContext`), control flow (`Shown`, `Switch`), the stage's own parts
(`Stage`, `Default`), `Detached`, and `FieldGroup` and `FieldSet`. The last four are shown inside
the `Modal`, `Popup` and `Field` examples rather than in one of their own.

A `Modal` of `type="sheet"` is shown in the `Modal` example for the same reason: there is no
`Sheet` export to name a section after, so a section called one would be a section naming a
component the package does not export, which the check above refuses (design 202).

So a component added to `packages/ui/src/index.ts` with no example file turns the gate red on the
next run, which is the only way a catalogue stays complete.

## Why

The two pages it replaces split the components by how they were built, which is the library's
business and not the reader's: a person looking for `Select` had to know it was a control and not
a composite. One page with one section per component answers "what does this look like" in one
place, and the drop-downs keep it readable at twenty sections.

Collecting the files rather than listing them is what makes the gate check meaningful. A list in
the page is a second place to forget a component, and the check would then be checking the list.

## What this costs

Twenty files instead of two, and a file per component from here on. A section that is closed hides
its example, so the driver reads with everything expanded, and a person who collapsed everything
sees nothing until they expand again.

The page is one bundle, so every example is in it. That is the point of the page and it is not a
size anybody ships.

## What would reverse this

A component whose example needs a page to itself, because it takes over the whole viewport or
because two of it on one page interfere. That is a section that links out rather than a change to
the contract.

## Evidence

`recipes/ui/main.ts` drives the page: the export-list check above, the nav's link count and a real
click on one scrolling its section into view, the collapse button closing every section and the
expand button opening every one, every assertion the two deleted pages made, and axe-core over the
whole page with both modes visible, at zero WCAG 2.2 AA violations.
