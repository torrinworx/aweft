// Motion: two durations, two easings, and the two strengths a state tint is mixed at.
//
// There is very little of it. Almost everything that changes here is a colour, and the two things
// that are not are a switch's thumb crossing its pill and a slider's thumb growing under the
// pointer (designs 217 and 220). The tints live here rather than in `roles.ts` because they are not
// colours: each is the element's own foreground at a fixed strength, which is what lets one rule
// cover every component in both modes (design 118).
//
// `$slow` and `$easeOut` are the vocabulary and nothing in the default theme reads either; an
// application names them the way it names `$controlSm` (design 217).

/** The durations, the easings, and the two state tints. */
export const motion: Readonly<Record<string, string>> = {
	$fast: '150ms',
	$slow: '240ms',
	$ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
	$easeOut: 'cubic-bezier(0, 0, 0.2, 1)',

	$hoverTint: 'color-mix(in srgb, currentColor 8%, transparent)',
	$pressTint: 'color-mix(in srgb, currentColor 16%, transparent)',
};
