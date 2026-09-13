// Picking a colour on a square and two sliders (design 222).
//
// The square is the one thing in this package drawn out of an element of its own: saturation and
// brightness are one place rather than two numbers, and the platform has no element for two axes.
// The pointer and the key map under it are `drag.ts` (design 221); the hue and the opacity are
// `Slider`, which is the platform's range input (design 128). The maths is `color.ts`.

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { Slider } from './slider.tsx';
import { assert } from './assert.ts';
import { controlStates, elementFor } from './control.ts';
import { drag } from './drag.ts';
import { fromHsv, hsvOf, readColour, writeColour } from './color.ts';
import { h } from './h.ts';
import { text } from './text.ts';
import { isWritable, through } from './source.ts';

/** What `ColorPicker` takes. Everything not named here goes to the wrapper. */
export interface ColorPickerProps {
	/** The colour, as CSS text, a cell. Absent, the component keeps its own. */
	readonly value?: unknown;
	/** Show the opacity slider. True unless it is set false. */
	readonly hasAlpha?: unknown;
	/** A value or a cell. */
	readonly disabled?: unknown;
	/** The theme variant. */
	readonly type?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/** Where the picker starts when the component keeps its own colour: a full red. */
const START = { h: 0, s: 1, v: 1, a: 1 };

/**
 * A colour, picked on a square and two sliders.
 *
 * Params:
 *   props: `value`, `hasAlpha`, `disabled`, `type`, `element`, and anything else, which goes to the
 *          wrapper
 *
 * Returns: a `<div>` holding a swatch, a saturation and brightness square with a thumb in it, and
 * one or two `Slider`s: hue, and opacity when `hasAlpha` is not false. Each slider is labelled, so
 * each is found by name and announces its number; the swatch is `aria-hidden`, because it says what
 * the rest already say.
 *
 * The square's thumb is `role="slider"`, focusable, and carries both axes: `aria-valuenow` is the
 * saturation and `aria-valuetext` reads "saturation 40%, brightness 80%". There is no two-axis role
 * in ARIA and one control that says both beats two a person has to switch between (design 222).
 * Left and right move saturation, up and down move brightness, Home and End take saturation to its
 * ends, and Shift makes any of them coarse. A press anywhere in the square moves the thumb there.
 *
 * The cell holds CSS colour text, anything `readColour` reads, and is written back as `rgb()` or
 * `rgba()`. A drag, a key or a slider writes it, and nothing else does: mounting this on a colour
 * leaves that colour alone. Writing the cell from outside moves the thumb and the sliders.
 *
 * With `hasAlpha` false there is no opacity slider, and a write keeps the alpha the cell already
 * had rather than making the colour opaque.
 *
 * Throws: an assert, loud in development and stripped in a release build, for text that is not a
 * colour this package can read, naming the text.
 *
 * Example:
 *   <ColorPicker value={picked} hasAlpha={false} />
 */
export const ColorPicker = (
	props: ColorPickerProps,
	cleanup: (...fns: (() => void)[]) => void,
): Mounter => (elem, _item, before, context) => {
	const { value, hasAlpha, disabled, type, element, theme, ...rest } = props;

	const alphaOn = hasAlpha !== false;
	// A state prop is a cell or absent. A plain value looks as though it was honoured and is not,
	// so it is a loud assert rather than a silent fallback, as `Validate`'s `value` already was.
	assert(value === undefined || isWritable(value),
		'ColorPicker value takes a cell, not a value; pass value={cell}, or leave it out and the '
		+ 'component keeps its own');
	const cell = isWritable(value)
		? value
		: mutable(writeColour(fromHsv(START.h, START.s, START.v, START.a)));

	const hue = mutable(START.h);
	const saturation = mutable(START.s * 100);
	const brightness = mutable(START.v * 100);
	const opacity = mutable(START.a * 100);

	const swatch = mutable('');
	const opacityTrack = mutable('');
	// The square's own three: the hue it is drawn over, the colour its thumb shows, and the one
	// string a screen reader hears for two axes.
	const planeBase = mutable('');
	const thumbFill = mutable('');
	const valueText = mutable('');

	// The thumb answers hover and press itself, so its two cells are the component's rather than a
	// caller's: nothing outside this file has a thumb to point at.
	const states = controlStates(disabled);

	// The plane's gradients are the theme's, so what is computed here is the hue underneath them
	// and the colour that is chosen now, neither of which exists until run time (design 222). The
	// opacity track is the same trick design 139 already used.
	const paint = (): void => {
		const at = hue.get();
		const s = saturation.get() / 100;
		const v = brightness.get() / 100;
		const a = alphaOn ? opacity.get() / 100 : alpha;
		opacityTrack.set(`linear-gradient(to right, ${writeColour(fromHsv(at, s, v, 0))}, ${writeColour(fromHsv(at, s, v, 1))})`);
		planeBase.set(writeColour(fromHsv(at, 1, 1, 1)));
		thumbFill.set(writeColour(fromHsv(at, s, v, 1)));
		swatch.set(writeColour(fromHsv(at, s, v, a)));
		valueText.set(`saturation ${String(saturation.get())}%, brightness ${String(brightness.get())}%`);
	};

	// The text the cell and the controls last agreed on. A flag would not do: a delivery is deferred
	// to a safe point, so by the time the cell reports what this component wrote, the write has long
	// finished. Comparing the text is what stops a control being set back from the value it just
	// produced, which is how a colour with no hue of its own would snap to red.
	let agreed = '';

	// The alpha the cell arrived with. With the opacity slider off there is nothing on the screen
	// that can change it, so a write keeps what the caller had rather than making it opaque.
	let alpha = START.a;

	const takeIn = (held: unknown): void => {
		const text = held === null || held === undefined ? '' : String(held);
		const colour = readColour(text);
		assert(colour !== null,
			`ColorPicker cannot read ${JSON.stringify(text)} as a colour; give it a hex, an rgb(), `
			+ 'an hsl(), or one of the CSS colour names');
		if (colour === null) return;
		agreed = text;
		alpha = colour.a;
		const hsv = hsvOf(colour);
		hue.set(Math.round(hsv.h));
		saturation.set(Math.round(hsv.s * 100));
		brightness.set(Math.round(hsv.v * 100));
		opacity.set(Math.round(colour.a * 100));
		paint();
	};

	// Called from a slider's own `input`, from the drag, and from nowhere else. Hung off the cells'
	// effects it also ran once as the component mounted, and that first run moved the caller's
	// colour before anybody had touched anything: a hex arrived and an `rgb()` of its own making
	// went back.
	const putOut = (): void => {
		paint();
		const text = writeColour(fromHsv(
			hue.get(), saturation.get() / 100, brightness.get() / 100,
			alphaOn ? opacity.get() / 100 : alpha,
		));
		if (text === agreed) return;
		agreed = text;
		cell.set(text);
	};

	// The square measured as fractions: across is saturation, and down is less brightness, because
	// a box is measured from its top and a colour gets darker towards the bottom of one.
	const grip = drag({
		axes: 'xy',
		at: () => ({ x: saturation.get() / 100, y: 1 - brightness.get() / 100 }),
		disabled: () => states.isDisabled(),
		onMove: (to) => {
			saturation.set(Math.round(to.x * 100));
			brightness.set(Math.round((1 - to.y) * 100));
			putOut();
		},
	});

	cleanup(cell.effect((value) => {
		const text = value === null || value === undefined ? '' : String(value);
		if (text === agreed) return;
		takeIn(value);
	}));

	const node = h(elementFor(element, 'div'), {
		...rest,
		theme: ['colorpicker', type, theme],
	},
	h('span', { theme: ['colorpicker_swatch'], 'aria-hidden': 'true', style: { background: swatch } }),
	h('div', { theme: ['column', 'fill'] },
		h('div', {
			theme: ['colorpicker_plane'],
			style: { backgroundColor: planeBase },
			...grip.pointer,
		},
		h('span', {
			theme: ['colorpicker_plane_thumb', ...states.segments],
			// `left` and `top` are on no transition list, so the thumb arrives in the frame the
			// pointer did rather than easing after it.
			style: {
				left: through(saturation, (held) => `${String(held)}%`),
				top: through(brightness, (held) => `${String(100 - Number(held))}%`),
				backgroundColor: thumbFill,
			},
			role: 'slider',
			tabindex: through(disabled, (held) => (held ? '-1' : '0')),
			'aria-label': text('Saturation and brightness'),
			'aria-valuemin': '0',
			'aria-valuemax': '100',
			'aria-valuenow': through(saturation, (held) => String(held)),
			'aria-valuetext': valueText,
			'aria-disabled': through(disabled, (held) => (held ? 'true' : null)),
			isHovered: states.isHovered,
			isClicked: states.isClicked,
			...grip.keys,
		})),
		h(Slider, {
			label: text('Hue'), value: hue, min: 0, max: 360, disabled, track: false, onInput: putOut,
			theme: ['colorpicker_track', 'hue'],
		}),
		alphaOn
			? h(Slider, {
				label: text('Opacity'), value: opacity, min: 0, max: 100, disabled, track: false,
				onInput: putOut, theme: ['colorpicker_track'], style: { background: opacityTrack },
			})
			: null));

	return mount(elem, node, before, context);
};
