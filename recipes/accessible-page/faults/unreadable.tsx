// Two faults only the rendered page shows: text painted in a colour close to its background, and
// a box that keeps the focus once it has it. The build reads neither (a colour is a value, a
// handler is code), the mount reads neither, and `audit` and `walk` read both. The theme does
// see the pair, because both colours are named: it warns in the console with the ratio (the `ui`
// README, The look), and the audit is what turns the warning into a finding a test fails on.

import { Theme, h, mount } from '@aweftjs/ui';

const page = globalThis as unknown as { document: { body: unknown } };

Theme.define({
	faint: { $faint: '#9a9a9a', $paper: '#ffffff', color: '$faint', background: '$paper' },
});

const keep = (event: { key: string; preventDefault(): void }): void => {
	if (event.key === 'Tab') event.preventDefault();
};

mount(page.document.body as never, (
	<main id="page">
		<h1>Unreadable</h1>
		<p id="faint" theme="faint">Grey on white, under 4.5:1.</p>
		<button type="button" id="before">Before</button>
		<div id="trap" tabindex="0" onKeyDown={keep}>Tab goes nowhere from here.</div>
		<button type="button" id="after">After</button>
	</main>
));
