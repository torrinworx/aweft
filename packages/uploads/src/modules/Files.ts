// uploads/Files: the keeper. The adapter the bytes go to, the ids, the records, `put` for a
// module, `receive` for the route, and `remove` (design 262).

import { createHash } from 'node:crypto';

import { codecError, createId, idToText } from '@aweftjs/codec';
import { atomic } from '@aweftjs/core';
import type { Refusal } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';
import type { Store } from '@aweftjs/store';

import { type Adapter, KEY_RULE, collect, keyOf, streamOf } from '../adapter.ts';
import { directory } from '../directory.ts';
import { type Root, type UploadRecord, docOf, flat, recordOf, writeRoot } from '../record.ts';
import { SNIFF_BYTES, matches } from '../sniff.ts';

export const defaults = {
	storage: null as Adapter | null,
	types: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
	maxBytes: 10 * 1024 * 1024,
	accept: null as Accept | null,
};

/** What `accept` is handed: the file as it will be recorded, and a way to read its bytes. */
export interface Upload {
	readonly id: string;
	readonly name: string | null;
	readonly type: string;
	readonly size: number;
	readonly sha256: string;
	readonly user: string | null;
	/** The bytes, read back from storage. */
	bytes(): Promise<Uint8Array>;
}

/** The application's rule: nothing to accept, or reasons to refuse. A throw is a defect. */
export type Accept = (upload: Upload, context: unknown) =>
	{ readonly reasons: readonly Refusal[] } | undefined | void | Promise<{ readonly reasons: readonly Refusal[] } | undefined | void>;

