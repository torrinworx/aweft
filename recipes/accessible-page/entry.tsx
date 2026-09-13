// What the browser runs: the page, mounted under the light theme. Everything the page says is
// in `page.tsx`; this file is the root entry (the `ui` README, The look) and nothing else.

import standard from '@aweftjs/icons/lucide/+standard';
import { Icons, Theme, h, light, mount } from '@aweftjs/ui';

import { Page } from './page.tsx';

// A page of your own has `lib: ["dom"]` and writes `document` plainly. This file is typechecked
// beside the packages, which have no DOM, so it names what it reaches for.
const page = globalThis as unknown as { document: { body: unknown } };

Theme.define({
	page: {
		minHeight: '100vh',
		background: '$background',
		color: '$foreground',
		fontFamily: '$font',
		padding: '$space4',
	},
});

// The dialog's close button and the menu's chevron ask for icons by their standard names, and
// the set's standard selection is what answers them (the `icons` README).
mount(page.document.body as never, <Theme value={light}><Icons value={standard}><Page /></Icons></Theme>);
