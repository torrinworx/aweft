// The one plugin a page needs. The server renders the same `site.tsx` under AWEFT_DEFAULT_H set to
// the same package, which is what lets the bundle hydrate the server's markup.

import { defineConfig } from 'vite';

import { aweft } from '@aweftjs/build';

export default defineConfig({
	root: import.meta.dirname,
	plugins: [aweft({ defaultH: '@aweftjs/ui' })],
	build: { outDir: 'dist', emptyOutDir: true },
});
