// static/Files: a directory of files, answered for every request no route matched
// (design 249, over the hook of design 248).

import { join, resolve } from 'node:path';

import { codecError } from '@aweftjs/codec';
import type { ModuleProps } from '@aweftjs/modules';

import { pathOf } from '../rule.ts';
import { answered, cacheFor, fileAt, fileOf, served } from '../serve.ts';

export const defaults = {
	dir: 'dist',
	unknown: '404',
	headers: {},
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

const table = (held: unknown): Readonly<Record<string, string>> => {
	if (held === null || typeof held !== 'object' || Array.isArray(held)) {
		throw refuse(`headers ${JSON.stringify(held)}`,
			'Give headers a Cache-Control string per path prefix, such as { "assets/": "public, max-age=31536000" }.');
	}
	for (const value of Object.values(held)) {
		if (typeof value !== 'string') {
			throw refuse(`a headers value that is not a string: ${JSON.stringify(value)}`,
				'Give headers a Cache-Control string per path prefix, such as { "assets/": "public, max-age=31536000" }.');
		}
	}
	return held as Readonly<Record<string, string>>;
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
	// Resolved once, from the working directory, so a program that changes its own directory
	// later still serves what it was configured with.
	const dir = resolve(config.dir);
	const shell = config.unknown === 'shell';

	// One page answers every URL with no file. It is read on each of them rather than held,
	// because nothing here keeps a listing and a rebuilt site replaces that page too.
	const unknown = async (request: Request): Promise<Response> => {
		const found = await fileOf(join(dir, shell ? 'shell.html' : '404.html'));
		if (found === undefined) return new Response(null, { status: 404 });
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
				return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
			}
			return served(request, found, cacheFor(headers, path));
		},
	};
};
