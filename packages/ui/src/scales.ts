// The four colour scales, twelve steps each, written out light and dark.
//
// Every step is a named value, so a page reaches one as `$neutral7` and the roles in `roles.ts`
// are built from them. The steps follow one job list, the same for all four scales (design 116):
//
//   1, 2      backgrounds: the page, and a raised surface
//   3, 4, 5   component fills, at rest, hovered and pressed
//   6, 7, 8   lines: a block's border, a control's edge, the focus ring
//   9, 10     solids: a filled control, and the same one pressed
//   11, 12    text: the quiet one, and the high-contrast one
//
// A ramp descends from 1 to 10 in light and climbs in dark. Step 11 steps back towards the middle
// on purpose: it is the quiet text colour, chosen for its ratio against the backgrounds rather
// than for its place in the ramp. The light ramp jumps hard from 5 to 6 because 6 is the first
// step that has to be seen against near-white, and 3:1 against near-white is a mid grey.
//
// The values are written down. No generator, and no colour maths in this package for them.

/** The light scales, and the shape every scale has. */
export const lightScale = {
	$neutral1: '#fcfcfd',
	$neutral2: '#f5f6f8',
	$neutral3: '#edeff3',
	$neutral4: '#e4e7ed',
	$neutral5: '#dadee6',
	$neutral6: '#848a96',
	$neutral7: '#6f7683',
	$neutral8: '#5a616e',
	$neutral9: '#464d5a',
	$neutral10: '#363d49',
	$neutral11: '#545a66',
	$neutral12: '#1c2027',

	$accent1: '#f7faff',
	$accent2: '#eef4ff',
	$accent3: '#dfe9ff',
	$accent4: '#cddeff',
	$accent5: '#b8d0fe',
	$accent6: '#97b8f8',
	$accent7: '#6f9bf0',
	$accent8: '#3f78e0',
	$accent9: '#1c5fd6',
	$accent10: '#1550bb',
	$accent11: '#14479f',
	$accent12: '#10275c',

	$danger1: '#fff8f8',
	$danger2: '#fff0f0',
	$danger3: '#ffe2e2',
	$danger4: '#ffd0d0',
	$danger5: '#ffbaba',
	$danger6: '#f79b9b',
	$danger7: '#ea7676',
	$danger8: '#d5484e',
	$danger9: '#c32430',
	$danger10: '#a91b26',
	$danger11: '#97141f',
	$danger12: '#4d0d13',

	$success1: '#f6fdf8',
	$success2: '#ebfaf0',
	$success3: '#d8f4e2',
	$success4: '#c0ebd0',
	$success5: '#a2debb',
	$success6: '#7aca9d',
	$success7: '#4bb17d',
	$success8: '#1e9460',
	$success9: '#0d7a4c',
	$success10: '#076741',
	$success11: '#04593a',
	$success12: '#062d1f',
} as const;

/** Forty-eight named steps: the four scales of one mode. */
export type Scale = Readonly<Record<keyof typeof lightScale, string>>;

/** The dark scales. Same names, same jobs, read against a dark page. */
export const darkScale: Scale = {
	$neutral1: '#0f1216',
	$neutral2: '#161a20',
	$neutral3: '#1d222a',
	$neutral4: '#242a33',
	$neutral5: '#2c333d',
	$neutral6: '#6b7381',
	$neutral7: '#838b99',
	$neutral8: '#9ba3b1',
	$neutral9: '#5b6270',
	$neutral10: '#6d7482',
	$neutral11: '#a8afbb',
	$neutral12: '#edeff3',

	$accent1: '#0c1420',
	$accent2: '#0f1b2c',
	$accent3: '#132540',
	$accent4: '#16305a',
	$accent5: '#1b3c73',
	$accent6: '#24509b',
	$accent7: '#2f68c6',
	$accent8: '#4a86e8',
	$accent9: '#5b95f5',
	$accent10: '#77a8f8',
	$accent11: '#9dc2fb',
	$accent12: '#d6e6ff',

	$danger1: '#1a0d0f',
	$danger2: '#241012',
	$danger3: '#3a1417',
	$danger4: '#4d181c',
	$danger5: '#631d22',
	$danger6: '#8a2c31',
	$danger7: '#ad3b41',
	$danger8: '#d05056',
	$danger9: '#e85f66',
	$danger10: '#f07d83',
	$danger11: '#ff9ea3',
	$danger12: '#ffdcde',

	$success1: '#0b1712',
	$success2: '#0f1f18',
	$success3: '#122b1f',
	$success4: '#153726',
	$success5: '#18442d',
	$success6: '#1f603f',
	$success7: '#277a51',
	$success8: '#2f9764',
	$success9: '#35a870',
	$success10: '#46bd82',
	$success11: '#62d79b',
	$success12: '#ccf6de',
};
