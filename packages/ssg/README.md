# @aweftjs/ssg

Pages from a routed site, at build time and on request. It renders every page a site declares,
writes each one as a file a static host can serve with no configuration, once per language when
the site has more than one, and hands the browser one function that takes the page over in place.
Or it renders each page when it is asked for, with the answers the page's reads were given written
into it, so the browser takes it over without asking for that data again.

It decides nothing else: not where page data comes from, not which host serves the files, not what
that host does with a URL it has no file for, not whether a page it could not enumerate should
fail your build, and not how long a rendered page may be kept.

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
site's absolute URL, needed for the sitemap and the language alternates. Two more for a site in
more than one language, below.

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
nothing else, so a page bundle carries none of the rest of this package. `languageOf(document)`,
beside it, reads the language back off a page for the entry of a site in several languages.

## A site in several languages

```ts
const site = createSite({
	page: (router) => h(Site, { router }),
	shell, out, base: 'https://example.com',
	locale: 'en',
	locales: { fr: JSON.parse(readFileSync('text/fr.json', 'utf8')), uk: JSON.parse(readFileSync('text/uk.json', 'utf8')) },
});
```

**`locale`** is the language the pages are written in, a BCP 47 tag. **`locales`** is every other
language, each tag to its catalog, the plain object `@aweftjs/ui`'s text tokens look up (its README,
The text a page shows). With `locales` and no `locale` the site is refused (`locale-needed`),
because the layout below needs to know which language stands unprefixed.

**The layout.** The source language is written where the site was written before,
`<url>/index.html`; every other language under its tag, `/fr/<url>/index.html`, with `/fr/404.html`
and `/fr/shell.html` beside it. A site that adds a language keeps every URL it had, and a host
serves every language with the same two rules it served one with. `write()` renders each URL the
walk found once per language, with the language's catalog on the render and a router whose `base`
is the language's prefix, so a link the page writes with `router.base` in front stays in its
language. `page('/fr/about')` is `about` in French: the URL carries the language. `write(urls)`
with a list writes a prefixed URL in that language and an unprefixed one in every language.

**The document.** `<html>` gains `lang` with the page's tag, replacing one the shell wrote, and
`dir="rtl"` for a script that runs right to left, which `Intl.Locale` says and nothing here lists.
With a `base`, every page's head gains a `<link rel="alternate" hreflang>` per language and an
`x-default` naming the source language's URL, and the sitemap lists every language's URL with the
same alternates as `xhtml:link`. A site with `locale` alone writes `lang` and nothing else changes.

**The report.** The write result gains `text`: per language, `missing`, the keys the pages looked
up that its catalog has no entry for (those show the source), and `unused`, the entries no page
looked up. It reads what the renders resolved, so it says what the site would show; the build's own
report (`packages/build/README.md`) reads the files, and the two differ on a page compiled at run
time. It fails nothing. An application that wants a build to stop on a missing translation reads it
and stops.

**The entry.** `languageOf(document)` answers `{ locale, base }`: the tag on `<html lang>`, and
`/<tag>` when the address is under that prefix, `''` for the source language and for a site with
one language alike. A page with no `lang` answers `''` for both, which finds no catalog and which
`context()` reads as no language, so the entry below is the entry of a site with one language too.

```tsx
const catalogs = { fr: () => import('./text/fr.json'), uk: () => import('./text/uk.json') };
const { locale, base } = languageOf(document);
const catalog = (await catalogs[locale]?.())?.default;
attach(document.body, <Site router={createRouter({ base })} />, context({ locale, catalog }));
```

The catalog is the application's own import, one request before `attach`, and a hydration waits
for it. How the visitor's language is chosen is not here: the pages are files, one per language,
and a host or a first page sends the reader to the right tree.

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

## Pages on request

`createPages` makes a server module that renders the page for every page request (design 304).
Your own module calls it and returns what it answers, naming the reads a page may make in its
`deps`:

```ts
// modules/site/Pages.ts
import { fileURLToPath } from 'node:url';
import { createPages } from '@aweftjs/ssg';
import { h } from '@aweftjs/ui';

import { Site } from '../../page/site.tsx';

export const deps = ['auth/Gate', 'posts/List', 'posts/Read'];

export default ({ imports }) => createPages({
	page: (router, client) => h(Site, { router, client }),
	gate: imports.Gate,
	modules: { 'posts/List': imports.List, 'posts/Read': imports.Read },
	dir: fileURLToPath(new URL('../../dist', import.meta.url)),
});
```

**`page`** builds the page from a router and a client, the same function your browser entry mounts
with its own. **`gate`** is the gate your server runs: `open`, or the `auth/Gate` instance from
`deps`. **`modules`** is every module a page may ask while it renders, under the name the page asks
it by. It is read once, and an entry with no `call` (an import spelled differently from `deps`
reads as undefined) is refused when the module is made. **`dir`** is the directory the bundler
wrote, `dist` when left off, resolved from the working directory, so build it from
`import.meta.url`: its `index.html` is the shell, read once when the
module is made, and a missing one is refused then (`no-shell`). **`renders`** (16) and
**`timeoutMs`** (10 000) are the two limits. **`failed`** is where a page's defect and a failed read
are reported, with the page's path and the error. It takes the arguments `createServer`'s
`handlers.failed` takes, so pass the same function to send both to one place. Left off, each is
written to the console.

