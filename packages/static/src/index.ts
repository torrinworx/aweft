// The static battery, as a source of one server module (design 249).

import { fromBundle } from '@aweftjs/modules';
import type { Source } from '@aweftjs/modules';

/**
 * The files module, for `sources`: `static/Files`, which serves a directory of files for
 * every HTTP request no route matched (design 249, over the hook of design 248).
 *
 * Params: none. It is a value, listed beside the application's own sources, and it evaluates
 * nothing until the loader asks for the module.
 *
 * Returns: the source. Put the application's own source first and a `static/Files` there wins,
 * which is how this module is replaced; a file of that name exporting only `config` configures
 * it instead. The module carries `public` from that configuration, true unless it is set to
 * false, so a gate that reads `public` serves an anonymous reader.
 *
 * Example:
 *   const server = createServer({ sources: [own, files], gate: open, listener });
 *   await server.start();
 *   // modules/static/Files.ts, in `own`:
 *   export const config = { dir: 'dist', headers: { 'assets/': 'public, max-age=31536000, immutable' } };
 */
export const files: Source = fromBundle({
	'./static/Files.ts': () => import('./modules/Files.ts'),
});
