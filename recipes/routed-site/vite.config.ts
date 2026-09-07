// The one plugin a page needs. `npx vite recipes/routed-site` reads this, and so does `main.ts`.

import { defineConfig } from 'vite';

import { aweft } from '@aweftjs/build';

export default defineConfig({
	root: import.meta.dirname,
	plugins: [aweft()],
	build: { outDir: 'dist', emptyOutDir: true },
});
