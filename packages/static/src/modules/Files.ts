// static/Files: a directory of files, answered for every request no route matched
// (design 249, over the hook of design 248).

import { join, resolve } from 'node:path';

import { codecError } from '@aweftjs/codec';
import type { ModuleProps } from '@aweftjs/modules';

import { pathOf } from '../rule.ts';
import { type Extra, NOSNIFF, answered, fileAt, fileOf, headersFor, notFound, served } from '../serve.ts';

export const defaults = {
	dir: 'dist',
	unknown: '404',
	headers: {},
	notPages: [],
	public: true,
};

/** The instance: what the gate reads, and the hook the server walks to. */
export interface Files {
	/** True unless the configuration says otherwise, so a gate that reads it serves anyone. */
	readonly public: boolean;
	/** The rule, run for a request no route matched. It always answers. */
	request(request: Request): Promise<Response>;
}

const refuse = (detail: string, fix: string): Error =>
	codecError('invalid-config', `static/Files was given ${detail}`, fix);

const SHAPE_FIX = 'Give headers a Cache-Control string, or an object of header names to values, per path prefix, such as { "room/": { "access-control-allow-origin": "*" } }.';

// What this module writes itself on every file, so a configured value would contradict it or,
// for nosniff, take away what design 276 promises.
const OWNED = new Set(['content-type', 'content-length', 'etag', 'x-content-type-options']);

// One prefix's headers, lowercased. A name or value `Headers` itself would refuse is refused
// here, at load, rather than turning every request under the prefix into a 500.
const headerSet = (prefix: string, held: object): Extra => {
	const set: Record<string, string> = {};
	for (const [name, value] of Object.entries(held)) {
		const lower = name.toLowerCase();
		if (OWNED.has(lower)) {
			throw refuse(`the header ${name} for ${JSON.stringify(prefix)}, which it writes itself`,
				'Leave content-type, content-length, etag and x-content-type-options out of headers; static/Files writes them for every file.');
		}
		let valid = typeof value === 'string';
		if (valid) {
			try {
				new Headers([[lower, value as string]]);
			} catch {
				valid = false;
			}
		}
		if (!valid) {
			throw refuse(`the header ${JSON.stringify(name)} with the value ${JSON.stringify(value)} for ${JSON.stringify(prefix)}`,
				'Name each header as HTTP spells one, and give it a string on one line.');
		}
		set[lower] = value as string;
	}
	return set;
};

const table = (held: unknown): Readonly<Record<string, Extra>> => {
	if (held === null || typeof held !== 'object' || Array.isArray(held)) {
		throw refuse(`headers ${JSON.stringify(held)}`, SHAPE_FIX);
	}
	const out: Record<string, Extra> = {};
	for (const [prefix, value] of Object.entries(held)) {
		if (typeof value === 'string') {
			out[prefix] = headerSet(prefix, { 'cache-control': value });
		} else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
			out[prefix] = headerSet(prefix, value as object);
		} else {
			throw refuse(`a headers value that is neither a string nor an object: ${JSON.stringify(value)}`, SHAPE_FIX);
		}
	}
	return out;
};

// A prefix written with its leading slash would match nothing, and an API path would get the
// shell, which is the answer this setting exists to stop, so it is refused rather than ignored.
const prefixes = (held: unknown): readonly string[] => {
	if (!Array.isArray(held) || held.some((one) => typeof one !== 'string' || one.startsWith('/'))) {
		throw refuse(`notPages ${JSON.stringify(held)}`,
			'Give notPages a list of path prefixes without their leading slash, such as ["api/", "files/"].');
	}
	return held as readonly string[];
};

export default ({ config }: ModuleProps): Files => {
	if (typeof config.dir !== 'string' || config.dir === '') {
		throw refuse(`dir ${JSON.stringify(config.dir)}`, 'Set dir to the directory to serve, such as "dist".');
	}
	if (config.unknown !== '404' && config.unknown !== 'shell') {
		throw refuse(`unknown ${JSON.stringify(config.unknown)}`, 'Set unknown to "404" or to "shell".');
	}
	if (typeof config.public !== 'boolean') {
		throw refuse(`public ${JSON.stringify(config.public)}`, 'Set public to true for a site anyone may read, or false for a private one.');
	}
	const headers = table(config.headers);
	const notPages = prefixes(config.notPages);
	// Resolved once, from the working directory, so a program that changes its own directory
	// later still serves what it was configured with.
	const dir = resolve(config.dir);
	const shell = config.unknown === 'shell';

	// One page answers every URL with no file. It is read on each of them rather than held,
	// because nothing here keeps a listing and a rebuilt site replaces that page too. A URL under
	// a prefix that is not a page gets neither page (design 313). The prefix is matched against
	// the decoded path, as a `headers` prefix is, and against the path as written when it does not
	// decode, so that path still gets the 404 and not the shell.
	const unknown = async (request: Request): Promise<Response> => {
		const written = new URL(request.url).pathname;
		let path = written;
		try {
			path = decodeURIComponent(written);
		} catch {
			// Matched as written.
		}
		const bare = path.replace(/^\/+/, '');
		if (notPages.some((prefix) => bare.startsWith(prefix))) return notFound(request);
		const found = await fileOf(join(dir, shell ? 'shell.html' : '404.html'));
		if (found === undefined) return new Response(null, { status: 404, headers: NOSNIFF });
		return answered(request, found, shell ? 200 : 404);
	};

	return {
		public: config.public,
		request: async (request) => {
			const path = pathOf(request.url);
			if (path === undefined) return unknown(request);

			const found = await fileAt(dir, path);
			if (found === undefined) return unknown(request);
			// 405 only over a file. On a URL with no file it would say the URL exists, and what
			// exists is the files' word, not this module's.
			if (request.method !== 'GET' && request.method !== 'HEAD') {
				return new Response(null, { status: 405, headers: { ...NOSNIFF, allow: 'GET, HEAD' } });
			}
			return served(request, found, headersFor(headers, path));
		},
	};
};
