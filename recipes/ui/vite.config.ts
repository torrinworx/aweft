// The one plugin a page needs. `npx vite recipes/ui` reads this, and so does `main.ts`.
//
// Four pages: the gallery, which exercises every system the package ships; the preview, which is
// the look itself in both modes; the controls, which is every control in every state; and the
// composites, which is everything built out of those. One recipe, one build, one driver.

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
				controls: join(import.meta.dirname, 'controls.html'),
				composites: join(import.meta.dirname, 'composites.html'),
			},
		},
	},
});
