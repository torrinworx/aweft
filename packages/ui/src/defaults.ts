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
	// A circle for an icon on its own. The padding is even so the icon sits in the middle of it.
	button_round: { borderRadius: '50%', padding: '$space2', aspectRatio: '1' },
	// A button that sits inside a line of text and takes no room of its own.
	button_inline: {
		background: 'transparent',
		border: 'none',
		padding: 0,
		minHeight: 0,
		color: '$accentSubtleForeground',
		textDecoration: 'underline',
	},

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

	// A textarea is an input that grows. `resize: none` because the component sets the height
	// itself, and a handle that fights it is a handle that loses on the next keystroke.
	textarea: {
		$textAreaMax: '16rem',
		resize: 'none',
		overflowY: 'auto',
		minHeight: '$space12',
		maxHeight: '$textAreaMax',
	},

	// A tick box and a radio are drawn by the host out of one property, so this says how big and
	// what colour, and the host draws the tick.
	checkbox: {
		width: '$target',
		height: '$target',
		margin: 0,
		flexShrink: 0,
		accentColor: '$accent',
		cursor: 'pointer',
	},
	radio: { extends: 'checkbox' },

	// A switch is a checkbox the host is told not to draw, so this draws the pill and the thumb.
	toggle: {
		$switchWidth: '40px',
		$switchHeight: '24px',
		$switchThumb: '18px',
		appearance: 'none',
		position: 'relative',
		flexShrink: 0,
		margin: 0,
		width: '$switchWidth',
		height: '$switchHeight',
		borderRadius: '$switchHeight',
		border: '$borderWidth solid $input',
		background: '$muted',
		cursor: 'pointer',
		_cssProp_before: {
			content: '\'\'',
			position: 'absolute',
			top: '50%',
			left: '$space',
			transform: 'translateY(-50%)',
			width: '$switchThumb',
			height: '$switchThumb',
			borderRadius: '50%',
			background: '$background',
		},
		_cssProp_checked: { background: '$accent', borderColor: '$accent' },
		// The thumb's travel is what is left of the pill once the thumb and its two margins are
		// taken out of it, worked out in the stylesheet so a change of size needs one edit.
		'_cssProp_:checked::before': { left: 'calc(100% - $space - $switchThumb)' },
	},

	// A range input is drawn out of two vendor pseudo-elements, which are spelled with their own
	// colons because they are not in this package's pseudo-element table.
	slider: {
		$trackHeight: '6px',
		$thumbSize: '16px',
		appearance: 'none',
		width: '100%',
		height: '$target',
		margin: 0,
		background: 'transparent',
		cursor: 'pointer',
		'_cssProp_::-webkit-slider-runnable-track': {
			height: '$trackHeight',
			borderRadius: '$radius',
			background: '$muted',
		},
		'_cssProp_::-webkit-slider-thumb': {
			appearance: 'none',
			width: '$thumbSize',
			height: '$thumbSize',
			marginTop: 'calc(($trackHeight - $thumbSize) / 2)',
			borderRadius: '50%',
			border: '$borderWidth solid $background',
			background: '$accent',
		},
		'_cssProp_::-moz-range-track': {
			height: '$trackHeight',
			borderRadius: '$radius',
			background: '$muted',
		},
		'_cssProp_::-moz-range-thumb': {
			width: '$thumbSize',
			height: '$thumbSize',
			borderRadius: '50%',
			border: '$borderWidth solid $background',
			background: '$accent',
		},
	},

	// What a labelled control puts around itself: the label above, the description and the error
	// below, and the whole thing in a column unless the control sits beside its words.
	field: {
		display: 'flex',
		flexDirection: 'column',
		gap: '$space',
		width: '100%',
	},
	field_inline: {
		flexDirection: 'row',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: '$space2',
	},
	field_label: {
		fontFamily: '$font',
		fontSize: '$textSm',
		lineHeight: '$textSmLine',
		fontWeight: 500,
		color: '$foreground',
	},
	field_hint: {
		fontFamily: '$font',
		fontSize: '$textXs',
		lineHeight: '$textXsLine',
		color: '$mutedForeground',
		flexBasis: '100%',
	},
	field_error: {
		fontFamily: '$font',
		fontSize: '$textXs',
		lineHeight: '$textXsLine',
		color: '$dangerSubtleForeground',
		flexBasis: '100%',
	},

	// A select is an input that opens: same edge, same fill, room on the right for the arrow the
	// host draws. `base-select` is what puts Chromium 135 and later into the appearance whose open
	// list is themed; every other host ignores it and draws its own (design 130).
	select: {
		extends: 'input',
		appearance: 'base-select',
		paddingRight: '$space8',
		cursor: 'pointer',
		'_cssProp_::picker-icon': { color: '$mutedForeground' },
		'_cssProp_::picker(select)': {
			background: '$surface',
			color: '$surfaceForeground',
			border: '$borderWidth solid $border',
			borderRadius: '$radius',
			padding: '$space',
		},
	},
	option: {
		padding: '$space $space2',
		borderRadius: '$radius',
		background: 'transparent',
		color: '$surfaceForeground',
	},

	// Raised things are told apart by a tint and a line, not by a blurred shadow.
	card: {
		background: '$surface',
		color: '$surfaceForeground',
		border: '$borderWidth solid $border',
		borderRadius: '$radiusLg',
		padding: '$space4',
	},
	card_tight: { padding: 0 },

	popup: {
		background: '$surface',
		color: '$surfaceForeground',
		border: '$borderWidth solid $border',
		borderRadius: '$radius',
		padding: '$space2',
	},

	// Off the screen and still in the reading order. Put it in a class list beside anything: a file
	// input that has to stay focusable, a message shown somewhere else, a label a page replaced.
	offscreen: {
		$hairline: '1px',
		position: 'absolute',
		width: '$hairline',
		height: '$hairline',
		padding: 0,
		overflow: 'hidden',
		clipPath: 'inset(50%)',
		whiteSpace: 'nowrap',
		border: 0,
	},

	// A modal dialog. The element is in the top layer already, so there is no z-index here either;
	// the scrim is a name because a black at half strength is right in both modes and neither role
	// pair says it.
	dialog: {
		$dialogWidth: '32rem',
		$scrim: 'rgba(0, 0, 0, 0.5)',
		width: '100%',
		maxWidth: '$dialogWidth',
		padding: '$space4',
		border: '$borderWidth solid $border',
		borderRadius: '$radiusLg',
		background: '$surface',
		color: '$surfaceForeground',
		'_cssProp_::backdrop': { background: '$scrim' },
	},
	dialog_head: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: '$space2',
		marginBottom: '$space2',
	},
	dialog_body: { display: 'flex', flexDirection: 'column', gap: '$space2' },

	// A tip is the page's own colours the other way up, which is the same contrast ratio read from
	// the other side and so is compliant wherever the pair it inverts is.
	tooltip: {
		$tooltipWidth: '18rem',
		maxWidth: '$tooltipWidth',
		padding: '$space $space2',
		borderRadius: '$radius',
		background: '$foreground',
		color: '$background',
		fontFamily: '$font',
		fontSize: '$textXs',
		lineHeight: '$textXsLine',
	},

	// A disclosure: the summary is a button, so it takes the `button` entry and adds only what a
	// summary needs. `listStyle` and the vendor marker are the two ways a host draws the triangle.
	disclosure: { display: 'block', width: '100%' },
	disclosure_summary: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: '$space2',
		listStyle: 'none',
		cursor: 'pointer',
		'_cssProp_::-webkit-details-marker': { display: 'none' },
	},
	disclosure_summary_left: { justifyContent: 'flex-start' },
	// The platform has no `disabled` for a summary, so the pointer is taken away here and the focus
	// order in the component.
	disclosure_summary_disabled: { pointerEvents: 'none' },

	filedrop: {
		display: 'flex',
		flexDirection: 'column',
		gap: '$space2',
		padding: '$space4',
		border: '$borderWidth dashed $input',
		borderRadius: '$radius',
		background: '$background',
		color: '$foreground',
		cursor: 'pointer',
	},
	filedrop_dragging: {
		borderColor: '$accent',
		background: '$accentSubtle',
		color: '$accentSubtleForeground',
	},
	filedrop_prompt: {
		display: 'flex',
		alignItems: 'center',
		gap: '$space2',
		fontFamily: '$font',
		fontSize: '$textSm',
		lineHeight: '$textSmLine',
		color: '$mutedForeground',
		cursor: 'pointer',
	},
	filedrop_input: { extends: 'offscreen' },
	filedrop_list: {
		display: 'flex',
		flexDirection: 'column',
		gap: '$space',
		listStyle: 'none',
		margin: 0,
		padding: 0,
	},
	filedrop_entry: { display: 'flex', alignItems: 'center', gap: '$space2' },
	filedrop_entry_error: { color: '$dangerSubtleForeground' },

	// The message a `Validate` shows, beside its icon. The colour and the type are `field_error`,
	// which the class list already carries.
	validate: { display: 'flex', alignItems: 'center', gap: '$space' },

	// Four sliders and a swatch. The hue track is the only gradient with a fixed set of stops, so it
	// is the only one written here; the other three are the colour that is chosen now (design 139).
	colorpicker: { display: 'flex', alignItems: 'flex-start', gap: '$space3' },
	colorpicker_swatch: {
		width: '$space12',
		height: '$space12',
		flexShrink: 0,
		borderRadius: '$radius',
		border: '$borderWidth solid $border',
	},
	colorpicker_track: {
		borderRadius: '$radius',
		'_cssProp_::-webkit-slider-runnable-track': { background: 'transparent' },
		'_cssProp_::-moz-range-track': { background: 'transparent' },
	},
	colorpicker_hue: {
		$hue0: 'hsl(0, 100%, 50%)',
		$hue60: 'hsl(60, 100%, 50%)',
		$hue120: 'hsl(120, 100%, 50%)',
		$hue180: 'hsl(180, 100%, 50%)',
		$hue240: 'hsl(240, 100%, 50%)',
		$hue300: 'hsl(300, 100%, 50%)',
		background: 'linear-gradient(to right, $hue0, $hue60, $hue120, $hue180, $hue240, $hue300, $hue0)',
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

	// An icon is sized in `em`, so it is the size of the text beside it wherever it lands.
	icon: {
		$iconSize: '1em',
		display: 'inline-block',
		verticalAlign: 'middle',
		flexShrink: 0,
		width: '$iconSize',
		height: '$iconSize',
	},

	// Three dots, pulsing in turn. The motion is declared only inside the query that asks whether
	// the person wants any (design 118), so reduced motion leaves three still dots.
	dots: { display: 'inline-flex', alignItems: 'center', gap: '$space' },
	dot: {
		$dotSize: '6px',
		display: 'inline-block',
		width: '$dotSize',
		height: '$dotSize',
		borderRadius: '50%',
		background: 'currentColor',
		_keyframes_pulse: '0%, 80%, 100% { opacity: 0.35 } 40% { opacity: 1 }',
		'_media_(prefers-reduced-motion: no-preference)': { animation: '$pulse $slow infinite' },
	},
	dot_second: { '_media_(prefers-reduced-motion: no-preference)': { animationDelay: '$fast' } },
	dot_third: { '_media_(prefers-reduced-motion: no-preference)': { animationDelay: '$slow' } },

	// Laying things out in a line is an entry rather than a component (design 132). `center`,
	// `start` and `end` all mean across the page, which is the main axis of a row and the cross
	// axis of a column, so each of the three is two entries rather than one.
	row: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '$space2' },
	column: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '$space2' },

	row_fill: { flexGrow: 1, flexBasis: 0, minWidth: 0 },
	column_fill: { flexGrow: 1, flexBasis: 0, minHeight: 0 },

	row_center: { justifyContent: 'center' },
	row_start: { justifyContent: 'flex-start' },
	row_end: { justifyContent: 'flex-end' },
	column_center: { alignItems: 'center' },
	column_start: { alignItems: 'flex-start' },
	column_end: { alignItems: 'flex-end' },

	row_spread: { justifyContent: 'space-between' },
	column_spread: { justifyContent: 'space-between' },
	row_wrap: { flexWrap: 'wrap' },
	column_wrap: { flexWrap: 'wrap' },
	row_tight: { gap: 0 },
	column_tight: { gap: 0 },

	divider: {
		alignSelf: 'stretch',
		flexShrink: 0,
		border: 'none',
		height: '$borderWidth',
		margin: 0,
		background: '$border',
	},
});
