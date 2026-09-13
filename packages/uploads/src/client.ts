// The page half: one file posted to `uploads/Receive`, with progress (design 262).
//
// Over `XMLHttpRequest` rather than `fetch`, because `fetch` reports nothing while a body
// leaves the page, and a 25 MB recording with no bar is a page that looks stuck. Nothing here
// touches the socket or the client: an upload is a request on the page's own origin with the
// page's own cookie.

import { codecError } from '@aweftjs/codec';
import type { Refusal } from '@aweftjs/core';

import type { UploadRecord } from './record.ts';

/** What one upload may carry beside the file. */
export interface UploadOptions {
	/** The name to record; the file's own when omitted. */
	readonly name?: string | undefined;
	/** The type to declare; the file's own when omitted, `application/octet-stream` when it has none. */
	readonly type?: string | undefined;
	/** Called as bytes leave the page, with the fraction sent so far, ending at 1. */
	readonly progress?: ((fraction: number) => void) | undefined;
	readonly signal?: AbortSignal | undefined;
}

/** A file as the page holds it: a `Blob`, with the name a `File` carries. */
export interface FileLike {
	readonly size: number;
	readonly type: string;
	readonly name?: string | undefined;
}

/** The part of `XMLHttpRequest` this half uses, so a test hands its own. */
export interface RequestLike {
	open(method: string, url: string): void;
	setRequestHeader(name: string, value: string): void;
	send(body: unknown): void;
	abort(): void;
	readonly status: number;
	readonly responseText: string;
	withCredentials: boolean;
	onload: (() => void) | null;
	onerror: (() => void) | null;
	onabort: (() => void) | null;
	readonly upload: { onprogress: ((event: { readonly lengthComputable: boolean; readonly loaded: number; readonly total: number }) => void) | null };
}

export interface UploadsOptions {
	/** The origin to post to; the page's own when omitted, which is where the cookie is. */
	readonly origin?: string | undefined;
	/** A seam a test hands its own request object through; the global `XMLHttpRequest` otherwise. */
	readonly request?: (() => RequestLike) | undefined;
}

/** A refusal from the route: its status, and the reasons it answered with. */
export interface UploadError extends Error {
	readonly reason: 'refused' | 'network' | 'aborted';
	readonly status: number;
	readonly reasons: readonly Refusal[];
}

export interface Uploads {
	/**
	 * Post one file.
	 *
	 * Rejects with `reason` `refused` and the route's `status` and `reasons` (415 for a type
	 * the server does not take, 413 over its cap, 422 when its `accept` said no, 403 when the
	 * gate did), `network` when no answer came, `aborted` when `signal` fired.
	 */
	upload(file: FileLike, options?: UploadOptions): Promise<UploadRecord>;
	/** The URL an id is served at, on the origin this was made with. */
	url(id: string): string;
}

const reasonsOf = (text: string): readonly Refusal[] => {
	try {
		const body: unknown = JSON.parse(text);
		const reasons: unknown = (body as { reasons?: unknown } | null)?.reasons;
		return Array.isArray(reasons) ? reasons as Refusal[] : [];
	} catch {
		return [];
	}
};

const withStatus = (error: Error, status: number, reasons: readonly Refusal[]): UploadError =>
	Object.assign(error, { status, reasons }) as unknown as UploadError;

const refused = (status: number, reasons: readonly Refusal[]): UploadError =>
	withStatus(codecError('refused', `the upload was answered with ${String(status)}`, 'Read status and reasons; each reason names what to change.'), status, reasons);

const network = (status: number): UploadError =>
	withStatus(codecError('network', status === 0 ? 'no answer came' : `the answer with ${String(status)} was not a record`, 'Try again; check the origin and the route.'), status, []);

const aborted = (): UploadError =>
	withStatus(codecError('aborted', 'the signal fired', 'Nothing to fix; the page cancelled it.'), 0, []);

/**
 * The page's way to post a file.
 *
 * Params:
 *   options: `origin` and the request seam, both optional
 *
 * Returns: `upload` and `url`.
 *
 * Example:
 *   const uploads = createUploads();
 *   const record = await uploads.upload(file, { progress: (f) => bar.set(f) });
 *   avatar.set(record.url);   // '/files/<id>'
 */
export const createUploads = (options: UploadsOptions = {}): Uploads => {
	const origin = options.origin ?? '';
	const make = options.request ?? ((): RequestLike => new (globalThis as unknown as { XMLHttpRequest: new () => RequestLike }).XMLHttpRequest());

	return {
		upload: (file, given = {}) => new Promise<UploadRecord>((resolve, reject) => {
			if (given.signal?.aborted === true) { reject(aborted()); return; }
			const request = make();
			const name = given.name ?? file.name;
			const type = given.type ?? (file.type === '' ? 'application/octet-stream' : file.type);
			request.open('POST', `${origin}/api/uploads`);
			request.setRequestHeader('Content-Type', type);
			if (name !== undefined && name !== '') request.setRequestHeader('X-Upload-Name', encodeURIComponent(name));
			if (origin !== '') request.withCredentials = true;
			request.upload.onprogress = (event) => {
				if (event.lengthComputable && event.total > 0) given.progress?.(event.loaded / event.total);
			};
			request.onload = () => {
				if (request.status === 201) {
					try {
						resolve(JSON.parse(request.responseText) as UploadRecord);
					} catch {
						reject(network(request.status));
					}
					return;
				}
				reject(refused(request.status, reasonsOf(request.responseText)));
			};
			request.onerror = () => { reject(network(0)); };
			request.onabort = () => { reject(aborted()); };
			given.signal?.addEventListener('abort', () => { request.abort(); }, { once: true });
			request.send(file);
		}),
		url: (id) => `${origin}/files/${id}`,
	};
};