/** What a module hands `put`. */
export interface PutFields {
	readonly type: string;
	readonly name?: string | null | undefined;
	/** Required when `bytes` is a stream, because a bucket asks for the length up front. */
	readonly size?: number | undefined;
	readonly user?: string | null | undefined;
	readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

/** What the route hands `receive`: the request's word for the file. */
export interface ReceiveFields {
	readonly type: string;
	readonly name: string | null;
	readonly size: number;
}

/** A refusal thrown by `receive`, carrying the reasons the answer should say. */
export interface Refused extends Error {
	readonly reason: string;
	readonly reasons: readonly Refusal[];
}

/** The instance: the adapter and the rules, and what a module and the route call. */
export interface Files {
	readonly adapter: Adapter;
	readonly types: readonly string[];
	/** The cap for a type, from `maxBytes` by family. */
	capFor(type: string): number;
	/** The trusted path: no rule runs. Bytes in, record out. */
	put(bytes: Uint8Array | ReadableStream<Uint8Array>, fields: PutFields): Promise<UploadRecord>;
	/**
	 * The checked path: the type rule, the cap, the first bytes, then `accept`, then the record.
	 *
	 * Throws: `unsupported-type`, `too-large`, `wrong-length`, `refused`, each with `reasons`;
	 * whatever `accept` threw, as it was.
	 */
	receive(stream: ReadableStream<Uint8Array>, fields: ReceiveFields, context: unknown): Promise<UploadRecord>;
	get(id: string): Promise<UploadRecord | undefined>;
	/** The record and a stream over its bytes, or undefined when either is missing. */
	open(id: string): Promise<{ readonly record: UploadRecord; readonly stream: ReadableStream<Uint8Array> } | undefined>;
	/** Bytes first, then the record. True when there was a record. */
	remove(id: string): Promise<boolean>;
	stop(): Promise<void>;
}

const refuse = (detail: string, fix: string): Error => codecError('invalid-config', `uploads/Files was given ${detail}`, fix);

const isAdapter = (held: unknown): held is Adapter => {
	const a = held as Partial<Adapter> | null;
	return a !== null && typeof a === 'object' && typeof a.name === 'string'
		&& typeof a.put === 'function' && typeof a.open === 'function' && typeof a.head === 'function' && typeof a.remove === 'function';
};

const typesOf = (held: unknown): readonly string[] => {
	if (!Array.isArray(held) || held.length === 0 || !held.every((one) => typeof one === 'string' && one.includes('/'))) {
		throw refuse(`types ${JSON.stringify(held)}`, 'Give types a list of MIME types, such as ["image/png", "audio/mpeg"].');
	}
	return held as string[];
};

const positive = (held: unknown): held is number => typeof held === 'number' && held > 0 && Number.isFinite(held);

const capsOf = (held: unknown): ((type: string) => number) => {
	if (positive(held)) return () => held;
	if (held !== null && typeof held === 'object' && !Array.isArray(held) && Object.values(held).every(positive)) {
		const byFamily = held as Record<string, number>;
		return (type) => {
			const cap = byFamily[type.slice(0, type.indexOf('/'))] ?? byFamily.default;
			if (cap === undefined) throw refuse(`maxBytes with no entry for ${type} and no default`, 'Add a default to maxBytes, or an entry for that family.');
			return cap;
		};
	}
	throw refuse(`maxBytes ${JSON.stringify(held)}`, 'Give maxBytes a number of bytes, or a map by family such as { image: 5000000, default: 25000000 }.');
};

const withReasons = (reason: string, detail: string, fix: string, reasons: readonly Refusal[]): Refused =>
	Object.assign(codecError(reason, detail, fix), { reasons });

const unsupported = (type: string): Refused =>
	withReasons('unsupported-type', `${type} is not a type this application takes`, 'Send one of the types uploads/Files is configured with, and bytes that are that type.',
		[{ code: 'unsupported-type', message: `${type} is not accepted` }]);

const tooLarge = (cap: number): Refused =>
	withReasons('too-large', `the body is over the ${String(cap)} byte cap`, 'Send a smaller file, or raise maxBytes in uploads/Files\'s config.',
		[{ code: 'too-large', message: `over the ${String(cap)} byte cap` }]);

const incomplete = (): Refused =>
	withReasons('incomplete', 'the body ended before its declared length', 'Send the whole body, or send Content-Length equal to what is sent.',
		[{ code: 'incomplete', message: 'the body ended early' }]);

// A MIME type as a header carries it: two tokens and a slash, nothing a header would refuse.
const TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

/** The first `limit` code points of a name, never cutting a pair, so the store takes it. */
const cut = (name: string, limit: number): string => {
	const points = [...name];
	return points.length > limit ? points.slice(0, limit).join('') : name;
};

/**
 * One reader over a request body: the first bytes read ahead, a counted and hashed stream over
 * the rest, and a bounded drain for a refusal, so a proxy or a browser still mid-send gets the
 * answer rather than a closed socket. Nothing here holds more than one chunk.
 */
const bodyOf = (source: ReadableStream<Uint8Array>): {
	peek(bytes: number): Promise<Uint8Array>;
	measured(cap: number): { stream: ReadableStream<Uint8Array>; count(): number; digest(): string };
	drain(limit: number): Promise<void>;
} => {
	const reader = source.getReader();
	const ahead: Uint8Array[] = [];
	let ended = false;
	const next = async (): Promise<Uint8Array | undefined> => {
		if (ahead.length > 0) return ahead.shift();
		if (ended) return undefined;
		const { value, done } = await reader.read();
		if (done) { ended = true; return undefined; }
		return value;
	};
	return {
		peek: async (bytes) => {
			const chunks: Uint8Array[] = [];
			let length = 0;
			while (length < bytes) {
				let chunk: Uint8Array | undefined;
				try {
					chunk = await next();
				} catch {
					throw incomplete();
				}
				if (chunk === undefined) break;
				chunks.push(chunk);
				length += chunk.byteLength;
			}
			ahead.unshift(...chunks);
			const head = new Uint8Array(Math.min(length, bytes));
			let at = 0;
			for (const chunk of chunks) {
				const take = Math.min(chunk.byteLength, head.byteLength - at);
				head.set(chunk.subarray(0, take), at);
				at += take;
				if (at === head.byteLength) break;
			}
			return head;
		},
		measured: (cap) => {
			const hash = createHash('sha256');
			let count = 0;
			const stream = new ReadableStream<Uint8Array>({
				pull: async (controller) => {
					let chunk: Uint8Array | undefined;
					try {
						chunk = await next();
					} catch {
						// The sender's socket failed mid-body: the sender's, not the adapter's.
						controller.error(incomplete());
						return;
					}
					if (chunk === undefined) { controller.close(); return; }
					count += chunk.byteLength;
					if (count > cap) { controller.error(tooLarge(cap)); return; }
					hash.update(chunk);
					controller.enqueue(chunk);
				},
			});
			return { stream, count: () => count, digest: () => hash.digest('hex') };
		},
		drain: async (limit) => {
			let read = 0;
			try {
				while (read < limit) {
					const chunk = await next();
					if (chunk === undefined) return;
					read += chunk.byteLength;
				}
			} catch {
				// The sender went away; there is nothing left to discard.
				return;
			}
			await reader.cancel().catch(() => undefined);
		},
	};
};

const idText = (): string => idToText(createId());

export default async (props: ModuleProps): Promise<Files> => {
	const { config } = props;
	const store = props.store as Store | undefined;
	if (store === undefined || typeof store.open !== 'function') {
		throw codecError('no-store', 'the loader needs a store in its props', 'Pass store to createServer, or props: { store } to a loader you build yourself.');
	}
	if (config.storage !== null && !isAdapter(config.storage)) {
		throw refuse(`storage ${JSON.stringify(config.storage)}`, 'Give storage an adapter: directory(path), s3(options), or one of your own.');
	}
	const adapter: Adapter = config.storage === null ? directory('uploads') : config.storage;
	const types = typesOf(config.types);
	const capFor = capsOf(config.maxBytes);
	if (config.accept !== null && typeof config.accept !== 'function') {
		throw refuse(`accept ${JSON.stringify(config.accept)}`, 'Give accept a function of (upload, context) answering nothing or { reasons }, or leave it null.');
	}
	const accept = config.accept as Accept | null;
	for (const type of types) capFor(type);

	/** The record, written whole in one commit and closed. */
	const written = async (id: string, fields: Omit<Root, 'kind'>): Promise<UploadRecord> => {
		const doc = docOf(id);
		const handle = await store.open(doc);
		try {
			atomic(() => { writeRoot(handle.root as Root, fields); });
			await store.settled(handle);
			await store.truncate(doc, 1);
			return recordOf(id, handle.root)!;
		} finally {
			await store.close(handle);
		}
	};

	const get = async (id: string): Promise<UploadRecord | undefined> => {
		const doc = docOf(id);
		if (await store.head(doc) === 0) return undefined;
		const handle = await store.open(doc);
		try {
			return recordOf(id, handle.root);
		} finally {
			await store.close(handle);
		}
	};

	const remove = async (id: string): Promise<boolean> => {
		const record = await get(id);
		if (record === undefined) return false;
		// A record whose key is outside the rule names no bytes anywhere; the record still goes.
		if (KEY_RULE.test(record.storage.key)) await adapter.remove(record.storage.key);
		await store.remove(docOf(id));
		return true;
	};

	const nameOf = (name: string | null | undefined): string | null => {
		if (name === null || name === undefined || name === '') return null;
		return cut(name, 255);
	};

	/** The record after the bytes; when the store refuses it, the bytes go too, so nothing is orphaned. */
	const recorded = async (id: string, key: string, fields: Omit<Root, 'kind'>): Promise<UploadRecord> => {
		try {
			return await written(id, fields);
		} catch (error) {
			await adapter.remove(key).catch(() => undefined);
			throw error;
		}
	};

	const put = async (bytes: Uint8Array | ReadableStream<Uint8Array>, fields: PutFields): Promise<UploadRecord> => {
		if (typeof fields.type !== 'string' || !TYPE.test(fields.type)) {
			throw codecError('invalid-put', `put was given type ${JSON.stringify(fields.type)}`, 'Give put a MIME type such as "image/png".');
		}
		const source = bytes instanceof Uint8Array ? streamOf(bytes) : bytes;
		const size = bytes instanceof Uint8Array ? bytes.byteLength : fields.size;
		if (!(typeof size === 'number' && size >= 0 && Number.isFinite(size))) {
			throw codecError('invalid-put', 'put was given a stream and no size', 'Give put the byte length beside a stream, or hand it the bytes.');
		}
		const id = idText();
		const key = keyOf(id);
		const counted = bodyOf(source).measured(Number.POSITIVE_INFINITY);
		try {
			await adapter.put(key, counted.stream, { type: fields.type, size });
		} catch (error) {
			await adapter.remove(key).catch(() => undefined);
			throw error;
		}
		return recorded(id, key, {
			user: typeof fields.user === 'string' ? fields.user : null,
			name: nameOf(fields.name),
			type: fields.type,
			size: counted.count(),
			sha256: counted.digest(),
			at: Date.now(),
			storage: { adapter: adapter.name, key },
			meta: fields.meta === undefined ? null : flat(fields.meta),
		});
	};

	const receive = async (stream: ReadableStream<Uint8Array>, fields: ReceiveFields, context: unknown): Promise<UploadRecord> => {
		const { type, size } = fields;
		const body = bodyOf(stream);
		// A refusal reads and discards what is still arriving, up to twice the cap, so the sender
		// hears the answer; past that the socket is cut.
		const refused = async (error: Refused, cap: number): Promise<never> => {
			await body.drain(Math.max(2 * cap, 1_048_576));
			throw error;
		};
		if (!types.includes(type)) return refused(unsupported(type), 0);
		const cap = capFor(type);
		if (size > cap) return refused(tooLarge(cap), cap);
		if (!matches(type, await body.peek(SNIFF_BYTES))) return refused(unsupported(type), cap);

		const id = idText();
		const key = keyOf(id);
		const counted = body.measured(cap);
		const dropped = async (): Promise<void> => { await adapter.remove(key).catch(() => undefined); };
		try {
			await adapter.put(key, counted.stream, { type, size });
		} catch (error) {
			await dropped();
			const reason = (error as { reason?: unknown }).reason;
			// The cap and the sender's own cut are refusals with a status; anything else is the
			// adapter's failure and is thrown as it is, so it is reported and never read as 413.
			if (reason === 'too-large') return refused(error as Refused, cap);
			throw error;
		}
		if (counted.count() !== size) {
			await dropped();
			throw withReasons('wrong-length', `the body was ${String(counted.count())} bytes, not the ${String(size)} declared`,
				'Send Content-Length equal to the number of bytes in the body.',
				[{ code: 'wrong-length', message: `${String(counted.count())} bytes arrived, ${String(size)} were declared` }]);
		}
		const sha256 = counted.digest();
		const user: unknown = (context as { user?: unknown } | null)?.user;
		const upload: Upload = {
			id, name: nameOf(fields.name), type, size, sha256,
			user: typeof user === 'string' ? user : null,
			bytes: async () => {
				const opened = await adapter.open(key);
				return opened === undefined ? new Uint8Array(0) : collect(opened);
			},
		};
		if (accept !== null) {
			let answer: { readonly reasons: readonly Refusal[] } | undefined | void;
			try {
				answer = await accept(upload, context);
			} catch (error) {
				await dropped();
				throw error;
			}
			if (answer !== undefined && answer !== null && Array.isArray(answer.reasons) && answer.reasons.length > 0) {
				await dropped();
				throw withReasons('refused', 'the application refused the upload', 'Read the reasons; they are the application\'s own.', answer.reasons);
			}
		}
		return recorded(id, key, {
			user: upload.user, name: upload.name, type, size, sha256, at: Date.now(),
			storage: { adapter: adapter.name, key }, meta: null,
		});
	};

	return {
		adapter,
		types,
		capFor,
		put,
		receive,
		get,
		open: async (id) => {
			const record = await get(id);
			if (record === undefined) return undefined;
			const stream = await adapter.open(record.storage.key);
			return stream === undefined ? undefined : { record, stream };
		},
		remove,
		stop: async () => {},
	};
};
