// Motion: two durations, two easings, and the two strengths a state tint is mixed at.
//
// There is very little of it. Nothing in this package moves a thing across the screen; what
// changes is a colour, and it changes quickly. The tints live here rather than in `roles.ts`
// because they are not colours: each is the element's own foreground at a fixed strength, which is
// what lets one rule cover every component in both modes (design 118).

/** The durations, the easings, and the two state tints. */
export const motion: Readonly<Record<string, string>> = {
	$fast: '120ms',
	$slow: '240ms',
	$ease: 'cubic-bezier(0.2, 0, 0, 1)',
	$easeOut: 'cubic-bezier(0, 0, 0.2, 1)',

	$hoverTint: 'color-mix(in srgb, currentColor 8%, transparent)',
	$pressTint: 'color-mix(in srgb, currentColor 16%, transparent)',
};
