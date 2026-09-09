// The one plugin a page needs. `npx vite recipes/ui` reads this, and so does `main.ts`.
//
// Three pages: the gallery, which exercises every system the package ships; the preview, which is
// the look itself in both modes and where the look is judged; and the catalogue, which is
// every component, in every state, in both modes. One recipe, one build, one driver.

import { join } from 'node:path';

import { defineConfig } from 'vite';

import { aweft } from '@aweftjs/build';

export default defineConfig({
	root: import.meta.dirname,
	plugins: [aweft()],
	// Three pages, not one application. Without this the dev server answers every unknown path with
	// `index.html`, so a driver that asks for a page that is not there gets 200 and the gallery's
	// markup, and a typo in a path reads as a page whose assertions all fail.
	appType: 'mpa',
	// The dev server's dependency scan reads a file the catalogue's glob names without this
	// plugin's transform in front of it, sees JSX, and asks for a React runtime that is not
	// installed. These pages import nothing from npm, so there is nothing to pre-bundle and
	// nothing to lose by not looking.
	optimizeDeps: { noDiscovery: true, include: [] },
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		rollupOptions: {
			input: {
				index: join(import.meta.dirname, 'index.html'),
				preview: join(import.meta.dirname, 'preview.html'),
				catalogue: join(import.meta.dirname, 'catalogue.html'),
			},
		},
	},
});
