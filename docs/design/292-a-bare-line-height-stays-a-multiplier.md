# 292: A bare `lineHeight` stays a multiplier

Amends design 107 (`style` gives a number in `sizeProperties` `px`) and design 119 (the theme
check's copy of that set).

## Decision

`lineHeight` leaves `sizeProperties`. A theme entry or a `style` prop saying `lineHeight: 1.45`
writes `line-height: 1.45`, the multiplier of the font size CSS reads it as, rather than
`1.45px`. `letterSpacing` stays in the set: a bare number there means pixels to everyone who
writes one. The theme check's copy of the set (design 119, limit 2) drops the same name, so a
bare `lineHeight` is not reported as a size written where it stands; one with a unit on it still
is.

## Why

`line-height` is the one CSS property where a unitless number is the idiom: it scales with the
element's font size and is what every stylesheet writes. Every JSX runtime that appends `px`
to numbers keeps a list of the properties it must not touch, and `lineHeight` heads that list.
Here it was in the set, so `lineHeight: 1.45` painted lines 1.45 pixels apart, over each other,
and the reader found out from the page rather than from a refusal. Nothing in this repo wrote
a bare number there: the type scale names every line height in `rem`.

## What this costs

An application that wrote `lineHeight: 20` meaning twenty pixels now gets a line twenty times
the font size. It writes `'20px'`, or names the type scale's `$textMdLine`.

## What would reverse this

A second property where a bare number is a ratio rather than a length, which would turn the
exception into a second set, `ratioProperties`, rather than one name left out of the first.
