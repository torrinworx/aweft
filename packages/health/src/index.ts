// The health battery, as a source of one server module (design 258).

import { fromBundle } from '@aweftjs/modules';
import type { Source } from '@aweftjs/modules';

/**
 * The check module, for `sources`: `health/Check`, which answers `GET /api/health` with whether
 * the process and, when the server was handed one, its store are up (design 258).
 *
 * Params: none. It is a value, listed beside the application's own sources, and it evaluates
 * nothing until the loader asks for the module.
 *
 * Returns: the source. Put the application's own source first and a `health/Check` there wins,
 * which is how this module is replaced; a file of that name exporting only `config` configures
 * it instead. The module carries `public` from that configuration, true unless it is set to
 * false, so a gate that reads `public` answers a poll with no cookie.
 *
 * Example:
 *   const server = createServer({ sources: [own, health], store, gate: 'auth/Gate', listener });
 *   await server.start();
 *   // modules/health/Check.ts, in `own`:
 *   export const config = { info: { build: process.env.BUILD_SHA ?? null } };
 */
export const health: Source = fromBundle({
	'./health/Check.ts': () => import('./modules/Check.ts'),
});
