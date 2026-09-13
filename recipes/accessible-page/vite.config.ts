// The one plugin a page needs, and the three fault pages built beside the page (see `main.ts`).

import { join } from 'node:path';

import { defineConfig } from 'vite';

import { aweft } from '@aweftjs/build';

export default defineConfig({
	root: import.meta.dirname,
	plugins: [aweft()],
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		rollupOptions: {
			input: {
				page: join(import.meta.dirname, 'index.html'),
				'no-language': join(import.meta.dirname, 'faults', 'no-language.html'),
				'nameless-button': join(import.meta.dirname, 'faults', 'nameless-button.html'),
				unreadable: join(import.meta.dirname, 'faults', 'unreadable.html'),
			},
		},
	},
});
