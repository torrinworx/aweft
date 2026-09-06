// The functions the default theme ships.
//
// They are theme data, not a table in the engine (design 111). They sit in the default theme's
// `*` entry, which is the lowest precedence entry there is, so an application's theme can add a
// function and a nested `Theme` can shadow any of these the same way it shadows a variable.

import {
	type Colour, contrastText, invert, luminance, readColour, rotateHue,
	saturate, setBrightness, shiftBrightness, withAlpha, writeColour,
} from './color.ts';
import { type ThemeFunction, numeric } from './values.ts';

/** A function over one colour and a number. A value that is not a colour is handed back as it was. */
const colourFn = (fn: (colour: Colour, by: number) => Colour): ThemeFunction => (args) => {
	const colour = readColour(args[0] ?? '');
	if (colour === null) return args[0] ?? '';
	return writeColour(fn(colour, numeric(args[1] ?? '0')));
};

const arithmetic = (fn: (numbers: number[]) => number): ThemeFunction => (args) => String(fn(args.map(numeric)));

/**
 * The default theme's `$fn` entries, ready to spread into an entry.
 *
 * Every key is a `$name`, so `defineTheme({ '*': { ...themeFunctions } })` puts them where the
 * precedence walk finds them and where anything more specific replaces them.
 */
export const themeFunctions: Readonly<Record<string, ThemeFunction>> = {
	$shiftBrightness: colourFn(shiftBrightness),
	$brightness: colourFn(setBrightness),
	$saturate: colourFn(saturate),
	$hue: colourFn(rotateHue),
	$alpha: colourFn(withAlpha),
	$invert: (args) => {
		const colour = readColour(args[0] ?? '');
		return colour === null ? args[0] ?? '' : writeColour(invert(colour));
	},
	$contrast_text: (args) => {
		const colour = readColour(args[0] ?? '');
		return colour === null ? 'rgb(0, 0, 0)' : writeColour(contrastText(colour));
	},
	$luminance: (args) => {
		const colour = readColour(args[0] ?? '');
		return colour === null ? '0' : String(Math.round(luminance(colour) * 1000) / 1000);
	},
	$add: arithmetic((n) => n.reduce((a, b) => a + b, 0)),
	$sub: arithmetic((n) => (n.length === 0 ? 0 : n.slice(1).reduce((a, b) => a - b, n[0]!))),
	$mul: arithmetic((n) => n.reduce((a, b) => a * b, 1)),
	$div: arithmetic((n) => (n.length === 0 ? 0 : n.slice(1).reduce((a, b) => (b === 0 ? 0 : a / b), n[0]!))),
	$mod: arithmetic((n) => (n.length < 2 || n[1] === 0 ? 0 : n[0]! % n[1]!)),
	$min: arithmetic((n) => (n.length === 0 ? 0 : Math.min(...n))),
	$max: arithmetic((n) => (n.length === 0 ? 0 : Math.max(...n))),
	$floor: arithmetic((n) => Math.floor(n[0] ?? 0)),
	$ceil: arithmetic((n) => Math.ceil(n[0] ?? 0)),
	$round: arithmetic((n) => Math.round(n[0] ?? 0)),
	// The one function whose arguments are not numbers: the two branches are text.
	$if: (args) => {
		const test = (args[0] ?? '').trim();
		const truthy = test !== '' && test !== '0' && test !== 'false' && test !== 'null';
		return (truthy ? args[1] : args[2]) ?? '';
	},
};
