# 132: `row`, `column` and `divider` are theme entries, not components

## Decision

Laying things out in a line is a theme entry. `defaults.ts` ships seventeen entries for it and
this package exports no component for any of them.

| entry | what it sets |
|---|---|
| `row` | a flex row, items centred across the line, `$space2` between them |
| `column` | a flex column, items stretched across the line, `$space2` between them |
| `row_fill` / `column_fill` | grows into the space it is in, and may shrink below its content |
| `row_center` / `column_center` | centres its content across the page: the main axis for a row, the cross axis for a column |
| `row_start` / `column_start` | the same, pushed to the start |
| `row_end` / `column_end` | the same, pushed to the end |
| `row_spread` / `column_spread` | the space goes between the items |
| `row_wrap` / `column_wrap` | items wrap onto another line |
| `row_tight` / `column_tight` | no space between them |
| `divider` | a line the width of what it is in, `$borderWidth` of `$border` |

`center`, `start` and `end` mean the same thing to a reader on both: **across the page**. On a row
that is `justify-content` and on a column it is `align-items`, which is why the two are separate
entries rather than one that matches both.

## Why

The component catalogue holds what an application needs and nothing beside it. These three are not
components in any real sense. Counted across five applications, the names appear about 200 times
as theme strings on plain elements and the components are imported nowhere.

A component would be worse than the entry it replaces. `<Row>` mounts a component, brackets it for
hydration, and hands the caller back a mounter rather than an element, for a `<div>` with three
declarations on it. The entry is the same three declarations with no mount at all, and it works on
whatever tag the page already wanted: a `<ul>`, a `<nav>`, a `<form>`.

The modifier list is the one the applications actually use, taken from the same count: `fill`
leads, then `spread`, `center`, `wrap`, `start`, `end` and `tight`. Nothing was added because it
would round the set out.

## What this costs

An element themed `row` gets no default padding and no background, so a page that wants a padded
row writes `theme={['card', 'row']}` or its own entry. That is the intent: these three say how
things line up and nothing else.

A caller who wants a `<Row>` writes one in three lines in their own application, and this package
does not have to keep it working.

## What would reverse this

An application needing a row that measures itself or reorders its children, which is behaviour and
therefore a component. It would be a new name, not these three.
