// The client bundle for the generated pages and for the live shell alike.

import { defineConfig } from 'vite';

import { aweft } from '@aweftjs/build';

export default defineConfig({
	root: import.meta.dirname,
	plugins: [aweft({ defaultH: '@aweftjs/ui' })],
	build: { outDir: 'dist', emptyOutDir: true },
});
