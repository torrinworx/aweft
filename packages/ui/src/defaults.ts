// The theme a page gets before it defines one of its own.
//
// Deliberately small. `ui` does not decide what an application looks like; it decides
// that a bare `<button theme="button">` renders as something rather than as nothing, and it shows
// what the value language is for. Every entry here is overridden by a `defineTheme` of the same
// key, or by a `Theme` provider on part of the page.

import { themeFunctions } from './functions.ts';
import { defineTheme } from './sheet.ts';

defineTheme({
	'*': {
		// The colour and arithmetic functions are entries of this theme, at the lowest precedence
		// there is, so any theme above can add one or replace one (design 111).
		...themeFunctions,
		$primary: '#1b6ef3',
		$surface: '#ffffff',
		$ink: '#16181d',
		$muted: '#6b7280',
		$radius: '6',
		$gap: '8',
		$speed: '150ms',
		fontFamily: 'system-ui, sans-serif',
		color: '$ink',
	},

	button: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '$gap$px',
		padding: '8px 14px',
		border: 'none',
		borderRadius: '$radius$px',
		background: '$primary',
		color: '$contrast_text($primary)',
		cursor: 'pointer',
		transition: 'background $speed',
		_cssProp_focusVisible: { outline: '2px solid $primary', outlineOffset: 2 },
	},
	button_hovered: { background: '$shiftBrightness($primary, -0.08)' },
	button_disabled: { background: '$saturate($primary, -0.6)', cursor: 'not-allowed' },
	button_plain: { background: 'transparent', color: '$primary' },

	panel: {
		background: '$surface',
		color: '$ink',
		borderRadius: '$radius$px',
		padding: 16,
		border: '1px solid $alpha($ink, 0.12)',
	},

	popup: {
		background: '$surface',
		color: '$ink',
		borderRadius: '$radius$px',
		padding: 8,
		border: '1px solid $alpha($ink, 0.16)',
		boxShadow: '0 8px 24px $alpha($ink, 0.18)',
	},

	muted: { color: '$muted' },

	// A component library that answers a viewport query is wrong the first time someone puts a
	// card in a sidebar, so the one media rule here is the one that is about the person.
	'*_animated': {
		transition: 'all $speed',
		'_media_(prefers-reduced-motion: reduce)': { transition: 'none' },
	},
});