**A render asks as a visitor nobody knows.** The page gets a client made for that render. When the
page asks a module, the client takes it from `modules`. It asks the gate who a request for the
page's path, with no query and no headers, is. Then it asks the gate's `access` whether that
visitor may call the module, as the server does for an ask from a browser. A module the gate keeps
from an anonymous visitor is refused in the render too, whoever sent the request. The one
exception is a gate that reads a credential from the path itself: the render's request carries the
path, so the gate finds the credential there too. The arguments and the result go through JSON, as
they would over the socket. `share` answers a handle whose document never arrives and whose
`ready` rejects with `not-shared`.

**What it answers.**

| what happened | status | body |
|---|---|---|
| a read failed: the module threw something with no `reason`, or it is not in `modules` | 503 | the shell |
| the page waited on a document it shared, and did not catch `not-shared` | 503 | the shell |
| more renders running than `renders` | 503 | the shell |
| the render took longer than `timeoutMs` | 503 | the shell |
| the page threw, let a refusal escape, or wrote a bad status | 500 | the shell |
| the page wrote `<Meta httpEquiv="status" content="410" />` | that status | the page |
| a stage shows its fallback, or nothing | 404 | the page |
| otherwise | 200 | the page |

A refusal, a throw that carries a `reason`, is an answer: the page shows it and the render goes on.
A failed read is not an answer. The page would be missing a part, and a crawler would index it
that way. So the shell answers instead, and in a browser it mounts and asks again. When several
status metas are written, the deepest wins, then the latest, as for the `robots` meta, so a page
overrides its layout. The status is 200 or a number from 400 to 599. Anything else is refused with
`bad-status`.

If a loader rejects and nothing shows the rejection, the render rejects (design 306). After a
failed read, the answer is the shell with 503. Otherwise it is a defect in the page, like a
component that throws or a `bad-status`. A defect is answered with the shell and 500, and reported
to `failed`. The request hook never throws, so a page that breaks cannot end the process, whether
or not the server has a `handlers.failed`.

A render past its time keeps its place among the `renders` until it ends. `HEAD` gets the status
and headers alone. It declines a method other than GET and HEAD, and a path that names a file in
`dir`.

**The browser half.** `replay` on `@aweftjs/ssg/client` wraps the page's client. For each ask the
render made, it answers with the recorded answer, each one once and in the order the render asked.
Every other ask goes to the server. Once `attach` has finished hydrating, it throws away the answers
nobody used, so the next ask with the same arguments goes to the server.

```tsx
import { createClient } from '@aweftjs/client';
import { createRouter } from '@aweftjs/dom/router';
import { attach, replay } from '@aweftjs/ssg/client';

const router = createRouter();
attach(document.body, <Site router={router} client={replay(createClient())} />);
router.links(document.body);
```

**A page that reads data goes through `suspend`, and the loader returns a component call.**

```tsx
'posts/:id': suspend(null, async ({ stage }) =>
	<Article post={await client.ask('posts/Read', { id: stage.params.get().id })} />),
```

On the server, the render waits for the loader. In the browser, the server's markup stays on screen
until the answer arrives from `replay`, with no request, and then the component's elements take
over the server's elements. **An element the loader builds itself is made outside the mount.** That
holds whether the markup comes right after the arrow, `async () => <article>...</article>`, or
after an `await` in a longer body. Such an element replaces the server's element instead of taking
it over, the page flashes, and nothing reports it. Build the markup in a component and pass it what
you read.

A refusal rejects the ask, as it does over the socket, so the loader catches it and reads `reason`:

```tsx
try {
	return <Article post={await client.ask('posts/Read', { id })} />;
} catch (error) {
	if (error.reason === 'no-such-post') return <NoPost />;   // NoPost writes the status meta
	throw error;
}
```

**In a test, with no browser.** Parse the page's body into `dom`'s light document, and set
`data-aweft-ssg` on its body, as the served page has. The light document cannot find an element by
id, so give it a `getElementById` that returns the answers script (`replay` refuses a document
without one, `no-lookup`). Pass that same document to `replay`. `attach` throws away the unused
answers only for the document `replay` read them from.

```ts
const document = createDocument();
document.body.setAttribute('data-aweft-ssg', '');
const body = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('</body>'));
for (const node of parseHtml(body, document)) document.body.appendChild(node);
const script = /id="aweft-answers">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
const source = Object.assign(document, { getElementById: (id) => (id === 'aweft-answers' ? { textContent: script } : null) });
const client = replay(underlying, source);
await attach(document.body, h(Site, { router: createRouter({ url }), client })).ready;
```

