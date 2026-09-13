# Building with aweft

The rules an application holds, and the loop for a page. Read `start` first; this is what comes
after the scaffold.

## Read in this order, and no further

The root README, then `recipes/README.md` for whole programs by the task you have, then the
README of each package you touch, which says what it does and what it will not do for you. Do
not read a package's source to learn its rules. If a README did not tell you, that is a defect
in the README, and saying so is worth more than the workaround.

## Five rules an application trips on

1. **Theme segments are a list, not an underscore string.** `theme={['button', 'quiet']}`
   reaches `button` and `button_quiet`; `theme="button_quiet"` is one token naming the variant
   alone, so the element gets the variant's colours and none of `button`'s box.
   `packages/ui/README.md`, The theme.
2. **`each` builds one shape per list.** A row component renders the same tags in the same
   order on every row. A button on some rows and nothing on others is wrong silently; vary a
   value, not the shape. `packages/dom/README.md`; `recipes/todo-list/`.
3. **The root entry paints nothing.** Your page entry sets `background`, `color` and a
   `minHeight` of the viewport, and the page's HTML carries `<style>body { margin: 0 }</style>`,
   because a theme entry cannot reach `body`. `packages/ui/README.md`, The look.
4. **The Node loader resolves from the working directory and reads `AWEFT_DEFAULT_H`.** Run
   `node --import @aweftjs/build/loader main.ts` from the application root. A `.tsx` file that
   imports no `h` of its own is given `dom`'s unless `AWEFT_DEFAULT_H=@aweftjs/ui` is set, and
   that value has to be the `defaultH` the vite config passes, or a page rendered on the server
   and bundled for the browser will not hydrate. The same holds for `AWEFT_TEXT=1` and the
   config's `text: true`. `packages/build/README.md`; `recipes/ssg/`.
5. **A page reaches a backend in development through a same-origin proxy.** The cookie belongs
   to the page's origin, so the dev server proxies the auth routes and a socket path of its own
   (`/ws`, with `ws: true`) to the backend, and the page names that path in
   `createClient({ url })`. A proxy entry for `/` takes the dev server's own socket with it.
   `recipes/full-stack/`.

## The loop for a page

1. Scaffold from `recipes/full-stack/`.
2. Write the server's modules and the page. Public exports only: a deep import into a package
   fails at import time by design, and needing one is a finding to report, not a thing to work
   around.
3. Before saying it is done, drive the page in a real browser: every state reachable by
   keyboard, both modes, no page error and nothing written to the console at error level, and
   `audit` and `walk` from `@aweftjs/testing/browser` over the page with nothing to report.
   `recipes/full-stack/` shows the two listeners and both checks, and `recipes/accessible-page/`
   a page that passes them and three that do not. The build refuses an element no one can read
   and the mount throws on a nameless `Button` and a page with no `lang` or title; what those
   and the audit cannot read stays yours: meaning carried by colour alone, the reading order,
   headings that describe their section, time limits, consistent navigation, an error message
   that says what to do. Tests for an application are `node --test` files run under the loader.
4. A stack bug found while building gets its test in the stack's package and the fix goes
   upstream; the application never carries a patched copy.

## The application's own files

An application that only uses the stack installs the packages it imports from npm. One that
also changes the stack carries the repository as a git submodule and resolves each `@aweftjs/*`
name through a `file:` dependency on the package's directory, asking for the source by name with
`node-options=--conditions=aweft-source` in its `.npmrc` and `aweft-source` in its `tsconfig`'s
`customConditions`. `recipes/full-stack/README.md` shows the manifest, the two configs and the
two skills under `.claude/skills/` an application links.

## What the stack does not decide

What a page looks like past the default theme: an application's theme is a partial theme merged
over it. Which language a visitor gets. Which host serves the files. Whether a missing
translation, an unenumerated URL or a health check's failure stops a build: each is in a report,
and the application decides. Every package page on this site ends with what that package never
decides, and that list is the one to read twice.
