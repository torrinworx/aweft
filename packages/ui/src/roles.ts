// The seventeen colour roles, and the scale step each one takes (design 115).
//
// A component of this library uses a role. It never uses a step and never writes a colour, and
// `check-theme.ts` is what says so out loud.
//
// A role holds a colour rather than the name of a step, because the value language resolves a
// `$name` to the text it holds and does not read that text again: `$background: '$neutral1'` would
// put those nine characters into the CSS. So the mapping is done here, where the theme is built,
// and it stays one line per role.

import { type Scale, darkScale, lightScale } from './scales.ts';

/** Every role, set from the step whose job it is. */
const rolesFrom = (scale: Scale): Readonly<Record<string, string>> => ({
	// the page, and its text
	$background: scale.$neutral1,
	$foreground: scale.$neutral12,

	// a raised block, and its text
	$surface: scale.$neutral2,
	$surfaceForeground: scale.$neutral12,

	// a quiet fill, and text quiet enough to sit on any of the three backgrounds
	$muted: scale.$neutral3,
	$mutedForeground: scale.$neutral11,

	// the solid accent, and the text on it
	$accent: scale.$accent9,
	$accentForeground: scale.$neutral1,

	// a tinted accent fill, and the text on it
	$accentSubtle: scale.$accent3,
	$accentSubtleForeground: scale.$accent11,

	// the solid danger, and the text on it
	$danger: scale.$danger9,
	$dangerForeground: scale.$neutral1,

	// a tinted danger fill, and the text on it
	$dangerSubtle: scale.$danger3,
	$dangerSubtleForeground: scale.$danger11,

	// the line around a block, the edge of a control, and the focus ring
	$border: scale.$neutral6,
	$input: scale.$neutral7,
	$ring: scale.$accent8,
});

/**
 * The foreground role that goes with each background role: the pair convention of design 115,
 * written down. It sits here beside the roles, so a background added above without its partner is
 * one file to notice rather than two, and so nothing has to spell a role name out of a pattern.
 */
export const foregroundFor: Readonly<Record<string, string>> = {
	background: 'foreground',
	surface: 'surfaceForeground',
	muted: 'mutedForeground',
	accent: 'accentForeground',
	accentSubtle: 'accentSubtleForeground',
	danger: 'dangerForeground',
	dangerSubtle: 'dangerSubtleForeground',
};

/** Every foreground role there is, in the order a message offers them. */
export const foregroundRoles: readonly string[] = [...new Set(Object.values(foregroundFor))];

/** The roles of the light mode. */
export const lightRoles = rolesFrom(lightScale);

/** The roles of the dark mode. */
export const darkRoles = rolesFrom(darkScale);
