# 307: A mistake that fails quietly says what to do

## Decision

Five mistakes that produced no error now produce one, each in the form that cannot stop code that
runs today. One stays as it is, for the reason under its heading.

| Mistake | What happens now | Form |
|---|---|---|
| A `$var` in an inline object `style` on an element with no `theme` prop | `ui` writes a warning naming the variable and `theme=""`, once per name. On an `svg` element, which takes no theme, it says to write the value | development warning |
| An `<svg>` made by `h` or by a hoisted template, which is an HTML element | `dom` writes a warning naming the SVG namespace, once per process | development warning |
| A script under `fromDirectory` it does not import (`.tsx`, `.jsx`, `.mts`, `.cts`, `.cjs`, an extension in capitals) | the listing leaves it out, as before, and writes a warning naming the file, once per file and process | warning |
| A request carrying `x-forwarded-for` or `x-real-ip` from a loopback or private address while the Node listener's `forwarded` is off | the listener writes a warning naming `forwarded`, once per listener | warning |
| `Roles.may(null, name)` | answers false | an answer |

A development warning is written inside an `assert` condition, as `ui`'s contrast warning is, so a
release build strips it with the asserts. None of them throws. The two that run on a server write
with `console.warn` and nothing else.

### Why each takes its form

**The inline `$var`.** The variable resolves to nothing, and the page renders without that value.
A refusal would be an assert. Asserts run under Node, where a server renders the page, so one stray
`$var` would stop a page that renders today. The warning gives the fix the README's theme section
already gives: `theme=""` takes the cascade and nothing else.

An element made by `svg` takes no theme, so `theme=""` does nothing there. Its warning says to write
the value, or to draw with `currentColor` and theme the element around it.

A `$fn()` with no theme gets no warning. It is written back as the CSS function of that name
(`$min(` becomes `min(`), which the browser reads. A style written as plain text is an attribute as
written, and `ui` does not read it for `$var`, as before.

**The HTML `<svg>`.** `render` writes the element as `<svg viewBox="0 0 10 10">`, and a browser
parses that markup into the SVG namespace, so a static page that never hydrates draws it today. A
refusal would stop that page. In a browser the element draws nothing, and a hydration fails on its
attributes, which is the failure the warning explains before it happens. The fix it names is
`createElement(tag, 'http://www.w3.org/2000/svg')` handed to `h` as the tag, or `svg` from
`@aweftjs/ui`, which does that for every element under it.

**The script `fromDirectory` leaves out.** `fromDirectory` imports `.js`, `.mjs` and `.ts`. It
skipped every other file without a word, so a module written as `.tsx` was absent and nothing said
why.

A refusal is wrong here. A `.ts` module may import a `.tsx` file beside it under the loader, and
that directory works today. Loading the file is wrong too. `fromDirectory` imports with Node's own
`import()`, and Node runs `.ts` but not `.tsx`, so the same directory would load in one process and
fail in another.

So the warning names the file once and gives both fixes. A module is renamed `.ts`, or listed with
`fromBundle` under the loader. A file a module imports can stay, or move out of the directory to end
the warning. A file that is not code (`.json`, `.md`, `.d.ts`) stays out with no warning.

**The forwarded headers.** The request itself is fine, and the listener answers it. The fault is
that every request through the proxy counts as one address against the rate limit (design 272). Refusing it
would take the site down. Only a request from a loopback or private address is read this way,
because that is where a proxy the application runs sits. The same header from a public address is
a client's own claim, and telling that operator to turn `forwarded` on would hand every client the
address it names. A console that throws on the warning does not reach the request.

**`Roles.may(null)`.** `userOf` answers null for a connection nobody signed in on, and that null is
what a module most often has in hand. "Does nobody hold `admin`" has an answer, and it is no.
`undefined`, empty text and anything that is not text still refuse with `invalid-user`: those are a
wrong argument, not a person.

### What stays as it is: two theme entries with one name

An application entry named like one `ui` ships (`menu`, `card`) merges with it, entry by entry, and
nothing says so. That merge is also the documented way to restyle a component, and every
application does it on purpose: the theme it passes to `<Theme value>` shares 46, 37, 21, 20 and 2
names with `ui`'s in five applications, against one known case where the name was meant as a new
entry. Nothing in the theme tells the two apart, so a warning on a shared name would fire on every
intended restyle. This one is left for a separate call.

## What this costs

A warning line in a development console, or in a server's log, for a page or a directory that has
one of these. A directory that keeps a `.tsx` file a module imports gets one line per start until
the file moves out. The Node listener reads two header names on each request until its one warning
is written.

## Evidence

- `packages/ui/tests/h.test.ts` checks the warning for an inline `$var` with no theme, once per name,
  the `svg` element's own wording, and none for a themed element, `theme=""`, `$$` or a call.
- `packages/dom/tests/h.test.ts` and `template.test.ts` check the warning for an `<svg>` made by `h`
  in any case and by a template, once, and none for one made in the SVG namespace.
- `packages/modules/tests/node.test.ts` checks that a `.tsx`, a `.jsx` a directory down, an `.mts`
  and a `.TS` are each named once, that a `.d.ts` and a `.md` are not, and that the module beside
  them still loads.
- `packages/server/tests/node.test.ts` checks the warning for each header from a loopback peer and
  over a handshake, once per listener, none with `forwarded` set or from a public address, every
  private range read as local, and a request still answered when the console throws.
- `packages/auth/tests/roles.test.ts` checks that `may(null, name)` is false, that a user whose id
  is the text `null` keeps their names, and that `undefined` and `''` still refuse.
- Three applications list a modules directory with `fromDirectory`. None of those directories holds
  a script it leaves out, so none of them writes the line.

## What would reverse this

A warning that turns out to fire on code that is right: then its condition narrows, or it goes.
A loader that every process using `fromDirectory` runs under: then `fromDirectory` loads `.tsx`.
