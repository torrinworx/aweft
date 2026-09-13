# 279: A site is written once per language

Amends design 148: the walk is unchanged, and what it enumerates is written once per language.
Amends design 149: the document gains `lang`, `dir` and the alternates. Amends design 150: the
sitemap lists every language of a page.

## Decision

`createSite` takes two more options. `locale` is the site's source language, a BCP 47 tag.
`locales` is the other languages, each tag to its catalog, the plain object design 278 reads.
`locales` with no `locale` is refused (`locale-needed`): the layout below needs to know which
language stands unprefixed.

**The layout.** The source language is written where the site was written before: `<url>/index.html`.
Every other language is written under its tag: `/fr/<url>/index.html`, `/fr/404.html` and
`/fr/shell.html`. So a site that adds a language keeps every URL it had, and a host serves every
language with the same two rules it served one with.

**One render per page per language.** `write()` renders each URL the walk found once per
language, with `context({ locale, catalog })` and a router whose `base` is the language's prefix,
so a link the page writes with `router.base` in front stays in its language. `page('/fr/about')`
is the page `about` in French: the URL carries the language, and a caller at request time names
nothing else. `write(urls)` with a list writes a prefixed URL in that language and an unprefixed
one in every language.

**The document.** `<html>` gains `lang` with the page's tag, replacing one the shell wrote, and
`dir="rtl"` when `Intl.Locale(tag).getTextInfo()` says the script runs right to left; nothing is
written for a left-to-right language, which is the default. With a `base`, every page's head
gains one `<link rel="alternate" hreflang>` per language and one `x-default` naming the source
language's URL, and the sitemap lists every language's URL with the same alternates as
`xhtml:link`, which is the form a crawler reads.

**The report.** `WriteResult` gains `text`: per language, `missing`, the keys the pages looked
up that the catalog has no entry for, and `unused`, the catalog's entries no page looked up.
It is read off what the renders resolved (design 278 records each key), so it says what the
site would show, not what a source file holds. It fails nothing: an application that wants a
build to stop on a missing translation reads it and stops.

**The client half.** `languageOf(document)` on `@aweftjs/ssg/client` answers `{ locale, base }`
from the page: the tag on `<html lang>`, and the prefix the address carries when its first
segment is that tag. That is the prefix rule written once, in the package that wrote the files,
so an entry makes its router with the right `base` and its render with the right catalog before
it calls `attach`:

```tsx
const catalogs = { fr: () => import('./text/fr.json'), uk: () => import('./text/uk.json') };
const { locale, base } = languageOf(document);
const catalog = (await catalogs[locale]?.())?.default;
attach(document.body, <Site router={createRouter({ base })} />, context({ locale, catalog }));
```

With no `lang` on the page, `locale` is `''` and `base` is `''`, which is a site with one
language: no catalog is found under `''`, and `context()` reads an empty tag as none.

## Why

A static host serves files, so a language has to be a path, and a path prefix is the one form
every host, every crawler and every link shares. Leaving the source language unprefixed keeps a
site's URLs when it gains a second language, which is the day this is switched on.

The render already takes one context per page (design 109), so a language is one more thing on
that context and the page's own code never sees it: the same `page(router)` a browser entry
mounts renders every language. The report comes from the renders for the same reason: what a
page looked up is exactly what a reader would have seen untranslated.

`lang` and `dir` on `<html>` are what a screen reader, a spell checker and a font fallback read
first; `hreflang` alternates in the head and the sitemap are what a search engine reads to show
a reader the page in their language rather than the source.

## What this costs

A site with five languages renders and writes five times as many pages, and each page's head
carries six link tags more. The report is per render, so a key only a page nobody enumerates
would look up is not in it.

The catalog reaches the browser as the application's own import, one request before `attach`,
and a hydration waits for it. Writing each page's used strings into its HTML would save that
request and is not done here.

## Evidence

`packages/ssg/tests/locales.test.ts`: the layout for two languages and the default; `lang` on
every document and `dir="rtl"` for `ar` only; the shell's own `lang` replaced; the alternates on
each page and in the sitemap, the `x-default` naming the source language; `page('/fr/about')`
in French and `page('/about')` in the source; a listed unprefixed URL written in every language
and a prefixed one in its own; `locales` with no `locale` refused; the report's two halves;
`languageOf` on a generated page, on a shell with a prefix, and on a page with no `lang`.
`recipes/translated-site` writes a site in three languages, hydrates the Ukrainian tree in
Chromium with nothing the server wrote removed, and reads the report.

## What would reverse this

A host that cannot serve a prefix, which would want a subdomain or a query, both of which a
static host cannot route. A page whose used strings are inlined in its HTML, which would drop
the import above and is a change to `attach`.
