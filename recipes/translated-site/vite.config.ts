// The one plugin a page needs, with the text pass on, so every literal the site shows is found
// and looked up where it mounts (design 277). The process that renders the pages says the same
// two things with AWEFT_DEFAULT_H and AWEFT_TEXT, and the hydration in `main.ts` is what proves
// the two sides agree.

import { defineConfig } from 'vite';

import { aweft } from '@aweftjs/build';

export default defineConfig({
	root: import.meta.dirname,
	plugins: [aweft({ defaultH: '@aweftjs/ui', text: true })],
	build: { outDir: 'dist', emptyOutDir: true },
});
