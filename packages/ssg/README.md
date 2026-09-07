# @aweftjs/ssg

Pages from a routed site, at build time and at run time. It renders every page a site declares,
writes each one as a file a static host can serve with no configuration, and hands the browser one
function that takes the page over in place.

It decides nothing else: not where page data comes from, not which host serves the files, not what
that host does with a URL it has no file for, and not whether a page it could not enumerate should
fail your build.

## Quickstart

```ts
import { readFileSync } from 'node:fs';
import { createSite } from '@aweftjs/ssg';
import { h } from '@aweftjs/ui';

import { Site } from './site.tsx';

const site = createSite({
	page: (router) => h(Site, { router }),
	shell: readFileSync('dist/index.html', 'utf8'),
	out: 'dist',
	base: 'https://example.com',
});

const written = await site.write();
console.log(written.files);          // every page, 404.html, shell.html, sitemap.xml
console.log(written.unenumerated);   // the acts nothing could list
```

Four things go in. **`page`** builds the whole page from a router, and it is the same function your
browser entry mounts, which is what makes the markup here the markup the client renders. **`shell`**
is the `index.html` your bundler built, as text. **`out`** is the directory. **`base`** is the
site's absolute URL, and it is needed only for the sitemap.

The browser half is one import:

```tsx
import { createRouter } from '@aweftjs/dom/router';
import { attach } from '@aweftjs/ssg/client';

const router = createRouter();
attach(document.body, <Site router={router} />);
router.links(document.body);
```

`attach` hydrates a page this package wrote and mounts anything else, so the development server and
the generated site share one entry file. It imports `mount` and `hydrate` from `@aweftjs/ui` and
nothing else, so a page bundle carries none of the rest of this package.

## The three things a site does

### `site.walk()`

Renders `/`, reads the stage list `ui`'s `render` holds, and turns every act the site declares into
a URL. It renders each URL it has not rendered yet and stops when a render adds none, which is what
finds the pages under a nested stage: a stage inside an act does not exist until that act has been
rendered once.

```ts
const { urls, unenumerated } = await site.walk();
```

The rules, per act:

| the act key | what the walk does |
|---|---|
| plain, no `entries` | one URL |
| plain, with `entries()` | one URL, unless `entries()` answers `[]` |
| has `:name` or `*rest`, with `entries()` | one URL per answered object |
| has `:name` or `*rest`, no `entries` | none. The act is reported in `unenumerated` |

An act's URL sits under its stage's prefix, and the prefix is what that stage's parent actually
matched: an act declared `:page` inside a stage that matched `posts/3` is `/posts/3/:page`.

**Every declared act is a page.** Nothing tells an act you route to from an act you only ever reach
with `stage.open`, so a dialog declared in `acts` is written out as a page of its own. Say so in its
head if you do not want it found:

```tsx
<Head><Title>The dialog</Title><Meta name="robots" content="noindex" /></Head>
```

**A URL the site has no page for is refused.** `page(url)` and `write(urls)` throw `not-a-page`
when a URL leaves a stage showing its fallback or showing nothing, because that page is the site's
`404.html` and writing it at another path publishes a "not found" page on a URL the site claims to
have. The limit is what routing can see: an act declared `posts/:id` matches any id, so a slug that
names no row is a page as far as this is concerned, and only your act knows better.

**An act with a parameter and no `entries()` is reported, not refused.** A site with a page per
database row is normal and a build tool that stops because it cannot see the database is not. Those
URLs are answered by `shell.html`, which mounts live. An application that wants the build to fail
reads `unenumerated` and fails on it.

### `site.page(url)`

One finished document, for a caller that serves or stores a page rather than writing it.

```ts
const { html, title, noindex } = await site.page('/posts/hello');
```

`noindex` is read off the page's head list, not out of the HTML, so a `robots` tag that lost its
group and was never emitted does not count.

A URL with a query or a hash on it is the page without them: `/docs?page=2#top`, `/docs/` and
`/docs` are one page and one file.

**A page whose `pending` never settles never finishes.** A render waits for everything a component
declared `pending` and there is no timeout anywhere in this package, so a fetch that hangs hangs the
build. The wait, and the timeout on it, are the application's.

### `site.write(urls?)`

With no list it walks the site and writes everything:

| file | what it is |
|---|---|
| `index.html`, `<url>/index.html` | one per page. Every static host serves this layout with no configuration |
| `404.html` | the site rendered at `/_aweft-404`, a URL a site is not expected to declare, so what it shows is your fallback act. A site that declares a root `*rest` act matches that URL too, so `404.html` is that act's page instead, and the walk reports the `*rest` act as unenumerated |
| `shell.html` | the shell as it stands, with no stamp, so `attach` mounts it live |
| `sitemap.xml` | every indexable page, when the site has a `base`. With none there is no sitemap and the result says `sitemap: null` |

With a list it writes those pages and touches nothing else: no walk, no 404, no shell, no sitemap.
That is the call a running application makes when it publishes one thing, and it is why a scheduled
full write is how the sitemap stays current.

```ts
await site.write([`/posts/${id}`]);   // inside a request
await site.write();                    // nightly, or at build time
```

## The document

The shell is read as text, not parsed, and four things happen to it:

- the theme's `<style data-aweft>` and the page's head tags go at the front of `<head>`, behind a
  `<meta charset>` your shell wrote as the head's first child
- the shell's own `<title>` is removed when the page declares one, so the document carries exactly
  one
- the markup goes inside `<body>`, and the body tag gains `data-aweft-ssg`
- nothing else is touched

**Keep your shell's `<body>` empty.** The page's markup is what goes there, and a hydration refuses
anything else it finds. A shell with markup in its body is refused by name, with the fix. A bundler
puts its module script in the head, which is where it has to stay.

A shell with no `<head>` or no `<body>` is refused too.

## What it never decides

**Where page data comes from.** `entries()` and your components read whatever they read. This
package never opens a store.

**How the data reaches the client.** A component that waited on the server waits again on the client
unless you hand it the value. Write it out beside the pages and read it in your entry before you
call `attach`; `recipes/posts-to-pages` shows the whole pattern, and `dom`'s README has the reason.

**Which host serves the files, or what it does with a URL it has no file for.** The layout is chosen
so that "the exact file, then `<path>/index.html`" is enough for any static host. Answering an
unenumerated URL with `shell.html` and everything else with `404.html` is the host's rule, not this
package's.

**Whether a missing `entries()` fails a build.** It is in the report. You decide.

**Rendering at request time.** This is a Node API. Your build script, your job or your module calls
`write()`. There is no bundler plugin hook.

## Proven by

`recipes/ssg` builds the routed site, writes it out, serves it and drives it in Chromium: a deep
link hydrates with no element the server wrote removed or replaced, a click on the hydrated page is
answered, a link changes the act and the title, and a URL nothing enumerated is served the live
shell. `recipes/posts-to-pages` publishes a post over a socket, writes that one page, hydrates it in
a browser, and refreshes the sitemap from a scheduled full write.

The suite in `tests/` is the same guarantees stated one at a time, over the light tree
`@aweftjs/dom` ships, plus a Chromium run for `attach`.

## Boundaries

An integrator: it may import anything, and nothing imports it. It is the only package here that
writes files, and `@aweftjs/ssg/client` is the half that does not, so a page bundle never reaches
`node:fs` through it.
