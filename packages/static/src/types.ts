// The content types, as a table of the common web extensions (design 249).
//
// Kept here rather than taken from a dependency: this stack's server has one runtime
// dependency and a table this size is not a reason to add a second. The text types carry
// `charset=utf-8`, because everything this battery is built to serve is written as UTF-8.

const TYPES: Readonly<Record<string, string>> = {
	html: 'text/html; charset=utf-8',
	htm: 'text/html; charset=utf-8',
	css: 'text/css; charset=utf-8',
	js: 'text/javascript; charset=utf-8',
	mjs: 'text/javascript; charset=utf-8',
	json: 'application/json; charset=utf-8',
	map: 'application/json; charset=utf-8',
	webmanifest: 'application/manifest+json; charset=utf-8',
	xml: 'application/xml; charset=utf-8',
	txt: 'text/plain; charset=utf-8',
	md: 'text/markdown; charset=utf-8',
	csv: 'text/csv; charset=utf-8',
	svg: 'image/svg+xml; charset=utf-8',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	ico: 'image/x-icon',
	woff: 'font/woff',
	woff2: 'font/woff2',
	ttf: 'font/ttf',
	otf: 'font/otf',
	wasm: 'application/wasm',
	pdf: 'application/pdf',
	zip: 'application/zip',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	mp4: 'video/mp4',
	webm: 'video/webm',
};

/**
 * The content type of a file, from its extension.
 *
 * Params:
 *   file: the file's path or its name; only what follows the last dot is read
 *
 * Returns: the type from the table, or `application/octet-stream` for an extension the table
 * does not name and for a name with no extension at all.
 *
 * Example:
 *   typeOf('dist/docs/index.html');   // 'text/html; charset=utf-8'
 *   typeOf('dist/notes.rst');         // 'application/octet-stream'
 */
export const typeOf = (file: string): string => {
	const name = file.slice(file.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const extension = dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
	return TYPES[extension] ?? 'application/octet-stream';
};
