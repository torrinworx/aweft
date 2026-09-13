# Translation

A page is written once, in one language, and launched in as many as it needs. The build finds
every string, an agent or a person fills a catalog per language, and the site writes one tree of
pages per language. Nothing in the page changes between one language and three.

## Every literal is a token

With the build's `text` option on (`aweft({ text: true })` in the vite config, `AWEFT_TEXT=1` for
the Node loader), every literal a person reads becomes a `text()` call from `@aweftjs/ui`, which
looks the string up in the render's catalog where the page mounts:

```tsx
<input placeholder="Search" name="q" />
<p>Save changes</p>
```

compiles to

```tsx
import { text as _text } from '@aweftjs/ui';
<input placeholder={_text("Search")} name="q" />
<p>{_text("Save changes")}</p>
```

What moves: every literal text child of an element and every string on a text prop (`label`,
`title`, `placeholder`, `alt`, `aria-label` and the rest). What stays: a `class`, an `href`, a
`name`, an `id`, text with no letter in it, and anything under `translate="no"`. A string built
at run time is never a literal: write it as a message, which is also the only way it translates.
`packages/build/README.md`, The text a page shows, is the whole list.

## Messages

The message syntax is a subset of ICU MessageFormat, read with no dependency:

```tsx
<p>{text('{n, plural, one {# item} other {# items}}', { n: count })}</p>
<p>{text('Read <link>the docs</link>', { link: (inner) => <a href="/docs">{inner}</a> })}</p>
```

A plural picks the branch `Intl.PluralRules` gives for the language; a tag hands the inner
content to a function; a cell among the values is followed. `packages/ui/README.md`, The text a
page shows, is the syntax and the exports.

## The catalog

When the bundle closes, the plugin writes `text/source.json` under the bundler's root: every key
the page shows, with the files it came from, and the keys every installed `@aweftjs` package
ships in its own `text.json` folded in, so `Close`, `Search` and the sign-in form's words are in
the same file as your own. A catalog is `text/<tag>.json` beside it, a plain object from key to
message. The plugin warns about the keys a catalog lacks and the entries no file uses, and fails
nothing: what to do about a missing translation is yours.

```tsx
const { locale, base } = languageOf(document);
const catalog = (await catalogs[locale]?.())?.default;
attach(document.body, <Site router={createRouter({ base })} />, context({ locale, catalog }));
```

## One tree of pages per language

`@aweftjs/ssg` writes the source language where the site was written before, `<url>/index.html`,
and every other language under its tag, `/fr/<url>/index.html`, with a `lang` on every document
and the alternates in every head and in the sitemap:

```ts
createSite({ page, shell, out, base, locale: 'en', locales: { fr, uk } });
```

The write result says, per language, which keys the pages looked up that the catalog lacks and
which entries no page used. `recipes/translated-site/` is a site written once and launched in
three languages, with the Ukrainian page hydrated in Chromium.

## Both sides must agree

A page rendered on a server with the option off and bundled with it on has different trees on
the two sides, and does not hydrate. `AWEFT_TEXT` is the loader's word for the plugin's `text`,
as `AWEFT_DEFAULT_H` is for `defaultH`, and the scaffold in `recipes/full-stack/` sets both.

## What is not decided for you

Which language a visitor gets: a header, a cookie, a setting, and the pages are one file per
language for the application to send a reader to. Whether a translation is right. There is no
fallback chain: `fr-CA` is one catalog, and an application that wants `fr` underneath merges the
two objects. The language is fixed per render: a switch is a navigation, never a cell every
token follows.
