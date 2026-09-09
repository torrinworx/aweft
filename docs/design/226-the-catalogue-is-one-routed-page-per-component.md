# 226: The catalogue is one routed page per component

Amends design 197: the one long page with a section per component is one page per component,
reached through the stack's own stage and router. What an example file is, and the rule that a
component without one turns the gate red, are unchanged. The `order` field is no longer read.

## Decision

**One act per example, and the component's name is the act, the URL and the id of the page.**
`catalogue.tsx` still reads `examples/` with the bundler's glob and still lists nothing. What it
builds from what it finds is now a `Record<string, Act>`, one entry per file, keyed by the
example's `name`. Every act is the component itself, not `{ load }`: the acts are already in the
bundle, so a loader would buy nothing and there is a separate pass replacing that form.

The page renders `<StageContext router={router} acts={acts} initial={first}>` with the header, the
nav and a `Stage` inside it. `initial` is the first component alphabetically, so a URL that names
no component, and one that names something that is not a component, both show that page.

### The URL is the hash, and the router's base is what makes it one

`catalogue.html#/Button`. The router is made with `base: location.pathname + '#'`, so what the
router reads as its path is the text after the `#` and `push('/Button')` writes
`/catalogue.html#/Button` through `pushState`.

The three candidates were a path, a query and the hash, and only one of them survives a reload.
Measured against `npx vite recipes/ui`, which is what a person runs to click this page, with
`curl -o /dev/null -w '%{http_code}'`:

| asked for | answered |
|---|---|
| `/catalogue.html` | 200 |
| `/catalogue.html/Button` | 404 |
| `/catalogue.html/` | 404 |
| `/catalogue.html?c=Button` | 200 |

A path per component is therefore out: `recipes/ui` is three pages and declares `appType: 'mpa'`
for the reason its own config gives, that a typo should answer 404 rather than 200 with another
page's markup, and an mpa server answers a path only when a file is there. The driver's own static
server over `dist` answers the same way, so nothing about this is the dev server being special.

A query is out for a different reason: the stage matches acts on the path, and `pathOf` cuts the
query and the hash off before matching (`packages/ui/src/route.ts`). So `?c=Button` reaches the
stage as the path `catalogue.html`, which is one act for every component. `stage.query` would
carry the name, but then there is one act and a page that switches its own content, which is not
routing and would not exercise the thing this page is here to exercise.

The hash reaches the stage the same way unless the base takes it, which is what the base does here.
The router's `within()` accepts a URL that starts with `base + '/'`, and `/catalogue.html#/Button`
starts with `/catalogue.html#/`, so the router's URL is `/Button` and the act is `Button`. The
server never sees any of it: a fragment is not sent, so a reload of a copied link asks for
`catalogue.html` and gets it, and the page then opens what the fragment says.

**Every nav link calls `push` itself, and `router.links` is not used.** `links` deliberately leaves
a link into the page showing now that differs only in its hash to the browser, because normally
such a link scrolls to an element and the act does not change. Every link here is one of those, and
the browser handling it would move the address bar and fire no `popstate`, so the stage would never
hear about it. The nav's click handler calls `router.push` and prevents the default, and returns
without doing either when the click carries a modifier, so a middle click or a Ctrl click still
opens the page in a tab of its own.

### The nav

Down the left, as before, and sticky as before, with four changes.

- **Alphabetical**, by the example's `name`. The `order` field that grouped the one long page is
  read by nothing now.
- **The page showing is marked**, with `aria-current="page"` and the `catalogue_link_current`
  entry, both following `stage.current`.
- **It scrolls inside the viewport.** `maxHeight: calc(100vh - $space6 * 2)`, which is the viewport
  less the room the page leaves above and below it, and `overflowY: auto`. Before this the entry
  had neither, so thirty-one names ran off the bottom of the screen with no way to reach them.
- **A search field over the names**, a `TextField` with the standard `search` icon as its
  `leading`. It filters as you type: a name that does not contain what was typed gets `hidden` on
  its row, the count of what is left shows while the field has anything in it, a line says nothing
  matches when nothing does, and Escape empties the field.

