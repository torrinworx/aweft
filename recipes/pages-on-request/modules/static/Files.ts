// The bundle the pages load, served by the static battery. It is asked only for what the pages
// module declined: a path that names a file in this directory.

import { fileURLToPath } from 'node:url';

export const config = {
	dir: fileURLToPath(new URL('../../dist', import.meta.url)),
	headers: { 'assets/': 'public, max-age=31536000, immutable' },
};
