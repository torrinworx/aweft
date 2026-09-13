// The page's config: the transform, and the one thing development needs that production does
// not.
//
// A session cookie belongs to an origin, so the page and its socket have to share one. In
// development the page comes from this dev server, so the backend goes behind it: `/api` for
// the session routes and `/ws` for the socket. The socket has a path of its own because a proxy
// entry matches a URL by prefix, so an entry for `/` takes every upgrade the dev server's own
// hot-reload socket included, and the page then never loads at all.
//
// The text pass is on from the first build, so the page has a source catalog an agent can fill
// before it has a second language (design 277). A process that renders these pages says the same
// thing with AWEFT_TEXT=1.
//
// Serve it by hand: AWEFT_BACKEND_PORT=8080 npx vite --config recipes/full-stack/page/vite.config.ts

import { defineConfig } from 'vite';

import { aweft } from '@aweftjs/build';

const backend = `127.0.0.1:${process.env.AWEFT_BACKEND_PORT ?? '8080'}`;

export default defineConfig({
	root: import.meta.dirname,
	plugins: [aweft({ defaultH: '@aweftjs/ui', text: true })],
	server: {
		host: '127.0.0.1',
		proxy: {
			'/api': { target: `http://${backend}` },
			'/ws': { target: `ws://${backend}`, ws: true },
		},
	},
	build: { outDir: 'dist', emptyOutDir: true },
});
