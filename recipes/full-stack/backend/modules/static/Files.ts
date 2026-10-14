// static/Files, configured: the page `vite build` wrote, served by this process in production.
//
// `/api/` is the session routes and nothing else, so a URL there that nothing answered is a 404
// in the server's JSON and never the page. The bundle's file names carry a content hash, so they
// are cached for a year.

import { fileURLToPath } from 'node:url';

export const config = {
	dir: fileURLToPath(new URL('../../../page/dist', import.meta.url)),
	notPages: ['api/'],
	headers: { 'assets/': { 'cache-control': 'public, max-age=31536000, immutable' } },
};
