// The page's config: the transform, and the proxy development needs so the page, its socket and
// its log batches share one origin. The room bundle is under `public/room`, so the dev server
// serves it as it stands and the frame imports it from this origin.
//
// `cors` is what lets the frame import it: a frame with an opaque origin sends `Origin: null`
// with every module request, and a module script is always fetched with CORS, so the bundle has
// to come with `Access-Control-Allow-Origin: *`. Whatever serves the bundle in production sends
// the same header for the room's files.

import { defineConfig } from 'vite';

import { aweft } from '@aweftjs/build';

const backend = `127.0.0.1:${process.env.AWEFT_BACKEND_PORT ?? '8080'}`;

export default defineConfig({
	root: import.meta.dirname,
	plugins: [aweft({ defaultH: '@aweftjs/ui' })],
	server: {
		host: '127.0.0.1',
		cors: { origin: '*' },
		proxy: {
			'/api': { target: `http://${backend}` },
			'/ws': { target: `ws://${backend}`, ws: true },
		},
	},
	build: { outDir: 'dist', emptyOutDir: true },
});
