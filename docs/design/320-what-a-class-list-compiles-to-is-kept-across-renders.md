# 320: What a class list compiles to is kept across renders

Amends design 111, which said the compiled result lives on the render that asked for it, and fix 5
there. Design 109 (one object per render carries every `ui` system) is unchanged: each render still
has its own sheet, its own class numbers counted from zero, and its own `<style>`.

## Decision

The CSS a class list compiles to is a pure function of the theme and the class list. It is kept per
theme object, in a `WeakMap` beside the `contents` and `lasts` memos, compiled once with a stand-in
for the class name. A render that asks for a class list it has not met mints its own `awN` in its
own order, writes that name into the kept rules, and appends them to its own sheet. A server's
renders therefore write the same markup and the same classes as before, byte for byte.

For the theme object to be the same from one render to the next, `baseTheme()` returns one frozen
snapshot of the registry. `defineTheme` and `forgetTheme` throw it away, so a definition made after
a render reaches every later render. `themeAt` keeps the merged theme per override object as well
as per content, because the content key of a site's theme is about 100 KB of text, and comparing it
on every themed element cost more than the merge it saved.

## Why

Measured on a production application whose server renders every public page on one slow vCPU: a
render rebuilt the CSS of every class it used, from the same theme, on every request. With this, a
warm render of its jobs list went from about 28 to 18 ms on a laptop and its about page from about
7 to 4 ms, with the HTML byte-identical on six pages. The cost had shown when a crawler held that
server's one core for twelve minutes.

## What this costs

A theme edited in place after a render would keep its old CSS on every later render of the process,
where before it reached only the renders that read it. Theme data is static once defined (design
111), and `defineTheme` is the only way the registry changes, so nothing in the stack does that.

`baseTheme()` now hands out one frozen object instead of a fresh copy, so a caller that wrote into
the copy throws. The contrast warning, which runs in development only, fires once per class list per
process rather than once per render.

The kept rules grow with the class lists a process uses: a few hundred for a whole site.

## What would reverse this

A theme that has to change while the process runs without going through `defineTheme`, or a reason
for two renders' CSS for one class list to differ.

Checked by `what a chain compiles to is kept across renders, and a definition made after one reaches
the next` in `packages/ui/tests/internal.theme.test.ts`.
