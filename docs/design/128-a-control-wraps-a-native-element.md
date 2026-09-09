# 128: A control wraps a native element the theme dresses

Amended: a handed `element` of the wrong tag asserts, and a box that starts ticked says so in the
markup. Amended by design 224: `Select` is the one exception to the rule below. It is a `<button
role="combobox">`, a drawn list and a hidden `<select>` the form and autofill still reach; every
other row of the table holds.

## Decision

Every control this package ships is one native element with a theme on it. There is no control
in `ui` that draws its own geometry out of `div`s.

| component | the element | what the theme does |
|---|---|---|
| `Button` | `<button>`, or `<a>` when `href` is given | the `button` entry and its `quiet` and `danger` variants |
| `TextField` | `<input>` | the `input` entry, and `input_invalid` while `error` is set |
| `TextArea` | `<textarea>` | the `input` entry, plus `textarea` for the growth rules |
| `Checkbox` | `<input type="checkbox">` | the `checkbox` entry, sized to `$target` |
| `Radio` | `<input type="radio">` | the `radio` entry, sized to `$target` |
| `Toggle` | `<input type="checkbox" role="switch">` | the `toggle` entry, a pill and a thumb drawn with `::before` |
| `Slider` | `<input type="range">` | the `slider` entry, thumb and track on the vendor pseudo-elements |
| `Select` | `<select>` | the `select` entry (design 130) |

An `element` prop hands in the node to decorate instead of building one, which is how a caller
keeps a reference to the element or reuses one it already has. The tag has to be the one the
control wraps, and `Button` takes either of its two. Anything else is an assert naming the tag it
wanted and the tag it got: taken quietly, a `<div>` gets the theme, the ARIA and the label, and
behaves like nothing at all, which reads as the component being broken rather than as the call
being wrong.

**What a control starts as is in the markup.** A state the platform keeps as a property is invisible
to a static render, so a control writes it where the markup can carry it as well: `Checkbox`,
`Radio` and `Toggle` write `checked`, `TextField` writes `value`, and `TextArea` writes its text as
its content. A server page therefore shows the ticked boxes and the filled fields before any script
runs. The property still follows the cell once the page is alive; the attribute is what the server
can send. The two text controls write theirs once rather than following the cell, because the
platform reads both as the value the control started with and a keystroke would otherwise be a DOM
write nobody can see.

## Why

Native first. What the browser gives for free is the part that is hardest to get right by hand and
easiest to get wrong quietly: the full keyboard map, form participation and autofill, the correct
role with no ARIA written by anybody, real markup on a static render, and the platform's own
handling of assistive technology.

The reactivity is unaffected. Every state prop is still a cell in both directions, and the `is*`
cells of design 107 already work on a native element, because they are real DOM events.

## What native costs

Measured across five applications. Two losses, both on
`Select`, and both are written out in design 130: outside Chromium the open list is drawn by the
host, and the open state cannot be observed or driven.

Props that go, and that no application passes: a vertical `Slider`, and its `cover`, `thumb`,
`expand`, `styleThumb` and `styleTrack`; a `Select` with a caller's own anchor element; a `Toggle`
that picks its own variant from its value.

A control is therefore styled through the platform's own hooks: `accent-color` for a checkbox and
a radio, the vendor pseudo-elements for a range input, `appearance` for a select. Those hooks are
narrower than a `div`. Where one is missing, the answer is a theme entry the host does understand,
not a drawn replacement.

## What would reverse this

An application needing a control the platform has no element for, or needing the open state of a
select. Either is a new component built the other way with a design note of its own, and the
native one stays where it is; the two do not become one component with a switch, because a switch
means both paths are always half tested.
