// The sizes: the spacing step and its multiples, the two corner sizes, the smallest pointer
// target, and the three line widths.
//
// `$space` is four pixels and everything else made of space is a multiple of it, so two things
// laid out by different components still line up. `$target` is the smallest a thing a finger has
// to hit may be. The line widths are named because an entry that writes `1px` has written a value
// nobody can find again.

/** Every size the default theme ships. */
export const sizes: Readonly<Record<string, string>> = {
	$space: '4px',
	$space2: '8px',
	$space3: '12px',
	$space4: '16px',
	$space6: '24px',
	$space8: '32px',
	$space12: '48px',

	$radius: '6px',
	$radiusLg: '10px',

	$target: '24px',

	$borderWidth: '1px',
	$ringWidth: '2px',
	$ringOffset: '2px',
};
