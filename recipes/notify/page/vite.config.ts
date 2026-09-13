// The page's config: the transform, and the proxy development needs so the page, its socket and
// its session routes all share one origin.

import { defineConfig } from 'vite';

import { aweft } from '@aweftjs/build';

const backend = `127.0.0.1:${process.env.AWEFT_BACKEND_PORT ?? '8080'}`;

export default defineConfig({
	root: import.meta.dirname,
	plugins: [aweft({ defaultH: '@aweftjs/ui' })],
	server: {
		host: '127.0.0.1',
		proxy: {
			'/api': { target: `http://${backend}` },
			'/ws': { target: `ws://${backend}`, ws: true },
		},
	},
	build: { outDir: 'dist', emptyOutDir: true },
});
