// The theme a page gets before it defines one of its own.
//
// The `*` entry holds the whole contract: the three scales, the seventeen roles, the type scale,
// the sizes, the motion, and the theme functions. The entries under it are what a component
// reaches for, and every one of them is written out of that contract. No colour, size or duration
// is written where it is used, and `check-theme.ts` refuses one that is (design 119).
//
// `ui` still does not decide what an application looks like. It decides that a bare
// `<button theme="button">` renders as something readable, and that the something is the same
// shape in light and in dark. Every entry here is overridden by a `defineTheme` of the same key,
// or by a `Theme` provider on part of the page.

import { themeFunctions } from './functions.ts';
import { defineTheme } from './sheet.ts';
import { lightRoles } from './roles.ts';
import { lightScale } from './scales.ts';
import { motion } from './motion.ts';
import { sizes } from './sizes.ts';
import { typeScale } from './type-scale.ts';

defineTheme({
	'*': {
		// The colour and arithmetic functions are entries of this theme, at the lowest precedence
		// there is, so any theme above can add one or replace one (design 111).
		...themeFunctions,
		...lightScale,
		...lightRoles,
		...typeScale,
		...sizes,
		...motion,

		fontFamily: '$font',
		color: '$foreground',

		// The focus ring, set once for every themed element, so no component has to remember it
		// and none can forget it (design 118). The key after `_cssProp_` is the pseudo-class as
		// CSS spells it, which is why this one is hyphenated and quoted.
		'_cssProp_focus-visible': { outline: '$ringWidth solid $ring', outlineOffset: '$ringOffset' },

		// The only motion this package declares, inside the query that asks whether the person
		// wants any. Written the other way round, as a reduce override, it would lose to a
		// component's own transition: a media query adds no specificity and `*` is emitted first.
		'_media_(prefers-reduced-motion: no-preference)': {
			// Not the outline: a focus ring that fades in is a focus ring that is not there yet.
			transitionProperty: 'background-color, background-image, border-color, color',
			transitionDuration: '$fast',
			transitionTimingFunction: '$ease',
		},
	},

	// Hover and press, once, for everything. The tint is the element's own foreground, so one rule
	// is right for every component and for both modes, and `pressed` wins over `hovered` because
	// its segment sits later in the class list.
	hovered: { backgroundImage: 'linear-gradient($hoverTint, $hoverTint)' },
	pressed: { backgroundImage: 'linear-gradient($pressTint, $pressTint)' },
	disabled: {
		backgroundImage: 'none',
		background: '$muted',
		color: '$mutedForeground',
		borderColor: '$border',
		cursor: 'not-allowed',
	},

	button: {
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '$space2',
		minHeight: '$target',
		padding: '$space2 $space4',
		border: '$borderWidth solid transparent',
		borderRadius: '$radius',
		background: '$accent',
		color: '$accentForeground',
		fontFamily: '$font',
		fontSize: '$textSm',
		lineHeight: '$textSmLine',
		fontWeight: 500,
		cursor: 'pointer',
	},
	button_quiet: { background: 'transparent', color: '$accentSubtleForeground', borderColor: '$border' },
	button_danger: { background: '$danger', color: '$dangerForeground' },

	input: {
		display: 'block',
		width: '100%',
		minHeight: '$target',
		padding: '$space2 $space3',
		border: '$borderWidth solid $input',
		borderRadius: '$radius',
		background: '$surface',
		color: '$surfaceForeground',
		fontFamily: '$font',
		fontSize: '$textSm',
		lineHeight: '$textSmLine',
		_cssProp_placeholder: { color: '$mutedForeground' },
	},
	input_invalid: { borderColor: '$danger' },

	// A select is an input that opens: same edge, same fill, room on the right for the arrow the
	// host draws.
	select: {
		extends: 'input',
		appearance: 'none',
		paddingRight: '$space8',
		cursor: 'pointer',
	},

	// Raised things are told apart by a tint and a line, not by a blurred shadow.
	card: {
		background: '$surface',
		color: '$surfaceForeground',
		border: '$borderWidth solid $border',
		borderRadius: '$radiusLg',
		padding: '$space4',
	},

	popup: {
		background: '$surface',
		color: '$surfaceForeground',
		border: '$borderWidth solid $border',
		borderRadius: '$radius',
		padding: '$space2',
	},

	text: {
		fontFamily: '$font',
		fontSize: '$textMd',
		lineHeight: '$textMdLine',
		color: '$foreground',
		margin: 0,
	},
	text_xs: { fontSize: '$textXs', lineHeight: '$textXsLine' },
	text_sm: { fontSize: '$textSm', lineHeight: '$textSmLine' },
	text_lg: { fontSize: '$textLg', lineHeight: '$textLgLine' },
	text_xl: { fontSize: '$textXl', lineHeight: '$textXlLine' },
	text_2xl: { fontSize: '$text2xl', lineHeight: '$text2xlLine' },
	text_mono: { fontFamily: '$fontMono' },

	muted: { color: '$mutedForeground' },
});
