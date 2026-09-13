# 277: The build finds the text a page shows

## Decision

`transform` takes one more option, `text`. The plugin takes it as `aweft({ text: true })`, and a
Node process says it as `AWEFT_TEXT=1`, the way `AWEFT_DEFAULT_H` names `defaultH` (design 147):
a page rendered on a server and bundled for a browser has to be compiled the same way on both
sides, or the two disagree about every text node and the page will not hydrate.

**On, in a file whose `h` is `@aweftjs/ui`'s**, the transform rewrites two things:

- every literal text child of an element, in whichever notation wrote it, becomes a call
  `text("…")`, with `text` imported from `@aweftjs/ui` under a name the file does not use, the
  way `template` and an icon come in;
- every string literal on one of the text props becomes the same call. The props are one fixed
  list, `TEXT_PROPS` on the package: `label`, `title`, `description`, `placeholder`, `alt`,
  `error`, `caption`, `aria-label`, `aria-description`, `aria-placeholder`, `aria-valuetext` and
  `aria-roledescription`. HTML's own text-carrying attributes, and the four names `ui`'s
  components take a label, a description, an error and a caption under. A text prop under
  another name (`Chooser`'s `search` and `none`, a `MenuGroup`'s `heading`) is written as a
  `text()` call by hand, and `ui`'s suite names them so the list and the components cannot
  drift apart unnoticed.

The `h` rule is design 092's and 108's: only where the transform can prove which `h` an element
compiles to does it know that `text()` will be resolved, and a file compiled against `dom`'s `h`
is left byte for byte as it was, so a plain `dom` page pays nothing and imports nothing.

**What is left alone.** Text with no letter in it (`Unicode \p{L}`): punctuation, a number, a
run of spaces, a separator. An element carrying a literal `translate="no"`, and everything
under it. A prop given as an expression, whatever it holds. The props of an element that carries
a spread, because the spread may carry `translate` or one of the names and the source does not
say which wins; its children still move. A file with the option off, which is every file until
an application asks.

**Every string the file wrapped is answered.** `TransformResult` gains `text`, the keys each
once, the wrapped literals first and the hand-written calls after them. A call the page wrote
itself, `text('Hello {name}', { name })` with `text` bound from `@aweftjs/ui`, is not rewritten
and is answered too, whatever `h` the file has, so a message written by hand in a helper with no
element in it reaches the catalog beside the ones the build found. A second argument with a literal `context`
makes the key `source|context`, which is how one word with two meanings gets two entries. The
plugin gathers every file's list and, when the bundle closes, writes `text/source.json` under
the bundler's root: one entry per key, sorted, naming the files it came from relative to that
root, with the keys every installed `@aweftjs` package ships in its `text.json` folded in under
that file's name, so one catalog covers the library's strings beside the page's. It then reads
every `text/<tag>.json` beside it and warns, never fails, about the keys each lacks and the
entries each holds that no file uses. The loader writes nothing: a process that renders pages is
not a build.

**A file under `node_modules` is never wrapped.** A package ships compiled files that a server
render reads as they are, and wrapping them in the bundle alone would give the two sides
different trees. A package's own strings are `text()` calls in its source (design 278).

**A wrapped text is a hole in the hoisted template.** The template keeps the static shape and
the string is applied per instance, the way any varying child is.

## Why

Translation needs every string a page shows to be found, and a person or an agent cannot be
asked to find them: a page of a few hundred strings has a few hundred places to miss one. The
transform already reads every element in every notation into one model before hoisting (design
265 runs its rules there), so one pass over that model sees every literal a page can show, and
it sees it at the offset that wrote it. Text children and the text props are the places a page
puts words for a person; a `class`, an `href`, a `name`, a `type` or an `id` is a word for the
machine and is never on the list.

Wrapping rather than replacing keeps one bundle for every language: the string is looked up
where the page mounts (design 278), so a site adds a language by adding a catalog, and a page
compiled at run time from a stored module (the runtime mode of the transform) is found the same
way, with its strings answered to whoever stored it.

Off by default, because a page that shows one language should compile to the same bytes it
compiled to before, and because the hole below is a cost the page has to choose.

## What this costs

A text that hoisted into the template as a literal is now a hole filled by a component call,
which mounts one text node per instance. Measured in Chromium, 10,000 rows with two texts each,
built and mounted into a tbody, best of seven: 7.5 ms with the text in the template, 22 ms as a
hole filled by a token, about 0.7 µs per text. A page of a few hundred strings pays under a
millisecond; a list of 10,000 rows with text in every row pays about 15 ms. Each token adds a
bracket pair to the static markup, 14 bytes, which is what lets a hydration pair it beside a
static sibling.

The list of text props is knowledge `build` holds about `ui`. It is the same kind of knowledge
the hoister holds about which props are attributes, and `ui`'s suite names each text prop its
components take, by hand, against the list: a component that grows one is a line in that list or
on the set, and a name that leaves the set turns the suite red. Nothing reads the components'
props interfaces, so a new prop nobody names is not caught by a machine.

A string built at run time, `label={\`${count} items\`}`, is not a literal and is never found;
the page writes it as a message, `text('{count, plural, one {# item} other {# items}}', {
count })`, which is also the only way it can be translated correctly. A sentence split across
an element, `<p>Hello <b>{name}</b></p>`, becomes two keys, `Hello` and nothing for the name,
which is the wrong unit for a translator; the page writes it as one message with a tag.

## Evidence

`packages/build/tests/text.test.ts`: each of the three notations wraps a text child and a text
prop; a `dom` file is untouched; text with no letter is untouched; a literal `translate="no"`
stops the wrap for the element and its subtree; a spread leaves the element's props alone and
its children move; an expression prop is left; a hand-written `text()` is not rewritten and its
key is answered, with `|context` when the call names one; the answered list holds each key once;
an `h` call that cannot hoist and holds a wrapped literal is printed from the model, so the
literal moves there too; the hoisted template holds a hole where the literal was; the plugin
writes `text/source.json` with the files per key and warns about a missing and an unused entry;
the loader reads `AWEFT_TEXT`. `packages/build/tests/ui-equivalence.test.ts` runs the `ui` page with
`text: true` as well, so a wrapped file mounts, renders and hydrates like an unwrapped one.

## What would reverse this

A way to bake the looked-up string into a per-language template at build time, so the hole
above costs nothing, at which point `text` could substitute rather than wrap when it is handed a
catalog. A component library declaring which of its props are text, at which point the list
would come from it rather than sit here.
