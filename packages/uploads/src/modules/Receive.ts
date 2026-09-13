// uploads/Receive: the one route a file is posted to (design 262). Not public unless
// configured so, because a file takes room and a name, and both belong to someone.

import { codecError } from '@aweftjs/codec';
import type { ModuleProps } from '@aweftjs/modules';

import { json } from '../http.ts';
import type { Files, Refused } from './Files.ts';

export const deps = ['uploads/Files'];

export const defaults = {
	public: false,
	concurrent: 16,
};

/** The instance: what the gate reads, and the route. */
export interface Receive {
	readonly public: boolean;
	readonly routes: {
		readonly 'POST /api/uploads': (request: Request, context: unknown) => Promise<Response>;
	};
}

const refuse = (detail: string, fix: string): Error => codecError('invalid-config', `uploads/Receive was given ${detail}`, fix);

const STATUS: Readonly<Record<string, number>> = {
	'unsupported-type': 415,
	'too-large': 413,
	'wrong-length': 400,
	'incomplete': 400,
	'refused': 422,
};

const answer = (status: number, code: string, message: string): Response => json(status, { reasons: [{ code, message }] });

/** The type as declared, its parameters dropped and its case folded; undefined when there is none. */
const typeOf = (header: string | null): string | undefined => {
	const type = header?.split(';')[0]?.trim().toLowerCase();
	return type === undefined || type === '' || !type.includes('/') ? undefined : type;
};

const lengthOf = (header: string | null): number | undefined => {
	if (header === null || !/^\d+$/.test(header.trim())) return undefined;
	return Number(header.trim());
};

export default ({ config, imports }: ModuleProps): Receive => {
	if (typeof config.public !== 'boolean') {
		throw refuse(`public ${JSON.stringify(config.public)}`, 'Set public to true for a route anyone may post to, or false for one that needs a signed-in user.');
	}
	if (typeof config.concurrent !== 'number' || !(config.concurrent > 0)) {
		throw refuse(`concurrent ${JSON.stringify(config.concurrent)}`, 'Give concurrent the number of uploads to hold in flight at once, above zero.');
	}
	const concurrent = config.concurrent;
	const files = imports.Files as Files;
	let inFlight = 0;

	return {
		public: config.public,
		routes: {
			'POST /api/uploads': async (request, context) => {
				if (inFlight >= concurrent) return answer(429, 'busy', `${String(concurrent)} uploads are already in flight`);
				const type = typeOf(request.headers.get('content-type'));
				if (type === undefined) return answer(415, 'unsupported-type', 'send the file\'s type as Content-Type');
				const size = lengthOf(request.headers.get('content-length'));
				if (size === undefined) return answer(411, 'no-length', 'send the byte length as Content-Length');
				let name: string | null = null;
				const named = request.headers.get('x-upload-name');
				if (named !== null && named !== '') {
					try {
						name = decodeURIComponent(named);
					} catch {
						return answer(400, 'bad-name', 'X-Upload-Name is not percent-encoded UTF-8');
					}
				}
				const stream = request.body ?? new ReadableStream<Uint8Array>({ start: (controller) => { controller.close(); } });
				inFlight += 1;
				try {
					const record = await files.receive(stream, { type, name, size }, context);
					return json(201, record);
				} catch (error) {
					const { reason, reasons } = error as Partial<Refused>;
					const status = reason === undefined ? undefined : STATUS[reason];
					if (status === undefined || reasons === undefined) throw error;
					return json(status, { reasons });
				} finally {
					inFlight -= 1;
				}
			},
		},
	};
};
