// The uploads battery: a source of three server modules, the paths the application declares for
// them, the directory adapter, and the readers any process imports (design 262).

import { fromBundle } from '@aweftjs/modules';
import type { Source } from '@aweftjs/modules';
import type { Declaration } from '@aweftjs/store';

/**
 * The three modules, for `sources`: `uploads/Files` keeps the bytes and the records,
 * `uploads/Receive` answers `POST /api/uploads`, `uploads/Serve` answers `GET /files/<id>`
 * (design 262).
 *
 * Params: none. It is a value, listed beside the application's own sources.
 *
 * Returns: the source. List it before `static`, whose module answers every request it is
 * asked and would answer `/files/<id>` with the 404 page. The application's own source goes
 * first, and a file there named `modules/uploads/Files.ts` exporting only `config` configures
 * the keeper.
 *
 * Example:
 *   const store = createStore({ driver, declare: { ...auth.paths, ...uploads.paths } });
 *   const server = createServer({ sources: [own, uploads, files, auth], store, gate: 'auth/Gate', listener });
 *   // modules/uploads/Files.ts, in `own`:
 *   export const config = { storage: directory('var/uploads'), types: ['image/png', 'audio/mpeg'], maxBytes: { image: 5e6, audio: 25e6 } };
 */
export const uploads: Source = fromBundle({
	'./uploads/Files.ts': () => import('./modules/Files.ts'),
	'./uploads/Receive.ts': () => import('./modules/Receive.ts'),
	'./uploads/Serve.ts': () => import('./modules/Serve.ts'),
});

/**
 * The paths the application declares on its store for the readers to query: `kind`, `user`,
 * `sha256`, `type` and `at` on upload records. `user` is the auth battery's declaration and
 * the same path, so spreading both declares it once.
 *
 * Example:
 *   const store = createStore({ driver, declare: { ...paths } });
 */
export const paths: Declaration = { kind: ['kind'], user: ['user'], sha256: ['sha256'], type: ['type'], at: ['at'] };

export { directory } from './directory.ts';
export { keyOf } from './adapter.ts';
export type { Adapter, PutOptions } from './adapter.ts';
export { records, upload } from './readers.ts';
export type { UploadFilter } from './readers.ts';
export type { Primitive, UploadRecord } from './record.ts';
export type { Accept, Files, PutFields, ReceiveFields, Refused, Upload } from './modules/Files.ts';
export type { Allow, Serve } from './modules/Serve.ts';
export type { Receive } from './modules/Receive.ts';
