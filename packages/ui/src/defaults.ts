// The theme a page gets before it defines one of its own.
//
// The `*` entry holds the whole contract: the three scales, the eighteen roles, the type scale,
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
		// No `color` here. This entry is on every themed element, so a colour written here lands on
		// an element inside a control as well as on the control, and an `Icon` inside a filled
		// button took the page's foreground on the button's own fill: measured in Chromium on
		//, `rgb(28, 32, 39)` on `rgb(28, 32, 39)`, an invisible icon. The page's colour
		// belongs to the page's own entry, beside the background it already has to set (design 198).

		// The focus ring, set once for every themed element, so no component has to remember it
		// and none can forget it (design 118). The key after `_cssProp_` is the pseudo-class as
		// CSS spells it, which is why this one is hyphenated and quoted.
		//
		// A translucent halo rather than an outline (design 192): an outline is drawn outside the
		// border box and cannot be soft, so it reads as a second border. The outline is turned off
		// here and only here, and this block names `$ring` twice, which is what design 119's check
		// asks of an entry that turns one off.
		'_cssProp_focus-visible': {
			outline: 'none',
			borderColor: '$ring',
			boxShadow: '0 0 0 $ringWidth color-mix(in srgb, $ring 50%, transparent)',
		},

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
	// Dimmed rather than repainted (design 192): a disabled danger button repainted in `$muted` is
	// no longer recognisable as the control it is. The tint goes off, as design 118 has it.
	disabled: {
		backgroundImage: 'none',
		opacity: 0.5,
		cursor: 'not-allowed',
	},

	button: {
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '$space2',
		// A control's height is its height, whatever the host's own box model says: an `<a>` with
		// an `href` wears this entry too, and an anchor is content-box where a button is not.
		boxSizing: 'border-box',
		minHeight: '$control',
		padding: '$space $space4',
		border: '$borderWidth solid transparent',
		borderRadius: '$radius',
		background: '$accent',
		color: '$accentForeground',
		fontFamily: '$font',
		fontSize: '$textSm',
		lineHeight: '$textSmLine',
		fontWeight: 500,
		cursor: 'pointer',
		// An icon reads narrower than the text beside it, so the side it sits on gives up `$space`
		// of its padding. Written as two rules because a button may hold one at each end; a button
		// holding one icon and a bare text label matches both, because a text node is not a child
		// element and the icon is therefore first and last (design 194).
		'_cssProp_has(> svg:first-child)': { paddingLeft: '$space3' },
		'_cssProp_has(> svg:last-child)': { paddingRight: '$space3' },
	},
	// The size axis, one segment after `type` (design 194). A small control takes the smaller text
	// step with it; a large one is the same text in a taller box.
	button_sm: {
		minHeight: '$controlSm',
		padding: '$space $space2',
		fontSize: '$textXs',
		lineHeight: '$textXsLine',
	},
	button_lg: { minHeight: '$controlLg' },
	// A square for a button whose label is an icon: the height in both directions, and no padding
	// at all. The segment is `square` and not `icon`, because `icon` is an entry of its own and a
	// bare `icon` segment would compile that entry onto the button as well (design 194, amended).
	// The zero is said three times over, and every one of them is a rule the plain button would
	// otherwise win: `button_sm` matches later in the class list than `button_square`, so its
	// `padding` shorthand outranks it, and the two `:has()` rules above outrank both by specificity
	// whatever the order (design 194).
	button_square: {
		width: '$control',
		padding: 0,
		'_cssProp_has(> svg:first-child)': { paddingLeft: 0 },
		'_cssProp_has(> svg:last-child)': { paddingRight: 0 },
	},
	button_square_sm: { width: '$controlSm', padding: 0 },
	button_square_lg: { width: '$controlLg', padding: 0 },

	button_quiet: {
		background: 'transparent',
		color: '$accentSubtleForeground',
		borderColor: '$border',
		boxShadow: '$shadowSm',
	},
	button_danger: { background: '$danger', color: '$dangerForeground' },
	// A circle for an icon on its own. The padding is even so the icon sits in the middle of it.
	button_round: { borderRadius: '50%', padding: '$space2', aspectRatio: '1' },
	// A button that sits inside a line of text and takes no room of its own.
	button_inline: {
		background: 'transparent',
		border: 'none',
		padding: 0,
		minHeight: 0,
		color: '$link',
		textDecoration: 'underline',
	},
	// The one of a run that is showing now: the page a `Pagination` is on (design 201). A modifier
	// and not a part, because it is the same button as the ones beside it, and `current` is the name
	// of no entry, which is what design 193's rule asks of a segment.
	button_current: { background: '$accent', color: '$accentForeground', borderColor: '$accent' },

	input: {
		display: 'block',
		boxSizing: 'border-box',
		width: '100%',
		height: '$control',
		minHeight: '$control',
		padding: '$space $space3',
		border: '$borderWidth solid $input',
		borderRadius: '$radius',
		background: '$surface',
		color: '$surfaceForeground',
		boxShadow: '$shadowSm',
		fontFamily: '$font',
		fontSize: '$textSm',
		lineHeight: '$textSmLine',
		_cssProp_placeholder: { color: '$mutedForeground' },
	},
	input_sm: {
		height: '$controlSm',
		minHeight: '$controlSm',
		padding: '$space $space2',
		fontSize: '$textXs',
		lineHeight: '$textXsLine',
	},
	input_lg: { height: '$controlLg', minHeight: '$controlLg', padding: '$space $space4' },
	input_invalid: { borderColor: '$danger' },

	// A text field with something beside it inside the same box (designs 200, 210). The parts belong
	// to `input` now, because the box is what a `TextField` given a `leading` or a `trailing` builds
	// rather than an entry of its own. The box is the control,
	// so it takes the whole `input` look through `extends` and the element inside it takes none of
	// it. Each size restates the horizontal padding for the reason `select_sm` does: the `input_sm`
	// that `extends` pulls in sits after this entry in the chain and its `padding` shorthand would
	// otherwise take the box's own back.
	input_group: {
		extends: 'input',
		display: 'flex',
		alignItems: 'center',
		gap: '$space2',
		padding: '0 $space3',
		overflow: 'hidden',
		// The ring belongs to the box, because a person sees one control. `pseudo()` writes `has(`
		// as `:has(`, so this is the same spelling the button's icon padding rules use.
		'_cssProp_has(:focus-visible)': {
			borderColor: '$ring',
			boxShadow: '0 0 0 $ringWidth color-mix(in srgb, $ring 50%, transparent)',
		},
	},
	input_group_sm: { extends: 'input_sm', padding: '0 $space2' },
	input_group_lg: { extends: 'input_lg', padding: '0 $space4' },
	input_group_invalid: { borderColor: '$danger' },
	input_group_control: {
		appearance: 'none',
		flex: '1 1 auto',
		minWidth: 0,
		height: '100%',
		padding: 0,
		border: 'none',
		borderRadius: 0,
		background: 'transparent',
		color: 'inherit',
		fontFamily: '$font',
		fontSize: 'inherit',
		lineHeight: 'inherit',
		// The halo the root entry gives every themed element, turned off here so the box shows it
		// instead. The outline is already off from there and is not said again, because an entry
		// that turns one off has to name `$ring` and this one has no ring to name.
		'_cssProp_focus-visible': { borderColor: 'transparent', boxShadow: 'none' },
		_cssProp_placeholder: { color: '$mutedForeground' },
	},
	input_group_addon: {
		display: 'flex',
		alignItems: 'center',
		flexShrink: 0,
		color: '$mutedForeground',
		fontFamily: '$font',
		fontSize: 'inherit',
		lineHeight: 'inherit',
		whiteSpace: 'nowrap',
	},

	// A textarea is an input that grows. `resize: none` because the component sets the height
	// itself, and a handle that fights it is a handle that loses on the next keystroke.
	textarea: {
		$textAreaMax: '16rem',
		resize: 'none',
		overflowY: 'auto',
		// A text area is sized by what is in it, so it takes back the fixed height `input` sets
		// and keeps a minimum of its own.
		height: 'auto',
		padding: '$space2 $space3',
		minHeight: '$space12',
		maxHeight: '$textAreaMax',
	},

	// A tick box drawn here rather than by the host (design 195). `accent-color` was one line and
	// gave every host a different box: a different size, a different corner, a different tick, and
	// no say over any of it. The host is told not to draw one, and the box, the tick and the bar
	// are three rules. The box is a centring grid so the mark is its one child and needs no offsets.
	checkbox: {
		$box: '16px',
		$tickWidth: '4px',
		$tickHeight: '8px',
		$tickStroke: '2px',
		appearance: 'none',
		boxSizing: 'border-box',
		display: 'inline-grid',
		placeContent: 'center',
		width: '$box',
		height: '$box',
		margin: 0,
		flexShrink: 0,
		border: '$borderWidth solid $input',
		borderRadius: '$radiusSm',
		background: '$background',
		cursor: 'pointer',
		_cssProp_checked: { background: '$accent', borderColor: '$accent' },
		// Two sides of an empty box, turned a quarter turn: the corner that is left is the tick.
		// Nudged up by the stroke, because turning a rectangle about its centre leaves the long
		// arm's end lower than the eye reads as centred.
		'_cssProp_:checked::before': {
			content: '\'\'',
			width: '$tickWidth',
			height: '$tickHeight',
			marginTop: '-$tickStroke',
			borderRight: '$tickStroke solid $accentForeground',
			borderBottom: '$tickStroke solid $accentForeground',
			transform: 'rotate(45deg)',
		},
		// Neither ticked nor clear is one bar across the middle.
		'_cssProp_:indeterminate::before': {
			content: '\'\'',
			width: '$tickHeight',
			height: '$tickStroke',
			borderRadius: '$tickStroke',
			background: '$accentForeground',
		},
	},
	// The mark follows the box. The three tick names are redefined per size the way `$dot` is on a
	// radio: the turned mark's bounding box is (width + stroke + height + stroke) / root two, so
	// leaving them fixed drew one 11.31px mark in a 12px inner box and in an 18px one.
	checkbox_sm: { $box: '14px', $tickWidth: '3px', $tickHeight: '6px', $tickStroke: '2px' },
	checkbox_lg: { $box: '20px', $tickWidth: '5px', $tickHeight: '10px', $tickStroke: '3px' },

	// The same box as a circle, with a dot in the middle of it instead of a tick. The tick's two
	// borders and its turn are taken back by name, because `extends` merges rather than replaces.
	radio: {
		extends: 'checkbox',
		$dot: '8px',
		borderRadius: '50%',
		'_cssProp_:checked::before': {
			width: '$dot',
			height: '$dot',
			marginTop: 0,
			border: 'none',
			borderRadius: '50%',
			background: '$accentForeground',
			transform: 'none',
		},
	},
	radio_sm: { extends: 'checkbox_sm', $dot: '7px' },
	radio_lg: { extends: 'checkbox_lg', $dot: '10px' },

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
	// The pill and its thumb scale by their three names alone: the entry above reads them out of
	// whichever entry in the chain last defined them (design 111), so a size is three values and
	// no second copy of the rules that use them.
	toggle_sm: { $switchWidth: '32px', $switchHeight: '20px', $switchThumb: '14px' },
	toggle_lg: { $switchWidth: '48px', $switchHeight: '28px', $switchThumb: '22px' },

	// A range input is drawn out of two vendor pseudo-elements, which are spelled with their own
	// colons because they are not in this package's pseudo-element table.
	slider: {
		$trackHeight: '6px',
		$thumbSize: '16px',
		appearance: 'none',
		width: '100%',
		height: '$control',
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
	// The hit area, the track and the thumb, the last two by name alone.
	slider_sm: { $trackHeight: '4px', $thumbSize: '14px', height: '$controlSm' },
	slider_lg: { $trackHeight: '8px', $thumbSize: '20px', height: '$controlLg' },

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
		minHeight: '$control',
	},
	// The same row, taken at a width rather than declared (design 196). The container is the nearest
	// ancestor that declares one, which is `field_group` and nothing else here, so a responsive
	// field with no group above it stays a column: a query with no container answers false.
	field_responsive: {
		'_container_(min-width: 28rem)': {
			flexDirection: 'row',
			alignItems: 'center',
			flexWrap: 'wrap',
			gap: '$space2',
			minHeight: '$control',
		},
	},

	// The stack a form is, and a run of fields under a heading. Parts, so each is one class token
	// (design 193). A fieldset arrives from the host with a border, three uneven paddings and a
	// minimum width that stops it shrinking in a column, so all four are taken off by name.
	field_group: {
		display: 'flex',
		flexDirection: 'column',
		gap: '$space6',
		width: '100%',
		containerType: 'inline-size',
	},
	field_set: {
		display: 'flex',
		flexDirection: 'column',
		gap: '$space6',
		width: '100%',
		border: 'none',
		padding: 0,
		margin: 0,
		minWidth: 0,
	},
	field_legend: {
		fontFamily: '$font',
		fontSize: '$textSm',
		lineHeight: '$textSmLine',
		fontWeight: 500,
		marginBottom: '$space2',
		padding: 0,
	},

	// Three parts of a field, reached as one class token each (design 193): `field_label` in a class
	// list names this entry and no longer also matches the bare `field`, so the label stops taking
	// the field's own column layout and its full width.
	field_label: {
		fontFamily: '$font',
		fontSize: '$textSm',
		lineHeight: '$textSmLine',
		fontWeight: 500,
		color: '$foreground',
		// A `Field` marks itself while a control inside it has something wrong (design 196), and the
		// label under it takes the colour its message already has. The rule is written from the
		// label rather than from the field because a part's class is generated per chain, so
		// `field`'s rules cannot name this one's.
		'_elem_[data-invalid]': { color: '$dangerSubtleForeground' },
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

	// A select is an input that opens, and unlike an input it lays out children of its own: the
	// value it is showing and the arrow. As a block those stack (design 192).
	//
	// The appearance is said twice (design 195): `none` first, so every host stops drawing its own
	// arrow, then `base-select`, which Chromium 135 and later takes and which is what lets the open
	// list, the option rows and the picker be themed. A host that does not know the second keyword
	// drops that declaration and keeps `none`. The arrow the closed control shows is drawn here, the
	// way the tick and the dot are, so it is the same mark everywhere and the host's is hidden where
	// there is one.
	select: {
		extends: 'input',
		appearance: ['none', 'base-select'],
		display: 'inline-flex',
		alignItems: 'center',
		width: '100%',
		paddingRight: '$space8',
		cursor: 'pointer',
		'_cssProp_::picker-icon': { display: 'none' },
		'_cssProp_::picker(select)': {
			background: '$surface',
			color: '$surfaceForeground',
			border: '$borderWidth solid $border',
			borderRadius: '$radius',
			padding: '$space',
		},
	},
	// The room for the chevron is said again in each size: a modifier of `select` does not extend
	// the modifier of `input` on its own, and the `input_sm` that `extends` pulls in sits after
	// `select` in the chain, so its `padding` shorthand would otherwise take the room back.
	select_sm: { extends: 'input_sm', paddingRight: '$space8' },
	select_lg: { extends: 'input_lg', paddingRight: '$space8' },

	// The box the component puts around the element so the chevron has something to be absolute
	// against, and the chevron itself. Parts, so each is one class token (design 193).
	//
	// The chevron is the tick's trick again: an empty box `$chevron` square with two of its four
	// sides drawn, turned a quarter turn, so the corner that is left points down. It takes no
	// pointer events, so a click on it reaches the element under it.
	select_wrap: { position: 'relative', display: 'block', width: '100%' },
	select_chevron: {
		position: 'absolute',
		right: '$space3',
		top: '50%',
		boxSizing: 'border-box',
		width: '$chevron',
		height: '$chevron',
		borderRight: '$borderWidth solid $mutedForeground',
		borderBottom: '$borderWidth solid $mutedForeground',
		transform: 'translateY(-50%) rotate(45deg)',
		pointerEvents: 'none',
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

	// A card with parts in it (design 200). The column is a modifier rather than a change to `card`,
	// so a card with no parts is the bare block it always was and only one with parts stacks.
	card_stack: { display: 'flex', flexDirection: 'column', gap: '$space4' },
	card_head: { display: 'flex', flexDirection: 'column', gap: '$space' },
	card_title: {
		fontFamily: '$font',
		fontSize: '$textLg',
		lineHeight: '$textLgLine',
		fontWeight: 600,
		margin: 0,
	},
	card_description: {
		fontFamily: '$font',
		fontSize: '$textSm',
		lineHeight: '$textSmLine',
		color: '$mutedForeground',
		margin: 0,
	},
	card_body: { display: 'flex', flexDirection: 'column', gap: '$space2' },
	card_foot: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '$space2' },

	// It arrives from nothing and does not leave that way: what hides a popup is `display: none`
	// written on the box the sink places, which is above this element and outside any theme.
	popup: {
		background: '$surface',
		color: '$surfaceForeground',
		border: '$borderWidth solid $border',
		borderRadius: '$radius',
		padding: '$space2',
		'_media_(prefers-reduced-motion: no-preference)': {
			transition: 'opacity $fast $ease, transform $fast $ease',
		},
		_starting_: { opacity: 0, transform: 'scale(0.96)' },
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
		// The scrim fades with the dialog. Its starting style is inside the pseudo block, which is
		// what one level of nesting buys (design 190, amended): the transition has to reach
		// `.awN::backdrop`, and it has to stay inside the reduced-motion query.
		'_cssProp_::backdrop': {
			background: '$scrim',
			opacity: 1,
			_starting_: { opacity: 0 },
		},
		'_cssProp_:not([open])::backdrop': { opacity: 0 },

		// It arrives from nothing and leaves the same way (design 192). `display` and `overlay`
		// hold their old values for the length of the transition, which is what lets a dialog that
		// is no longer `[open]` still be on the screen while it goes.
		'_media_(prefers-reduced-motion: no-preference)': {
			transition: 'opacity $fast $ease, transform $fast $ease,'
				+ ' display $fast allow-discrete, overlay $fast allow-discrete',
			'_cssProp_::backdrop': {
				transition: 'opacity $fast $ease,'
					+ ' display $fast allow-discrete, overlay $fast allow-discrete',
			},
		},
		// Outside the query on purpose: a starting style is only ever read by a transition, so with
		// no transition there is nothing to start from and the dialog is solid in its first frame.
		_starting_: { opacity: 0, transform: 'scale(0.96)' },
		'_cssProp_:not([open])': { opacity: 0, transform: 'scale(0.96)' },
	},
	dialog_head: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: '$space2',
		marginBottom: '$space2',
	},
	dialog_body: { display: 'flex', flexDirection: 'column', gap: '$space2' },

	// The same dialog against an edge (design 202). A modal `<dialog>` is centred by the host with
	// `margin: auto`, so zeroing the margins and leaving one side `auto` is what anchors it, and the
	// transform stays free for the motion. The border and the corner are the inner edge only.
	dialog_sheet: {
		// The width is the width: a dialog is content-box from the host, so `$sheetWidth` plus the
		// padding and the border came to 417px, and the slide, which is `translateX(100%)`, moved it
		// by that instead of by 24rem. Measured in Chromium.
		boxSizing: 'border-box',
		width: '$sheetWidth',
		maxWidth: '100%',
		height: '100%',
		maxHeight: '100%',
		margin: 0,
		border: 'none',
		borderRadius: 0,
	},
	// Each side says where it sits, which edge it is drawn on, and what it slides from. The
	// translate replaces the scale the base entry starts from; it is written as a `transform`
	// because that is the property `dialog`'s transition already names.
	dialog_sheet_right: {
		marginLeft: 'auto',
		borderLeft: '$borderWidth solid $border',
		borderRadius: '$radiusLg 0 0 $radiusLg',
		_starting_: { transform: 'translateX(100%)' },
		'_cssProp_:not([open])': { transform: 'translateX(100%)' },
	},
	dialog_sheet_left: {
		marginRight: 'auto',
		borderRight: '$borderWidth solid $border',
		borderRadius: '0 $radiusLg $radiusLg 0',
		_starting_: { transform: 'translateX(-100%)' },
		'_cssProp_:not([open])': { transform: 'translateX(-100%)' },
	},
	dialog_sheet_top: {
		width: '100%',
		height: 'auto',
		marginBottom: 'auto',
		borderBottom: '$borderWidth solid $border',
		borderRadius: '0 0 $radiusLg $radiusLg',
		_starting_: { transform: 'translateY(-100%)' },
		'_cssProp_:not([open])': { transform: 'translateY(-100%)' },
	},
	dialog_sheet_bottom: {
		width: '100%',
		height: 'auto',
		marginTop: 'auto',
		borderTop: '$borderWidth solid $border',
		borderRadius: '$radiusLg $radiusLg 0 0',
		_starting_: { transform: 'translateY(100%)' },
		'_cssProp_:not([open])': { transform: 'translateY(100%)' },
	},

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
		'_media_(prefers-reduced-motion: no-preference)': {
			transition: 'opacity $fast $ease, transform $fast $ease',
		},
		_starting_: { opacity: 0, transform: 'scale(0.96)' },
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
	filedrop_picker: { extends: 'offscreen' },
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
	// A modifier of the track, not of the picker: the class list says `colorpicker_track` as one
	// token, so an entry that starts `colorpicker_` and then says something else reaches nothing
	// (design 193).
	colorpicker_track_hue: {
		$hue0: 'hsl(0, 100%, 50%)',
		$hue60: 'hsl(60, 100%, 50%)',
		$hue120: 'hsl(120, 100%, 50%)',
		$hue180: 'hsl(180, 100%, 50%)',
		$hue240: 'hsl(240, 100%, 50%)',
		$hue300: 'hsl(300, 100%, 50%)',
		background: 'linear-gradient(to right, $hue0, $hue60, $hue120, $hue180, $hue240, $hue300, $hue0)',
	},

	// --- the display pieces (design 199) ---------------------------------------------------------
	//
	// Seven things a page shows and nobody operates. Each paints its own text, because the root
	// entry paints none (design 198), and each size is a segment after `type` (design 194).

	// A badge is not a control, so its size axis is padding and text rather than `$control`: three
	// of them down a column of a table would otherwise be three 36px blocks.
	badge: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '$space',
		boxSizing: 'border-box',
		padding: '$space $space2',
		border: '$borderWidth solid transparent',
		borderRadius: '$radius',
		background: '$accent',
		color: '$accentForeground',
		fontFamily: '$font',
		fontSize: '$textXs',
		lineHeight: '$textXsLine',
		fontWeight: 500,
		whiteSpace: 'nowrap',
	},
	badge_quiet: { background: '$muted', color: '$mutedForeground' },
	badge_danger: { background: '$danger', color: '$dangerForeground' },
	badge_outline: { background: 'transparent', borderColor: '$border', color: '$foreground' },
	badge_sm: { padding: '0 $space' },
	badge_lg: { padding: '$space $space3', fontSize: '$textSm', lineHeight: '$textSmLine' },

	// A message about the page. One column, and two when it was given an icon: an empty first track
	// is zero wide but the gap beside it is not, so an alert with no icon would carry the indent of
	// one. The title and the body place themselves, so either alone lays out with no second rule.
	alert: {
		display: 'grid',
		gridTemplateColumns: '1fr',
		columnGap: '$space3',
		rowGap: '$space',
		boxSizing: 'border-box',
		padding: '$space3 $space4',
		border: '$borderWidth solid $border',
		borderRadius: '$radius',
		background: '$surface',
		color: '$surfaceForeground',
		fontFamily: '$font',
		fontSize: '$textSm',
		lineHeight: '$textSmLine',
	},
	alert_lead: { gridTemplateColumns: 'auto 1fr' },
	alert_danger: {
		background: '$dangerSubtle',
		color: '$dangerSubtleForeground',
		borderColor: '$danger',
	},
	// The part is `symbol` and not `icon`, because `icon` is an entry of this theme and no segment
	// may name one (design 193, amended). It spans both rows so the title and the body place
	// themselves in the second column rather than wrapping under it.
	alert_symbol: {
		gridColumn: 1,
		gridRow: '1 / span 2',
		display: 'flex',
		alignItems: 'center',
		minHeight: '$textSmLine',
	},
	alert_title: { fontWeight: 600 },
	alert_body: { color: '$mutedForeground' },

	// A picture of a person, and the letters shown while it is not there. Both children stay in the
	// tree and one of them carries `hidden`, which also takes it out of the accessibility tree; each
	// part declares a `display` of its own, so the host's `[hidden]` rule loses and this says it.
	avatar: {
		boxSizing: 'border-box',
		position: 'relative',
		display: 'inline-block',
		flexShrink: 0,
		overflow: 'hidden',
		width: '$control',
		height: '$control',
		borderRadius: '$radius',
	},
	avatar_sm: { width: '$controlSm', height: '$controlSm' },
	avatar_lg: { width: '$controlLg', height: '$controlLg' },
	avatar_round: { borderRadius: '50%' },
	avatar_image: {
		display: 'block',
		width: '100%',
		height: '100%',
		objectFit: 'cover',
		'_cssProp_:is([hidden])': { display: 'none' },
	},
	avatar_fallback: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		width: '100%',
		height: '100%',
		background: '$muted',
		color: '$mutedForeground',
		fontFamily: '$font',
		fontSize: '$textXs',
		lineHeight: '$textXsLine',
		fontWeight: 500,
		userSelect: 'none',
		'_cssProp_:is([hidden])': { display: 'none' },
	},

	// The pulse, defined once and reached by both the dots and a skeleton (design 199). A keyframes
	// block is named after the entry that owns it (design 111), so one entry is one `@keyframes` in
	// the sheet however many chains reach it.
	pulse: {
		_keyframes_pulse: '0%, 80%, 100% { opacity: 0.35 } 40% { opacity: 1 }',
		'_media_(prefers-reduced-motion: no-preference)': { animation: '$pulse $slow infinite' },
	},

	// A grey box standing in for something that has not arrived. It says nothing to a screen reader:
	// the thing that is loading says that, and three boxes saying it three times is worse.
	skeleton: {
		extends: 'pulse',
		display: 'block',
		width: '100%',
		height: '$textMdLine',
		borderRadius: '$radiusSm',
		background: '$muted',
	},
	skeleton_round: { borderRadius: '50%' },

	// A bar filling up, drawn out of the three vendor pseudo-elements the way `slider` draws its
	// track and thumb. They are spelled with their own colons because they are not in this package's
	// pseudo-element table.
	progress: {
		appearance: 'none',
		display: 'block',
		boxSizing: 'border-box',
		width: '100%',
		height: '$space2',
		border: 'none',
		borderRadius: '$radius',
		overflow: 'hidden',
		background: '$muted',
		color: '$accent',
		'_cssProp_::-webkit-progress-bar': { background: '$muted' },
		'_cssProp_::-webkit-progress-value': { background: '$accent' },
		'_cssProp_::-moz-progress-bar': { background: '$accent' },
	},
	progress_sm: { height: '$space' },
	progress_lg: { height: '$space3' },

	// Nothing here yet, and what to do about it. The part is `symbol` for the reason `alert_symbol`
	// is; it is sized in text, so the icon inside it, which is `1em`, follows.
	empty: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '$space2',
		padding: '$space6',
		textAlign: 'center',
		fontFamily: '$font',
	},
	empty_symbol: { color: '$mutedForeground', fontSize: '$text2xl', lineHeight: '$text2xlLine' },
	empty_title: {
		fontFamily: '$font',
		fontSize: '$textLg',
		lineHeight: '$textLgLine',
		fontWeight: 600,
		color: '$foreground',
		margin: 0,
	},
	empty_description: {
		fontFamily: '$font',
		fontSize: '$textSm',
		lineHeight: '$textSmLine',
		color: '$mutedForeground',
		margin: 0,
	},
	empty_actions: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		flexWrap: 'wrap',
		gap: '$space2',
		marginTop: '$space2',
	},

	// --- the table and the navigation pieces (design 201) ----------------------------------------

	// The box a wide table scrolls inside, so the page does not. It is focusable in the component,
	// because a box that scrolls and cannot be focused is unreachable from a keyboard.
	table_scroll: { display: 'block', width: '100%', overflowX: 'auto' },

	// Collapsed borders, so a row's line and the head's line are one edge rather than two.
	table: {
		width: '100%',
		borderCollapse: 'collapse',
		fontFamily: '$font',
		fontSize: '$textSm',
		lineHeight: '$textSmLine',
		color: '$foreground',
	},
	// Which rows, rather than what a row looks like, so it is a rule about children (design 201).
	table_striped: { '_children_tbody > tr:nth-child(even)': { background: '$muted' } },
	table_caption: {
		captionSide: 'bottom',
		padding: '$space2 $space3',
		textAlign: 'left',
		color: '$mutedForeground',
		fontSize: '$textXs',
		lineHeight: '$textXsLine',
	},
	// The head draws the line under itself; every body row draws the line under itself. So a
	// hand-written table gets the same rules from the same names whichever of the two it themes.
	table_head: { borderBottom: '$borderWidth solid $border' },
	// The row's part is `line` and not `row`, because `row` is an entry of this theme that lays an
	// element out and no segment may name one (design 193, amended).
	table_line: { borderBottom: '$borderWidth solid $border' },
	table_heading: {
		padding: '$space2 $space3',
		textAlign: 'left',
		fontWeight: 500,
		color: '$mutedForeground',
		whiteSpace: 'nowrap',
	},
	table_cell: { padding: '$space2 $space3', textAlign: 'left', verticalAlign: 'middle' },
	// A column lines up its heading and its cells the same way, and a heading is a different element
	// from a cell, so the alignment is a modifier of each of the two rather than one entry both
	// reach: a class list holding `table_heading` reaches no key that starts `table_cell`.
	table_cell_right: { textAlign: 'right' },
	table_cell_center: { textAlign: 'center' },
	table_heading_right: { textAlign: 'right' },
	table_heading_center: { textAlign: 'center' },
	// A dense table. The segment goes on the cells and not on the table, because a class list is
	// written by the element that wears it and a table cannot reach its own cells (design 200).
	table_heading_tight: { padding: '$space $space2' },
	table_cell_tight: { padding: '$space $space2' },
	table_foot: { borderTop: '$borderWidth solid $border', fontWeight: 500 },

	// Where a person is, one level at a time. The separator is drawn here rather than asked for by
	// name, the way the select's arrow is (design 195), so a breadcrumb renders with no icon pack.
	breadcrumb: { fontFamily: '$font', fontSize: '$textSm', lineHeight: '$textSmLine' },
	breadcrumb_list: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: '$space2',
		listStyle: 'none',
		margin: 0,
		padding: 0,
	},
	breadcrumb_item: { display: 'flex', alignItems: 'center', gap: '$space2' },
	breadcrumb_link: {
		color: '$mutedForeground',
		textDecoration: 'none',
		borderRadius: '$radiusSm',
		_cssProp_hover: { color: '$foreground', textDecoration: 'underline' },
	},
	breadcrumb_current: { color: '$foreground', fontWeight: 500 },
	// The select's chevron turned the other way: two sides of an empty box, a quarter turn back, so
	// the corner that is left points along the row instead of down.
	breadcrumb_separator: {
		boxSizing: 'border-box',
		flexShrink: 0,
		width: '$chevron',
		height: '$chevron',
		borderRight: '$borderWidth solid $mutedForeground',
		borderBottom: '$borderWidth solid $mutedForeground',
		transform: 'rotate(-45deg)',
	},

	// A run of page buttons. The buttons are `Button`s, so the only thing here is the row and the
	// ellipsis; the page showing now is `button_current` above.
	pagination: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '$space' },
	pagination_gap: {
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		minWidth: '$target',
		color: '$mutedForeground',
		fontFamily: '$font',
		fontSize: '$textSm',
		lineHeight: '$textSmLine',
	},

	// One set of panels with one showing, and the strip that picks between them (design 203). The
	// strip is a box of its own inside the component's box, so the two are separate entries: the
	// component stacks the strip and the panels, and the strip lays the tabs out.
	tabs: { display: 'flex', flexDirection: 'column', gap: '$space3' },
	// A strip that stands on its side stands beside what it is showing. Without this the panel
	// would sit under a column of tabs and take the whole width, which is a stack of headings and
	// not a set of tabs.
	tabs_vertical: { flexDirection: 'row', alignItems: 'flex-start', gap: '$space4' },
	tabs_list: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '$space',
		padding: '$space',
		background: '$muted',
		borderRadius: '$radius',
	},
	tabs_list_vertical: { flexDirection: 'column', alignItems: 'stretch' },
	// The other type: no strip at all, one hairline the whole row stands on, and the tab showing
	// draws its own line over that one.
	tabs_list_line: {
		gap: '$space4',
		padding: 0,
		background: 'transparent',
		borderRadius: 0,
		borderBottom: '$borderWidth solid $border',
	},
	tabs_panel: { flexGrow: 1, minWidth: 0 },
	tab: {
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '$space2',
		// A tab is a control and is the height every control is, whatever the host's own box model
		// says about a `<button>`.
		boxSizing: 'border-box',
		minHeight: '$control',
		padding: '$space $space3',
		border: '$borderWidth solid transparent',
		borderRadius: '$radiusSm',
		background: 'transparent',
		color: '$mutedForeground',
		fontFamily: '$font',
		fontSize: '$textSm',
		lineHeight: '$textSmLine',
		fontWeight: 500,
		whiteSpace: 'nowrap',
		cursor: 'pointer',
	},
	// The size axis, one segment after the type (design 194).
	tab_sm: {
		minHeight: '$controlSm',
		padding: '$space $space2',
		fontSize: '$textXs',
		lineHeight: '$textXsLine',
	},
	tab_lg: { minHeight: '$controlLg' },
	// The one showing is lifted out of the strip: the page's own ground under it, the page's own
	// text on it, and the hairline every raised surface in this theme carries.
	tab_selected: { background: '$background', color: '$foreground', boxShadow: '$shadowSm' },
	// The line type: no box of its own, and a rail under the tab instead of a fill behind it.
	tab_line: {
		padding: '$space $space2',
		background: 'transparent',
		boxShadow: 'none',
		borderRadius: 0,
		borderBottom: '$ringWidth solid transparent',
		// The strip's own hairline is under this one, so the tab's line covers it rather than
		// sitting a pixel above it.
		marginBottom: '-$borderWidth',
	},
	// The lift is taken back off here rather than in `tab_line`, because a chain is ordered by how
	// far along the class list each entry matched and not by the order the entries are written in:
	// `['tab', 'line', 'selected']` matches `tab_line` at the second segment and `tab_selected` at
	// the third, so `tab_selected` is emitted last of the two and its fill would win. Measured
	// before this moved: an underlined tab was raised as well.
	tab_line_selected: { background: 'transparent', boxShadow: 'none', borderBottomColor: '$accent' },

	text: {
		fontFamily: '$font',
		fontSize: '$textMd',
		lineHeight: '$textMdLine',
		color: '$foreground',
		margin: 0,
		// A newline in a label is a line break on the page (design 182). A page that wants the
		// other behaviour writes `normal` on its own entry.
		whiteSpace: 'pre-wrap',
	},
	text_xs: { fontSize: '$textXs', lineHeight: '$textXsLine' },
	text_sm: { fontSize: '$textSm', lineHeight: '$textSmLine' },
	text_lg: { fontSize: '$textLg', lineHeight: '$textLgLine' },
	text_xl: { fontSize: '$textXl', lineHeight: '$textXlLine' },
	text_2xl: { fontSize: '$text2xl', lineHeight: '$text2xlLine' },
	text_3xl: { fontSize: '$text3xl', lineHeight: '$text3xlLine' },
	text_4xl: { fontSize: '$text4xl', lineHeight: '$text4xlLine' },
	text_mono: { fontFamily: '$fontMono' },

	// The six headings, on the six steps from the top down, all at one weight. `balance` evens the
	// lines of a short block and the browser stops applying it past a handful, which is why it is
	// here and not on a paragraph. No maximum width anywhere: a measure is the page's (design 182).
	text_h1: { fontSize: '$text4xl', lineHeight: '$text4xlLine', fontWeight: 600, textWrap: 'balance' },
	text_h2: { fontSize: '$text3xl', lineHeight: '$text3xlLine', fontWeight: 600, textWrap: 'balance' },
	text_h3: { fontSize: '$text2xl', lineHeight: '$text2xlLine', fontWeight: 600, textWrap: 'balance' },
	text_h4: { fontSize: '$textXl', lineHeight: '$textXlLine', fontWeight: 600, textWrap: 'balance' },
	text_h5: { fontSize: '$textLg', lineHeight: '$textLgLine', fontWeight: 600, textWrap: 'balance' },
	text_h6: { fontSize: '$textMd', lineHeight: '$textMdLine', fontWeight: 600, textWrap: 'balance' },

	text_p1: { fontSize: '$textMd', lineHeight: '$textMdLine', textWrap: 'pretty' },
	text_p2: { fontSize: '$textSm', lineHeight: '$textSmLine', textWrap: 'pretty' },

	text_bold: { fontWeight: 600 },
	text_regular: { fontWeight: 400 },
	text_italic: { fontStyle: 'italic' },
	text_center: { textAlign: 'center' },
	text_inline: { display: 'inline' },

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
	// the person wants any (design 118), so reduced motion leaves three still dots. The keyframes
	// and the animation are the `pulse` entry above, which a skeleton also extends (design 199).
	dots: { display: 'inline-flex', alignItems: 'center', gap: '$space' },
	dot: {
		extends: 'pulse',
		$dotSize: '6px',
		display: 'inline-block',
		width: '$dotSize',
		height: '$dotSize',
		borderRadius: '50%',
		background: 'currentColor',
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
