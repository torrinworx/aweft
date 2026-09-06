// The type scale: six sizes, each with the line height that belongs to it.
//
// Sizes are in `rem`, so a person who has set a larger text size in the browser gets one. A size
// and its line height are two names rather than one value because a component sets them on
// separate properties, and pairing them here is what stops a component pairing them by hand.

/** The six sizes, their line heights, and the two families. */
export const typeScale: Readonly<Record<string, string>> = {
	$textXs: '0.75rem',
	$textXsLine: '1rem',
	$textSm: '0.875rem',
	$textSmLine: '1.25rem',
	$textMd: '1rem',
	$textMdLine: '1.5rem',
	$textLg: '1.125rem',
	$textLgLine: '1.75rem',
	$textXl: '1.25rem',
	$textXlLine: '1.75rem',
	$text2xl: '1.5rem',
	$text2xlLine: '2rem',

	$font: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
	$fontMono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};
