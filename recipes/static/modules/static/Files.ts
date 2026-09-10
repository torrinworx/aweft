// Configuration for a module this application did not write. No factory here, so the
// battery's `static/Files` is still the implementation: this file says which directory it
// serves and what may be cached, and it wins because this source comes first.
//
// The directory is built from this file's own URL rather than written as `dist`, because a
// relative one is resolved from wherever the process was started.

import { fileURLToPath } from 'node:url';

export const config = {
	dir: fileURLToPath(new URL('../../dist', import.meta.url)),
	headers: { 'assets/': 'public, max-age=31536000, immutable' },
};
