# 117: Dark is a second theme definition, swapped at the root

## Decision

`@aweftjs/ui` exports two partial themes, `light` and `dark`. Each redefines the thirty-six scale
steps and the seventeen roles in the `*` entry and touches nothing else.

```tsx
mount(document.body, <Theme value={dark}><App /></Theme>);
```

That is the whole mechanism. `Theme` already merges a partial theme onto whatever is above it and
already gives its subtree its own generated classes, so:

- swapping the page is one provider at the root;
- either may nest inside the other, and each subtree resolves its own roles, because the class cache
  is keyed on what a theme says (design 111) and the two say different things;
- an application swaps at run time by putting a cell in the provider's `value`;
- an application that wants the operating system to decide writes `_media_(prefers-color-scheme:
  dark)` in its own theme, which the engine already supports. This package does not do it for them.

`light` is the same values the default theme already starts from. It exists so a light island can
sit inside a dark page, which is the same need read the other way round.

## Why

It is the mechanism the engine already has, so dark mode adds no concept. The alternative,
emitting CSS custom properties and swapping one variable, is the thing design 111 already
declined: values in a generated class are literals, and a theme swap is a class attribute write
rather than a stylesheet rebuild.

Two themes on one page was already the engine's behaviour and already had a test. Light and dark
are the two themes that behaviour is for.

## Evidence

`packages/ui/tests/look.test.ts`, in "light and dark nested on one page each resolve their own
roles", mounts a dark subtree inside a light one and reads the generated rules for each: the two
get different classes and each resolves its own roles. "a mode is a partial theme: it moves the
roles and leaves everything else alone" is the other half of it. `packages/ui/tests/browser.test.ts` does the same in Chromium against computed colours, and
`recipes/ui/main.ts` asserts a button's computed background differs between the two panes of the
preview page and matches the role in each.

## What this costs

A page showing both modes generates two sets of classes rather than swapping one variable. That is
what makes two modes on one page work at all, and it is the same cost design 111 already accepted
for two themes.

## What would reverse this

An application needing the operating system's preference to change the page with no JavaScript at
all. Custom properties are the only way to do that, and doing it would reopen design 111 rather
than this one.
