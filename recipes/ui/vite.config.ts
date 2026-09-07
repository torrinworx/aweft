// The one plugin a page needs. `npx vite recipes/ui` reads this, and so does `main.ts`.
//
// Two pages: the gallery, which exercises every system the package ships, and the preview, which
// is the look itself in both modes. One recipe, one build, one driver.

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
				index: join(import.meta.dirname, 'index.html'),
				preview: join(import.meta.dirname, 'preview.html'),
			},
		},
	},
});
