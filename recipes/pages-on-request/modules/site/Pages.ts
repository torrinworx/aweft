// The pages, rendered on request. The reads a page may make are named in `deps` and handed over
// under the names the page asks them by. The gate is the one the server runs, `open` here.

import { fileURLToPath } from 'node:url';

import type { ModuleProps } from '@aweftjs/modules';
import { open } from '@aweftjs/server';
import { createPages } from '@aweftjs/ssg';
import { h } from '@aweftjs/ui';

import { Site } from '../../site.tsx';

export const deps = ['posts/List', 'posts/Read'];

export default ({ imports }: ModuleProps) => createPages({
	page: (router, client) => h(Site, { router, client }),
	gate: open,
	modules: { 'posts/List': imports.List, 'posts/Read': imports.Read },
	// From this file's own URL, because a relative directory is resolved from wherever the
	// process was started.
	dir: fileURLToPath(new URL('../../dist', import.meta.url)),
});
