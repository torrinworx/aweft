// A pack that answers every standard name, for a suite that mounts a component showing an icon.
//
// `Icons` starts empty and a name nothing answers is an assert (design 144), so a page holding one
// of these components answers for its icons. A test is a page like any other.

import { standardIcons } from '@aweftjs/ui';
import type { IconData, IconPack } from '@aweftjs/ui';

// A different line per name, so a test that says one drawing replaced another can see it.
const drawing = (at: number): IconData => ({
	body: `<path d="M0 0 L10 ${String(at)}"/>`,
	width: 10,
	height: 10,
});

export const testIcons: IconPack = {
	icons: Object.fromEntries(standardIcons.map((name, at) => [name, drawing(at)])),
};