**A path matches whole only on an `exact` stage.** Without it `about` matches `/about/x`, and that
URL is a 200 About page here as it is in the browser. Set `exact` on the `StageContext` and nest
under keys that end in `*` (`ui`'s README, Routing), and a path a key only starts shows the
fallback: 404 here, and the same not-found page in the browser.

**Where it goes in `sources`.** It answers every path that is not a file, so a module that also
answers `request`, such as `uploads`, has to load before it, and `static/Files`, which serves the
bundle, after it: your source first, then the batteries, with `files` last.

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

**How the data reaches the client of a page written at build time.** A component that waited on
the server waits again on the client unless you hand it the value. Write it out beside the pages
and read it in your entry before you call `attach`.
[`recipes/posts-to-pages`](https://github.com/torrinworx/aweft/tree/main/recipes/posts-to-pages)
shows the whole pattern, and `dom`'s README has the reason. A page rendered on request carries its
answers, and `replay` hands them over.

**Which host serves the files, or what it does with a URL it has no file for.** The layout is chosen
so that "the exact file, then `<path>/index.html`" is enough for any static host. Answering an
unenumerated URL with `shell.html` and everything else with `404.html` is the host's rule, not this
package's.

**Whether a missing `entries()` fails a build.** It is in the report. You decide.

**When a page is written.** This is a Node API. Your build script, your job or your module calls
`write()`. There is no bundler plugin hook.

**Whether a page rendered on request is kept.** Every request renders. A cache in front of the
process is yours.

**Who a page is rendered for.** Nobody: a signed-in visitor gets the page anyone gets, and whatever
is theirs loads after the page is live.

**Which language a visitor gets.** A header, a cookie, a setting: the application's, and the
pages are one file per language for it to send a reader to. **Whether a translation is right, or
whether a missing one fails a build.** It is in the report.

## Known limits

**A render runs no `connection` hook and sends no `observe` event.** A read whose `call` relies on
state a connection set up fails, and the request is 503. The logs battery records no ask a render
made. A render ignores an ask's `timeout` option, and `timeoutMs` applies instead.

**A render that never ends takes a place for good.** A render past `timeoutMs` is answered with the
shell and keeps running, because nothing can stop it, and its place among the `renders` is held
until it ends. A page that waits on something that never settles therefore takes one place per
request, and after `renders` of them every page on the site is the shell, 503, until the process
restarts. The cap is what keeps those renders from filling memory instead.

**A page must not render a read's progress into its final markup.** A render passes each progress
value a module reports to the page, but it records only the answer, and `replay` gives back only
the answer. In the browser the page hears no progress during the hydration, so markup built from
progress differs from the server's and the page does not hydrate. Show progress while a read is
running, never in what the page shows once it has the answer. A page that needs it would reverse
this: progress would then be recorded and replayed before the answer.

**A page that waits on a shared document is answered with the shell.** A render has no link, so
`ready` rejects with `not-shared`. A page that shows a waiting state while `document` is undefined
renders the same markup in the browser, so it hydrates.

**A key that ends in a bare `*` is not walked.** `walk()` reports it as an act it cannot
enumerate, as it reports `:name` with no `entries()`, so on an `exact` site (`ui`'s README, Routing)
the pages under a `docs/*` stage are not written at build time. `write(urls)` with the URLs listed
writes them.

**`createPages` renders one language.** `createSite`'s `locale` and `locales` are not options here.

**A language tag that is also a top-level segment of the site is the language's.** `placeOf`
reads the prefix first, so a site with an act at `/de` and German under `de` writes the German
home page over the act's page. Name the act something else; a two-letter segment is a language on
any site in more than one of them.

**The source language is refused in `locales`** (`locale-twice`), and a tag `Intl` cannot read is
refused (`locale-invalid`); a tag it can read but has no plural rules for falls back to the host's
own rules, which is what `Intl` does.

## Proven by

[`recipes/ssg`](https://github.com/torrinworx/aweft/tree/main/recipes/ssg) builds the routed site,
writes it out, serves it and drives it in Chromium: a deep link hydrates with no element the
server wrote removed or replaced, a click on the hydrated page is answered, a link changes the act
and the title, and a URL nothing enumerated is served the live shell.
[`recipes/posts-to-pages`](https://github.com/torrinworx/aweft/tree/main/recipes/posts-to-pages)
publishes a post over a socket, writes that one page, hydrates it in a browser, and refreshes the
sitemap from a scheduled full write.
[`recipes/translated-site`](https://github.com/torrinworx/aweft/tree/main/recipes/translated-site)
writes a site in three languages, reads the report, and hydrates the Ukrainian page in Chromium
with nothing the server wrote removed.
[`recipes/pages-on-request`](https://github.com/torrinworx/aweft/tree/main/recipes/pages-on-request)
renders a publication on each request. It answers 404 where a page asks for it and where no act
takes the whole path. In Chromium it hydrates a post with no read sent to the server again, no
element replaced and no element moved.
`tests/pages.test.ts` drives `createPages` through a real server for every row of the table above,
and `tests/replay.test.ts` takes a page it rendered over with no read reaching the client.

The suite in `tests/` is the same guarantees stated one at a time, over the light tree
`@aweftjs/dom` ships, plus a Chromium run for `attach`.

## Boundaries

An integrator: it may import anything, and nothing imports it. It is the only package here that
writes files, and `@aweftjs/ssg/client` is the half that does not, so a page bundle never reaches
`node:fs` through it.
