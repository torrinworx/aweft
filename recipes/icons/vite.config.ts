// The one plugin a page needs. `npx vite recipes/icons` reads this, and so does `main.ts`.
//
// `aweft()` is doing two jobs here: it compiles the JSX, and it answers the icon imports that
// compiling it wrote. There is nothing else to register.

import { defineConfig } from 'vite';

import { aweft } from '@aweftjs/build';

export default defineConfig({
	root: import.meta.dirname,
	plugins: [aweft()],
	build: { outDir: 'dist', emptyOutDir: true },
});
