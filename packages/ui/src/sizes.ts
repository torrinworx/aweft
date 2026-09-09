// The sizes: the spacing step and its multiples, the corner sizes, the height every control is,
// the smallest pointer target, and the edges a control is drawn with.
//
// `$space` is four pixels and everything else made of space is a multiple of it, so two things
// laid out by different components still line up. `$control` is how tall a control is at rest, so
// a button beside a field beside a select reads as one row rather than three heights (design 192).
// `$target` is the smallest a thing a finger has to hit may be, and it sizes the things that are
// not controls. The edges are named because an entry that writes `1px` has written a value nobody
// can find again.

/** Every size the default theme ships. */
export const sizes: Readonly<Record<string, string>> = {
	$space: '4px',
	$space2: '8px',
	$space3: '12px',
	$space4: '16px',
	$space6: '24px',
	$space8: '32px',
	$space12: '48px',

	$radiusSm: '4px',
	$radius: '6px',
	$radiusLg: '10px',

	$controlSm: '32px',
	$control: '36px',
	$controlLg: '40px',

	$target: '24px',

	// The side of the empty box a select's arrow is drawn out of (design 195, amended), and of the
	// breadcrumb's separator after it (design 201). A size of the theme rather than a `$name` on the
	// entry, so an application that wants a bigger arrow moves one value in the theme it already
	// overrides.
	$chevron: '8px',

	// The side of the colour picker's saturation and brightness square (design 222). A size of the
	// theme rather than a `$name` on the entry, so an application that wants a bigger square moves
	// one value in the theme it is already overriding, which is what it has instead of a `size`
	// prop on that component.
	$planeSize: '160px',

	// How wide a sheet is against the left or the right edge (design 202). A sheet along the top or
	// the bottom is as tall as what is in it, so there is no height beside this.
	$sheetWidth: '24rem',

	$borderWidth: '1px',
	$ringWidth: '3px',
	// A hairline along the bottom edge of an input, not elevation. It is `currentColor`
	// for the same reason the two state tints are: a `$name` holds text and that text is not read
	// again (design 111), so a `$foreground` written in here would reach the CSS as its characters.
	$shadowSm: '0 1px 2px color-mix(in srgb, currentColor 6%, transparent)',
};
