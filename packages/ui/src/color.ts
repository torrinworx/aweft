// Reading a colour, and the arithmetic the theme functions do to it.
//
// Everything is read into one shape (red, green and blue 0 to 255, alpha 0 to 1) and written
// back out as `rgb()` or `rgba()`. Hue, saturation and brightness go through HSV, because that
// is the space in which "make this 20% brighter" means what a person means by it.

import { assert } from './assert.ts';

/** A colour, read out of whatever notation wrote it. */
export interface Colour {
	readonly r: number;
	readonly g: number;
	readonly b: number;
	readonly a: number;
}

// The sixteen names CSS has had since level 2, plus transparent. A name outside this list is
// not read as a colour and passes through untouched, which is what `currentColor`, `inherit`
// and a custom property all need.
const NAMED: Record<string, string> = {
	black: '000000', silver: 'c0c0c0', gray: '808080', white: 'ffffff',
	maroon: '800000', red: 'ff0000', purple: '800080', fuchsia: 'ff00ff',
	green: '008000', lime: '00ff00', olive: '808000', yellow: 'ffff00',
	navy: '000080', blue: '0000ff', teal: '008080', aqua: '00ffff',
};

const clamp = (value: number, low: number, high: number): number =>
	(value < low ? low : value > high ? high : value);

const byte = (value: number): number => Math.round(clamp(value, 0, 255));

const hex = (text: string): Colour | null => {
	const digits = text.length;
	if (digits !== 3 && digits !== 4 && digits !== 6 && digits !== 8) return null;
	if (!/^[0-9a-fA-F]+$/.test(text)) return null;
	const wide = digits > 4;
	const at = (i: number): number => {
		const part = wide ? text.slice(i * 2, i * 2 + 2) : text[i]!.repeat(2);
		return parseInt(part, 16);
	};
	const alpha = digits === 4 || digits === 8;
	return { r: at(0), g: at(1), b: at(2), a: alpha ? at(3) / 255 : 1 };
};

/** A number, a percentage of `full`, or null. */
const amount = (text: string, full: number): number | null => {
	const trimmed = text.trim();
	if (trimmed === '') return null;
	if (trimmed.endsWith('%')) {
		const value = Number(trimmed.slice(0, -1));
		return Number.isFinite(value) ? (value / 100) * full : null;
	}
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
};

// `rgb(1 2 3 / 50%)` and `rgb(1, 2, 3, 0.5)` are the same colour written two ways.
const parts = (body: string): string[] =>
	body.replace('/', ',').split(/[\s,]+/).map((piece) => piece.trim()).filter((piece) => piece !== '');

