// The pack that ships, so a bare `Icon` renders (design 131).
//
// Eight glyphs, drawn for this package on a 24 by 24 grid out of straight lines, one arc and one
// dot. They are the ones this package's own components need and the few every page reaches for.
// No path data is copied from anywhere; each of these is the geometry the shape has to be.
//
// A page that wants a real icon set installs one and hands it to `Icons`, which is what that
// context is for. This pack is the floor, not the set.

import type { IconData, IconPack } from './icon-data.ts';

// Every glyph here is a stroked outline rather than a filled shape, so one set of stroke
// attributes covers all of them and each body is only its own path.
const stroked = (path: string): IconData => ({
	body: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" `
		+ `stroke-linejoin="round">${path}</g>`,
	width: 24,
	height: 24,
});

/** The icons this package ships. */
export const defaultPack: IconPack = {
	prefix: 'aweft',
	icons: {
		'chevron-down': stroked('<path d="M6 9 12 15 18 9"/>'),
		'chevron-up': stroked('<path d="M6 15 12 9 18 15"/>'),
		'chevron-right': stroked('<path d="M9 6 15 12 9 18"/>'),
		'chevron-left': stroked('<path d="M15 6 9 12 15 18"/>'),
		check: stroked('<path d="M5 13 9.5 17.5 19 7.5"/>'),
		x: stroked('<path d="M6 6 18 18M18 6 6 18"/>'),
		alert: stroked('<path d="M12 3.5 22 20.5H2Z"/><path d="M12 10v4"/><path d="M12 17.4v.1"/>'),
		search: stroked('<circle cx="11" cy="11" r="6"/><path d="M15.6 15.6 21 21"/>'),
	},
	aliases: {
		close: { parent: 'x' },
		expand: { parent: 'chevron-down' },
		collapse: { parent: 'chevron-up' },
	},
};
