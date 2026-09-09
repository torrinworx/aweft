# 219: The loader context reaches every wait, and an animated icon is one of them

Amends design 144, which said this stack ships no drawings, with where the animated one an
application wants comes from. Nothing about that rule changes: no drawing ships.

## Decision

**Every place in this package that shows a wait shows the `LoaderContext`'s loader.** There were
three waits and two of them did:

| where | before | after |
|---|---|---|
| `Button`, while a promise its `onClick` returned is pending | the context's loader, else `LoadingDots` | unchanged |
| `suspend`, while its loader runs and the call named no fallback | the context's loader, else nothing | unchanged |
| `FileDrop`, on an entry an application moved to `status: 'loading'` | a theme segment and nothing else | the context's loader, else `LoadingDots` |

The zone reads the context once, where it reads everything else it needs from the mount, and each
row of the listing puts the loader before the file's name while that entry is loading. It is the
same fallback chain `Button` writes, `LoaderContext.read(context).loading ?? LoadingDots`, so an
application that named a loader once names it for all three.

The loader is drawn before the name rather than in place of the remove button: a row still says
which file it is and still lets a person take it back out. `LoadingDots` with no `label` is
`aria-hidden`, so the row reads as its file name and nothing is announced twice.

**The dots stay the shipped default and no drawing ships.** `LoadingDots` is what all three fall
back to, and it is three `<span>`s and a keyframes block rather than a drawing (design 218).

**`svg-spinners` is documented as an optional peer of `@aweftjs/icons`, like every other set.** It
is not installed and not named in any manifest. It is worth naming in the README because it is the
one set whose icons carry their own motion, and because `Icon` writes an icon's body into the
element as markup (design 131), so an `<animate>` inside that body is a real SVG animation the
moment it is on the page. That makes an animated spinner one line an application writes:

```tsx
import spinner from '@aweftjs/icons/svg-spinners/3-dots-fade';

<LoaderContext value={{ loading: () => <Icon name={spinner} size="1.25em" /> }}><App /></LoaderContext>
```

and every wait in the package shows it, which is what the paragraph above is for.

The set holds 46 icons under that prefix, `3-dots-fade` among them, and that icon's body is three
`<circle>` elements each holding an `<animate>`. Nothing is installed and nothing is copied.

## Why

An application that names a loader means it. `FileDrop` was the one place that asked a person to
wait and did not ask what to show them: the entry got the segment `loading` in its class list and
the default theme gives that segment no rules, so an upload in progress looked exactly like an
upload that had not started. That is a silent wrong state, the kind nobody reports because nothing
looks broken.

Reading the context in the zone rather than in the row: the row is rebuilt per entry and the
context is a property of the mount, so reading it once is the same answer and one lookup.

The `svg-spinners` paragraph is documentation and not code because design 144 is not being
reopened. The question it answers is the one a reader arrives with after design 144 takes the
drawings away: the dots are the default and I want a spinner, so where does one come from. The
answer is an icon set, the same as every other drawing, and the only thing worth writing down is
that this stack does not have to do anything special for an animated one.

## Evidence

`packages/ui/tests/filedrop.test.ts`:

- "a loading entry shows the loader the context named": a zone under a `LoaderContext` whose
  `loading` is a named component renders that component in the row when the entry moves to
  `loading`, and nothing when it moves back to `ready`. An earlier shape rendered the name and the
  remove button and no loader at all.
- "a loading entry with no context above it shows the dots": the same page with no provider renders
  the `dots` chain, which is the shipped default.

`packages/ui/tests/suspend.test.ts` and `packages/ui/tests/controls.test.ts` already hold the
matching checks for `suspend` and `Button`, and both still pass unchanged; they are named here
because the rule above is that all three read one context.

`packages/ui/tests/icon.test.ts`, "an animated body is written through as it is": an icon whose
body holds an `<animate>` renders that element as a child of the group, with its attributes intact,
in the light tree and in a static render. The fixture is written for this test; no set is
installed and no icon data is copied.

## What this costs

A row in a file listing gains an element while it is loading, so an application that measured the
row's height in that state gets a taller one. Nothing else moves.

The icons README names a set this repo does not install and cannot check, which is what
`@iconify-json/lucide` already is for the other examples in that file: the difference is that
lucide is a devDependency of `packages/icons` and this one is not, so nothing in the gate reads the
set. What the gate does check is the sentence underneath it: that `Icon` carries an animated body
through unchanged.

## What would reverse this

An application wanting a wait indicator per component rather than per page, which is a prop on the
component and not a change to this. The context is the default; a call that names its own already
wins in `suspend`, and `Button` and `FileDrop` would take the same prop the day one is asked for.