/** A colour in hue, saturation and brightness. Internal: `ColorPicker` picks along these. */
export const hsvOf = (colour: Colour): { h: number; s: number; v: number } => {
	const r = colour.r / 255, g = colour.g / 255, b = colour.b / 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	const span = max - min;
	let h = 0;
	if (span !== 0) {
		if (max === r) h = ((g - b) / span) % 6;
		else if (max === g) h = (b - r) / span + 2;
		else h = (r - g) / span + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return { h, s: max === 0 ? 0 : span / max, v: max };
};

/** The colour those three and an alpha name. Internal, and the inverse of `hsvOf`. */
export const fromHsv = (h: number, s: number, v: number, a: number): Colour => {
	const hue = ((h % 360) + 360) % 360;
	const chroma = clamp(v, 0, 1) * clamp(s, 0, 1);
	const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
	const base = clamp(v, 0, 1) - chroma;
	const sector = Math.floor(hue / 60) % 6;
	const table: [number, number, number][] = [
		[chroma, second, 0], [second, chroma, 0], [0, chroma, second],
		[0, second, chroma], [second, 0, chroma], [chroma, 0, second],
	];
	const [r, g, b] = table[sector]!;
	return { r: byte((r + base) * 255), g: byte((g + base) * 255), b: byte((b + base) * 255), a };
};

const fromHsl = (h: number, s: number, l: number, a: number): Colour => {
	const v = l + s * Math.min(l, 1 - l);
	return fromHsv(h, v === 0 ? 0 : 2 * (1 - l / v), v, a);
};

/**
 * Read a colour, or answer null when the text is not one.
 *
 * Params:
 *   text: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `hsl()`, `hsla()`, or
 *         one of the sixteen CSS names and `transparent`
 *
 * Returns: the colour, or null. Null is not a failure: a theme function hands the value
 * through untouched, so `currentColor` and a custom property survive.
 *
 * Example:
 *   readColour('#1b6ef3');            // { r: 27, g: 110, b: 243, a: 1 }
 */
export const readColour = (text: string): Colour | null => {
	const value = text.trim();
	if (value === '') return null;
	if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
	const named = NAMED[value.toLowerCase()];
	if (named !== undefined) return hex(named);
	if (value[0] === '#') return hex(value.slice(1));

	const call = /^([a-z]+)\((.*)\)$/i.exec(value);
	if (call === null) return null;
	const name = call[1]!.toLowerCase();
	const piece = parts(call[2]!);
	if (piece.length < 3) return null;
	const alpha = piece.length > 3 ? amount(piece[3]!, 1) ?? 1 : 1;

	if (name === 'rgb' || name === 'rgba') {
		const r = amount(piece[0]!, 255), g = amount(piece[1]!, 255), b = amount(piece[2]!, 255);
		if (r === null || g === null || b === null) return null;
		return { r: byte(r), g: byte(g), b: byte(b), a: clamp(alpha, 0, 1) };
	}
	if (name === 'hsl' || name === 'hsla') {
		const h = amount(piece[0]!.replace('deg', ''), 360);
		const s = amount(piece[1]!, 1), l = amount(piece[2]!, 1);
		if (h === null || s === null || l === null) return null;
		return fromHsl(h, clamp(s, 0, 1), clamp(l, 0, 1), clamp(alpha, 0, 1));
	}
	return null;
};

/** A colour written back out. Opaque colours print as `rgb()`, the rest as `rgba()`. */
export const writeColour = (colour: Colour): string =>
	(colour.a >= 1
		? `rgb(${byte(colour.r)}, ${byte(colour.g)}, ${byte(colour.b)})`
		: `rgba(${byte(colour.r)}, ${byte(colour.g)}, ${byte(colour.b)}, ${Math.round(clamp(colour.a, 0, 1) * 1000) / 1000})`);

const shifted = (colour: Colour, fn: (hsv: { h: number; s: number; v: number }) => { h: number; s: number; v: number }): Colour => {
	const hsv = hsvOf(colour);
	const moved = fn(hsv);
	return fromHsv(moved.h, moved.s, moved.v, colour.a);
};

/** Relative luminance, the number `$contrast_text` reads to pick black or white. */
export const luminance = (colour: Colour): number => {
	const channel = (value: number): number => {
		const v = value / 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
};

/** Move brightness by a fraction: 0.2 is a fifth brighter, -0.2 a fifth darker. */
export const shiftBrightness = (colour: Colour, by: number): Colour =>
	shifted(colour, (hsv) => ({ ...hsv, v: clamp(hsv.v + by, 0, 1) }));

/** Set brightness outright, 0 to 1. */
export const setBrightness = (colour: Colour, to: number): Colour =>
	shifted(colour, (hsv) => ({ ...hsv, v: clamp(to, 0, 1) }));

/** Move saturation by a fraction. */
export const saturate = (colour: Colour, by: number): Colour =>
	shifted(colour, (hsv) => ({ ...hsv, s: clamp(hsv.s + by, 0, 1) }));

/** Move the hue by degrees. */
export const rotateHue = (colour: Colour, by: number): Colour =>
	shifted(colour, (hsv) => ({ ...hsv, h: hsv.h + by }));

/** The channel-wise inverse, alpha kept. */
export const invert = (colour: Colour): Colour =>
	({ r: 255 - colour.r, g: 255 - colour.g, b: 255 - colour.b, a: colour.a });

/** Set the alpha outright, 0 to 1. */
export const withAlpha = (colour: Colour, to: number): Colour =>
	({ ...colour, a: clamp(to, 0, 1) });

/** Black on a light colour, white on a dark one, by measured luminance. */
export const contrastText = (colour: Colour): Colour => {
	assert(Number.isFinite(colour.r), 'a colour must have finite channels');
	return luminance(colour) > 0.179 ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
};
