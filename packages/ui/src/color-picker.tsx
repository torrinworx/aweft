// Picking a colour with four range inputs (design 139).
//
// Nothing here draws a saturation square or tracks a pointer. Each control is a `Slider`, which is
// the platform's range input (design 128), so the keyboard, the announced number and the pointer
// handling all come with the element. The maths is `color.ts`, which this package already had.

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { Slider } from './slider.tsx';
import { assert } from './assert.ts';
import { elementFor } from './control.ts';
import { fromHsv, hsvOf, readColour, writeColour } from './color.ts';
import { h } from './h.ts';
import { isWritable } from './source.ts';

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

/** Where each slider starts when the component keeps its own colour: a full red. */
const START = { h: 0, s: 1, v: 1, a: 1 };

/**
 * A colour, picked on four sliders.
 *
 * Params:
 *   props: `value`, `hasAlpha`, `disabled`, `type`, `element`, and anything else, which goes to the
 *          wrapper
 *
 * Returns: a `<div>` holding a swatch and four `Slider`s: hue, saturation, brightness and opacity,
 * the last only when `hasAlpha` is not false. Each is labelled, so each is found by name and
 * announces its number; the swatch is `aria-hidden`, because it says what the four already say.
 *
 * The cell holds CSS colour text, anything `readColour` reads, and is written back as `rgb()` or
 * `rgba()`. Moving a slider writes it, and nothing else does: mounting this on a colour leaves that
 * colour alone. Writing the cell from outside moves the sliders.
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
	const saturationTrack = mutable('');
	const brightnessTrack = mutable('');
	const opacityTrack = mutable('');

	// The tracks show the range at the colour that is chosen now, which only exists at run time. The
	// six hues of the hue track are named values in the theme entry, which is where a literal
	// belongs (design 139).
	const paint = (): void => {
		const at = hue.get();
		const s = saturation.get() / 100;
		const v = brightness.get() / 100;
		const a = alphaOn ? opacity.get() / 100 : alpha;
		const band = (from: string, to: string): string => `linear-gradient(to right, ${from}, ${to})`;
		saturationTrack.set(band(writeColour(fromHsv(at, 0, v, 1)), writeColour(fromHsv(at, 1, v, 1))));
		brightnessTrack.set(band(writeColour(fromHsv(at, s, 0, 1)), writeColour(fromHsv(at, s, 1, 1))));
		opacityTrack.set(band(writeColour(fromHsv(at, s, v, 0)), writeColour(fromHsv(at, s, v, 1))));
		swatch.set(writeColour(fromHsv(at, s, v, a)));
	};

	// The text the cell and the sliders last agreed on. A flag would not do: a delivery is deferred
	// to a safe point, so by the time the cell reports what this component wrote, the write has long
	// finished. Comparing the text is what stops a slider being set back from the value it just
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

	// Called from a slider's own `input` and from nowhere else. Hung off the knobs' effects it also
	// ran once as the component mounted, and that first run moved the caller's colour before anybody
	// had touched a slider: a hex arrived and an `rgb()` of its own making went back.
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

	cleanup(cell.effect((value) => {
		const text = value === null || value === undefined ? '' : String(value);
		if (text === agreed) return;
		takeIn(value);
	}));

	const node = h(elementFor(element, 'div'), {
		...rest,
		theme: ['colorpicker', type, theme],
	},
	h('span', { theme: ['colorpicker', 'swatch'], 'aria-hidden': 'true', style: { background: swatch } }),
	h('div', { theme: ['column', 'fill'] },
		h(Slider, {
			label: 'Hue', value: hue, min: 0, max: 360, disabled, track: false, onInput: putOut,
			theme: ['colorpicker', 'track', 'hue'],
		}),
		h(Slider, {
			label: 'Saturation', value: saturation, min: 0, max: 100, disabled, track: false,
			onInput: putOut, theme: ['colorpicker', 'track'], style: { background: saturationTrack },
		}),
		h(Slider, {
			label: 'Brightness', value: brightness, min: 0, max: 100, disabled, track: false,
			onInput: putOut, theme: ['colorpicker', 'track'], style: { background: brightnessTrack },
		}),
		alphaOn
			? h(Slider, {
				label: 'Opacity', value: opacity, min: 0, max: 100, disabled, track: false,
				onInput: putOut, theme: ['colorpicker', 'track'], style: { background: opacityTrack },
			})
			: null));

	return mount(elem, node, before, context);
};
