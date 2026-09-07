// The one plugin a page needs, told which package a file with no `h` of its own gets one from.
// The server side of this recipe says the same thing with AWEFT_DEFAULT_H, and `banner.tsx` is
// the file that proves the two agree (design 147).

import { defineConfig } from 'vite';

import { aweft } from '@aweftjs/build';

export default defineConfig({
	root: import.meta.dirname,
	plugins: [aweft({ defaultH: '@aweftjs/ui' })],
	build: { outDir: 'dist', emptyOutDir: true },
});
