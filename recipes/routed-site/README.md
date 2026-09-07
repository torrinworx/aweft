# recipes/routed-site

A small site with real URLs: nested pages, a page with a parameter, a page that arrives later, a
dialog the back button dismisses, and a title per page.

## See it

```
npx vite recipes/routed-site
```

Open what it prints and click around. Every link goes through the router, so the address bar moves
and nothing is fetched. Press back after opening the dialog.

## What the gate does with it

```
node --import @aweftjs/build/loader recipes/routed-site/main.ts
```

Three passes, in this order, and it exits nonzero when any assertion fails.

**Every page, written out at once.** Six URLs, six `context()` objects, one `Promise.all`. Each
page is rendered with a router made from its own URL and no `window` anywhere, so this is what a
static build does. It then asserts what only rendering several pages in one process can catch:
each page has its own title; none carries another page's head tags or another page's act id (the
layout's own ids are on every page, because the layout is on every page); every page carries at
least one generated class, and every one of them is defined in that page's own stylesheet; and a
class name two pages share carries the same rules on both. Names are minted per render from a
counter that starts again on each page, so the six pages share names rather than having disjoint
ones, and a shared name meaning two different things is the failure this catches.

**Taken over in place.** One of those pages is parsed into a document and hydrated. Every element
the server wrote is still the same object afterwards, in the body and in the head, and not one
`title`, `meta` or `link` was made: a stamped head tag is adopted rather than replaced.

**Driven in Chromium.** The site is built with vite through `aweft()`, served with every path
answering the same page, and driven: a deep link to `/docs/install` opens the nested act from a
cold load, a click on a link changes the act and the document title, focus lands on the act's
root, the live region carries the new title, writing the query cell puts it in the URL without
adding a history entry, the dialog opens on a history entry that back dismisses without the
address bar moving, and scrolling a long page, leaving, and coming back puts the page where it
was.

## How it is put together

`site.tsx` is the whole site. The root `StageContext` has the router and the act table; `Layout` is
the template every act is rendered inside, and the `Title` it writes is the site default. Each act
overrides it from inside a `Head`, which is one level deeper and therefore wins.

`docs` is an act that renders a `StageContext` of its own. It never sees the URL: it routes on
whatever the act above it did not match, so `/docs/install` reaches the child as `install`.

The dialog is not a URL. `stage.open({ name: 'dialog', history: true, from: 'the post' })` shows an
act now and pushes a history entry at the URL the page is already on, so the link a reader copies
is the link to the post.

## What it does not do for you

It barely styles anything: the theme is three entries, enough that the pages carry classes the
checks can read, because the point is the routing. It does not generate the pages to disk either.
Writing the rendered markup out as files is `ssg`'s job, and the per-stage entry in
`context().stage` is what a static walk reads to know which URLs exist.

**Put no `<title>` in your page shell if a page declares one.** The head tags are written at the
front of the head so yours wins, but the shell's stays in the markup behind it.
