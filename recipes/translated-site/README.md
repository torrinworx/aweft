# recipes/translated-site

A site written in one language and launched in three.

The pages are written in English and say nothing about language. The build finds every string they
show and writes `text/source.json`, the list an agent fills in as `text/fr.json` and `text/uk.json`.
The site is then written out once per language, each under its own prefix, and the page a reader
lands on is in their language from the first byte and live the moment the bundle runs.

```
site.tsx  ──▶  vite + aweft({ text: true })  ──▶  text/source.json     the strings, for the agent
                                                   dist/assets/*.js     one bundle for every language
          ──▶  createSite({ locale, locales })  ──▶  dist/index.html    English, where the site stood
                                                   dist/fr/index.html  French, under its tag
                                                   dist/uk/index.html  Ukrainian
```

## What it shows

- **The build finds the text.** A heading, a `Button` label, a `TextField` placeholder, an `img`
  alt, a sentence with a link inside it, a plural, a title: every one is in `text/source.json`,
  and nothing that is a word for the machine (`class`, `href`, an id) is. A `translate="no"`
  subtree stays as written. The library's own strings (`Previous`, `Sign in`) are folded in from
  the catalogs the packages ship.
- **One message, not two.** `Read <link>the docs</link> first` is one entry with the link inside
  it, so French can put the words in French order.
- **The plural follows the language.** `{n, plural, one {# item} other {# items}}` has two
  branches in English and four in Ukrainian, and the page's count moves through `few` and `many`.
- **A modifier runs over the translation.** `Save now` is `Enregistrer maintenant` on the French
  page, and the modifier bolds `maintenant`.
- **An act from a document.** `site/Notes` is stored as text and compiled where it runs, with the
  text pass on, in Node and in the browser alike. Its strings were answered when it was stored and
  live beside it, not in `text/source.json`, which is about files.
- **Two reports.** The build says what each catalog lacks against the files; the write says what
  each lacks against what rendered. They differ on the stored act, and both are right.
- **Hydration in Ukrainian.** A cold load of `/uk/` keeps every element the server wrote; a click
  inside the translated sentence is a navigation the router took over; the French shell served for
  a URL nothing enumerated mounts live and shows French.

## Run it

```
AWEFT_DEFAULT_H=@aweftjs/ui AWEFT_TEXT=1 node --import @aweftjs/build/loader recipes/translated-site/main.ts
```

Both settings on the Node side match `vite.config.ts`, which is what makes the server's markup the
markup the browser renders (`packages/build/README.md`).

## The entry

```tsx
const catalogs = { fr: () => import('./text/fr.json'), uk: () => import('./text/uk.json') };
const { locale, base } = languageOf(document);
const catalog = (await catalogs[locale]?.())?.default;
attach(document.body, <Site router={createRouter({ base })} sources={sources} />, context({ locale, catalog }));
```

The language is read off the page, the catalog is one import, the router's base is the language's
prefix so every link the page writes with `router.base` in front stays in its language, and the
same entry takes over a generated page or mounts the shell.
