// The bundle the pages load, served by the static battery. The server asks it only for requests
// the pages module did not answer: paths that name a file in this directory.

import { fileURLToPath } from 'node:url';

export const config = {
	dir: fileURLToPath(new URL('../../dist', import.meta.url)),
	headers: { 'assets/': 'public, max-age=31536000, immutable' },
};