**The nav and the search sit beside the `Stage`, not in the stage's template.** A template is
rebuilt on every act change, so a search box written into one empties itself the moment you pick
one of its results. `StageContext`'s own children are mounted once and stay, which is what the
nav needs and what `Stage` is separate from `StageContext` for.

### The page

The component's name as an `<h2>`, then the example under each mode in the two panes design 197
already described, with the same `<name>-pane-<mode>` ids. The article's id is the component's
name, so `#Validate` still names one component's markup. There is no collapse-all and no
expand-all: a page shows one component, so there is nothing to collapse.

The preview page and the systems gallery are untouched.

## Why

The page as design 197 left it had four faults: the left nav could not be scrolled to reach the
components below it, every component was on one page rather than one at a time, the names were in
no order, and there was no way to search them.

Design 197 put every component on one page because twenty drop-downs read better than two pages
split by how the components were built. At thirty-one components that page is a bundle of every
example mounted at once, a nav taller than any screen, and no way to send anybody a link to one
component. One page per component answers all three, and the order and the search are how a person
finds a name in a list that long.

Routing it on the stack's own stage is worth more than a hand-written switch here: this is the
first page in the repo that routes for a reason of its own rather than to demonstrate routing, and
it is the page the gate drives on every run.

## Evidence

`recipes/ui/main.ts`, which drives the built page in Chromium:

- the nav has one link per exported component, and the link is that component's URL; a component
  the package exports with no example file is named in the failure;
- the nav's order equals the exported names sorted, taken from `packages/ui/surface.txt` rather
  than from the page's own order read back to itself;
- the first page is the first component alphabetically, and exactly one link carries
  `aria-current="page"`;
- at a 500px viewport the nav's box is no taller than the viewport, computes `overflow-y: auto`,
  holds more list than box, and scrolling it brings the last name inside its box;
- typing `tex` leaves `TextArea` and `TextField` and says "2 of 31"; typing `zzz` leaves nothing and
  says so; Escape empties the field and brings every name back;
- `catalogue.html#/Select`, reloaded, is answered 200 and shows the `Select` page, which is the
  claim that a copied link works;
- a nav click then the back button lands on the page before it, with the nav's mark following;
- every assertion the one-page catalogue made, each on the page its component is on;
- axe-core over each of the 31 pages with both modes showing, at zero WCAG 2.2 AA violations, and
  twice more with a select and a menu open.

Both of the nav's own checks bite: sorting the examples by name descending fails "the nav is every
component, in alphabetical order", and dropping one example out of the collected list fails "every
exported component has an example file: Badge has none".

The driver reads the catalogue under `reducedMotion: 'reduce'`. A component's colours arrive on a
transition when the page it is on is built (design 217), so a colour read in the frame after a
navigation is a colour on its way somewhere: a `Badge` measured `rgba(0, 0, 0, 0)` at once, then
`rgba(28, 32, 39, 0.46)` 50ms later, then `rgb(28, 32, 39)`. The motion itself is asserted on the
preview page, where nothing navigates.

## What this costs

**A base that ends in `#` is the router being used for something it does not name.** `base` is
documented as a path every URL is under, and this one is a path plus a fragment marker. It works
because `within()` and `href()` treat the base as text, and nothing in the router is told the
difference. A router that knew about hash routing itself would say this plainly instead; until
there is one, this recipe is where the trick lives and this note is where it is written down.

**`router.links` is unusable on this page**, for the reason above. Every link needs its own
handler, which is six lines here and would be a nuisance in an application with links everywhere.
That is an argument for the router growing hash routing, not for this page routing some other way.

**Thirty-one axe runs instead of one.** The catalogue's audit is now per page, which is more
thorough and slower.

**A field per example file that nothing reads.** `order` is still exported by all thirty-one, and
the type still allows it; the next pass through those files takes it out.

**The whole bundle is still one bundle.** Every example is still imported eagerly, so the page
weighs what it weighed. What changed is what is mounted at once, which is one component instead of
thirty-one.

## What would reverse this

The router growing a hash mode of its own, which would replace the base trick with the option and
leave everything else here alone. Or `recipes/ui` becoming one application rather than three
pages, which would let the server answer a path per component and make the URL
`/catalogue/Button`.
