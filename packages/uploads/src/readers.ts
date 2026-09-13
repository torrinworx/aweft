// The readers: one upload as plain data, and the uploads that match. Functions over a store,
// for a script, a harness or a job; no module answers them over the wire (design 262).

import type { Store } from '@aweftjs/store';

import { type UploadRecord, docOf, recordOf } from './record.ts';

export interface UploadFilter {
	readonly user?: string;
	readonly sha256?: string;
	readonly type?: string;
	/** Uploads made at or after this time. */
	readonly since?: number;
	readonly limit?: number;
}

type Where = { readonly field: string; readonly op: 'eq' | 'gt' | 'gte' | 'lt' | 'lte'; readonly value: string | number | boolean | null };

const idOf = (doc: string): string => doc.startsWith('upload:') ? doc.slice('upload:'.length) : doc;

/**
 * One upload as plain data, or undefined when there is none by that id.
 *
 * Params:
 *   store: the application's store
 *   id: the upload's id, or its full document name `upload:<id>`
 *
 * Returns: the record, with `url` where `uploads/Serve` answers it.
 *
 * Example:
 *   const record = await upload(store, 'k3jd8sQ2pL0aZx9C');
 */
export const upload = async (store: Store, id: string): Promise<UploadRecord | undefined> => {
	const bare = idOf(id);
	const doc = docOf(bare);
	if (await store.head(doc) === 0) return undefined;
	const handle = await store.open(doc);
	try {
		return recordOf(bare, handle.root);
	} finally {
		await store.close(handle);
	}
};

/**
 * The uploads that match, newest first.
 *
 * Params:
 *   store: the application's store, with `paths` declared on it
 *   filter: `user`, `sha256`, `type`, `since`, `limit` (100 unless given)
 *
 * Returns: the records, newest first. Every record is opened to be read, so `limit` bounds
 * the reads.
 *
 * Example:
 *   const mine = await records(store, { user, limit: 20 });
 *   const same = await records(store, { sha256 });
 */
export const records = async (store: Store, filter: UploadFilter = {}): Promise<UploadRecord[]> => {
	const where: Where[] = [{ field: 'kind', op: 'eq', value: 'upload' }];
	if (filter.user !== undefined) where.push({ field: 'user', op: 'eq', value: filter.user });
	if (filter.sha256 !== undefined) where.push({ field: 'sha256', op: 'eq', value: filter.sha256 });
	if (filter.type !== undefined) where.push({ field: 'type', op: 'eq', value: filter.type });
	if (filter.since !== undefined) where.push({ field: 'at', op: 'gte', value: filter.since });
	const found = await store.find({ where, sort: { field: 'at', direction: 'desc' }, limit: filter.limit ?? 100 });
	const out: UploadRecord[] = [];
	for (const { doc } of found) {
		const record = await upload(store, doc);
		if (record !== undefined) out.push(record);
	}
	return out;
};
