// uploads/Serve: `GET /files/<id>`, for a request no route matched (design 262, over the hook
// of design 248). It declines what is not its own, so it is listed before `static/Files`,
// which declines nothing.

import { codecError } from '@aweftjs/codec';
import type { Refusal } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';

import { KEY_RULE } from '../adapter.ts';
import { json } from '../http.ts';
import type { UploadRecord } from '../record.ts';
import type { Files } from './Files.ts';

export const deps = ['uploads/Files'];

export const defaults = {
	public: true,
	allow: null as Allow | null,
};

/** The application's read rule for one file: nothing to allow, or reasons to refuse. */
export type Allow = (upload: UploadRecord, context: unknown) =>
	{ readonly reasons: readonly Refusal[] } | undefined | void | Promise<{ readonly reasons: readonly Refusal[] } | undefined | void>;

/** The instance: what the gate reads, and the hook the server walks to. */
export interface Serve {
	readonly public: boolean;
	/** Answers `/files/<id>` for a record that exists; declines everything else. */
	request(request: Request, context: unknown): Promise<Response | undefined>;
}

const refuse = (detail: string, fix: string): Error => codecError('invalid-config', `uploads/Serve was given ${detail}`, fix);

const PATH = /^\/files\/([A-Za-z0-9_-]{1,128})$/;

const opaque = (tag: string): string => tag.startsWith('W/') ? tag.slice(2) : tag;

// If-None-Match's own rule: `*` matches whatever there is, and every listed tag compares
// weakly, so a tag a cache stored with `W/` still earns its 304.
const carries = (header: string | null, etag: string): boolean => {
	if (header === null) return false;
	if (header.trim() === '*') return true;
	return header.split(',').some((one) => opaque(one.trim()) === etag);
};

/** `filename*` as RFC 8187 spells it, so a name in any script survives the header. */
const disposition = (name: string | null): string =>
	name === null ? 'inline' : `inline; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

export default ({ config, imports }: ModuleProps): Serve => {
	if (typeof config.public !== 'boolean') {
		throw refuse(`public ${JSON.stringify(config.public)}`, 'Set public to true for files anyone with the URL may read, or false for ones that need a signed-in user.');
	}
	if (config.allow !== null && typeof config.allow !== 'function') {
		throw refuse(`allow ${JSON.stringify(config.allow)}`, 'Give allow a function of (upload, context) answering nothing or { reasons }, or leave it null.');
	}
	const allow = config.allow as Allow | null;
	const files = imports.Files as Files;

	return {
		public: config.public,
		request: async (request, context) => {
			const matched = PATH.exec(new URL(request.url).pathname);
			if (matched === null) return undefined;
			const record = await files.get(matched[1]!);
			if (record === undefined) return undefined;
			if (request.method !== 'GET' && request.method !== 'HEAD') {
				return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
			}
			if (allow !== null) {
				const answer = await allow(record, context);
				if (answer !== undefined && answer !== null && Array.isArray(answer.reasons) && answer.reasons.length > 0) return json(403, { reasons: answer.reasons });
			}
			// The tag is the content: an id never changes what it names, so the hash is strong
			// and the cache may keep it for as long as it likes.
			const etag = `"${record.sha256}"`;
			const headers: Record<string, string> = {
				etag,
				'cache-control': 'public, max-age=31536000, immutable',
				'x-content-type-options': 'nosniff',
				'content-security-policy': 'sandbox',
			};
			if (carries(request.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers });
			headers['content-type'] = record.type;
			headers['content-length'] = String(record.size);
			headers['content-disposition'] = disposition(record.name);
			// A record whose bytes are gone, or whose key is outside the rule and so names no
			// bytes anywhere, is 404 for HEAD as for GET.
			if (!KEY_RULE.test(record.storage.key)) return new Response(null, { status: 404 });
			if (request.method === 'HEAD') {
				return await files.adapter.head(record.storage.key) === undefined ? new Response(null, { status: 404 }) : new Response(null, { status: 200, headers });
			}
			const stream = await files.adapter.open(record.storage.key);
			if (stream === undefined) return new Response(null, { status: 404 });
			return new Response(stream, { status: 200, headers });
		},
	};
};
