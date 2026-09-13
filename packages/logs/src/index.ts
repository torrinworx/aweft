// The logs battery: a source of three server modules, the paths the application declares for
// them, and the readers any process imports (design 261).

import { fromBundle } from '@aweftjs/modules';
import type { Source } from '@aweftjs/modules';
import type { Declaration } from '@aweftjs/store';

/**
 * The three modules, for `sources`: `logs/Visits` keeps the documents, `logs/Record` answers
 * `POST /api/logs`, `logs/Observe` writes what the server did (design 261).
 *
 * Params: none. It is a value, listed beside the application's own sources.
 *
 * Returns: the source. Put the application's own source first and a module of the same name
 * there wins; a file of that name exporting only `config` configures it instead.
 *
 * Example:
 *   const store = createStore({ driver, declare: { ...auth.paths, ...logs.paths } });
 *   const server = createServer({ sources: [own, logs, auth], store, gate: 'auth/Gate', listener });
 *   // modules/logs/Visits.ts, in `own`:
 *   export const config = { keep: 7, build: process.env.BUILD_SHA ?? null };
 */
export const logs: Source = fromBundle({
	'./logs/Visits.ts': () => import('./modules/Visits.ts'),
	'./logs/Record.ts': () => import('./modules/Record.ts'),
	'./logs/Observe.ts': () => import('./modules/Observe.ts'),
});

/**
 * The paths the application declares on its store for these modules and the readers to query:
 * `kind`, `build`, `startedAt` and `errors` on visit and process documents. `user` is the auth
 * battery's declaration and the same path, so spreading both declares it once.
 *
 * Example:
 *   const store = createStore({ driver, declare: { ...paths } });
 */
export const paths: Declaration = { user: ['user'], kind: ['kind'], build: ['build'], startedAt: ['startedAt'], errors: ['errors'] };

export { errors, prune, visit, visits } from './readers.ts';
export type { ErrorGroup, VisitRecord, VisitSummary } from './readers.ts';
export type { Batch, Entry, Primitive } from './entries.ts';
