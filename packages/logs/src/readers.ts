// The readers: a visit as plain data, the visits that match, the errors grouped, and the prune.
// Functions over a store, for a script, a harness or a job; no module answers them over the
// wire, because who may read is the application's (design 261).

import type { Store } from '@aweftjs/store';

import { type Primitive, isError } from './entries.ts';

/** A visit or process document as plain data, entries in time order. */
export interface VisitRecord {
	readonly id: string;
	readonly kind: 'visit' | 'process';
	readonly user: string | null;
	readonly build: string | null;
	readonly browser: Readonly<Record<string, Primitive>> | null;
	readonly startedAt: number;
	readonly endedAt: number | null;
	readonly errors: number;
	readonly entries: readonly Readonly<Record<string, Primitive>>[];
}

/** A visit as the index holds it, without opening it. */
export interface VisitSummary {
	readonly id: string;
	readonly user: string | null;
	readonly build: string | null;
	readonly startedAt: number;
	readonly errors: number;
}

/** One message, seen `count` times across `visits` visits on one build. */
export interface ErrorGroup {
	readonly message: string;
	readonly kind: string;
	readonly build: string | null;
	readonly count: number;
	readonly visits: number;
	readonly firstSeen: number;
	readonly lastSeen: number;
}

export interface VisitFilter {
	readonly user?: string;
	readonly build?: string;
	/** Visits started at or after this time. */
	readonly since?: number;
	/** Only visits with at least one error. */
	readonly errors?: boolean;
	readonly limit?: number;
}

export interface ErrorFilter {
	readonly since?: number;
	readonly build?: string;
	/** How many visits to read, newest first. */
	readonly limit?: number;
}

type Where = { readonly field: string; readonly op: 'eq' | 'gt' | 'gte' | 'lt' | 'lte'; readonly value: string | number | boolean | null };

const nameOf = (id: string): string => (id.includes(':') ? id : `visit:${id}`);
const isLog = (doc: string): boolean => doc.startsWith('visit:') || doc.startsWith('process:');

const plain = (value: unknown): Readonly<Record<string, Primitive>> => {
	const out: Record<string, Primitive> = {};
	for (const [key, held] of Object.entries(value as Record<string, unknown>)) {
		if (held === null || typeof held !== 'object') out[key] = held as Primitive;
	}
	return out;
};

/**
 * One visit as plain data, or undefined when there is none by that id.
 *
 * Params:
 *   store: the application's store
 *   id: the visit's id, or a full document name such as `process:<id>`
 *
 * Returns: the document with its entries sorted by `at`.
 *
 * Example:
 *   const seen = await visit(store, 'k9Q2...');
 *   for (const entry of seen?.entries ?? []) console.log(entry.at, entry.kind);
 */
export const visit = async (store: Store, id: string): Promise<VisitRecord | undefined> => {
	const name = nameOf(id);
	if ((await store.head(name)) === 0) return undefined;
	const handle = await store.open(name);
	try {
		const root = handle.root as Record<string, unknown>;
		const entries = (root.entries as unknown[] | undefined ?? []).map(plain);
		entries.sort((a, b) => Number(a.at) - Number(b.at));
		return {
			id: name,
			kind: root.kind as 'visit' | 'process',
			user: (root.user as string | null | undefined) ?? null,
			build: (root.build as string | null | undefined) ?? null,
			browser: root.browser === null || root.browser === undefined ? null : plain(root.browser),
			startedAt: Number(root.startedAt),
			endedAt: (root.endedAt as number | null | undefined) ?? null,
			errors: Number(root.errors ?? 0),
			entries,
		};
	} finally {
		await store.close(handle);
	}
};

const wheres = ({ user, build, since, errors }: VisitFilter): Where[] => {
	// The first condition is the one the index answers, so the most selective goes first.
	const out: Where[] = [];
	if (user !== undefined) out.push({ field: 'user', op: 'eq', value: user });
	if (build !== undefined) out.push({ field: 'build', op: 'eq', value: build });
	if (errors === true) out.push({ field: 'errors', op: 'gt', value: 0 });
	out.push({ field: 'startedAt', op: 'gte', value: since ?? 0 });
	return out;
};

/**
 * The visits that match, newest first, without opening any.
 *
 * Params:
 *   store: the application's store
 *   filter: by user, build, start time, or having errors; `limit` defaults to 100
 *
 * Example:
 *   const theirs = await visits(store, { user, since: Date.now() - 86_400_000 });
 */
export const visits = async (store: Store, filter: VisitFilter = {}): Promise<VisitSummary[]> => {
	const found = await store.find({ where: wheres(filter), sort: { field: 'startedAt', direction: 'desc' }, limit: filter.limit ?? 100 });
	return found.filter(({ doc }) => doc.startsWith('visit:')).map(({ doc, fields }) => ({
		id: doc,
		user: (fields.user as string | null | undefined) ?? null,
		build: (fields.build as string | null | undefined) ?? null,
		startedAt: Number(fields.startedAt),
		errors: Number(fields.errors ?? 0),
	}));
};

/**
 * The errors seen, grouped by message, kind and build, most seen first.
 *
 * Params:
 *   store: the application's store
 *   filter: by start time or build; `limit` is how many visits are read, 200 by default
 *
 * Example:
 *   for (const group of await errors(store, { since })) console.log(group.count, group.message);
 */
export const errors = async (store: Store, filter: ErrorFilter = {}): Promise<ErrorGroup[]> => {
	const where: Where[] = filter.build === undefined ? [] : [{ field: 'build', op: 'eq', value: filter.build }];
	where.push({ field: 'errors', op: 'gt', value: 0 }, { field: 'startedAt', op: 'gte', value: filter.since ?? 0 });
	const found = await store.find({ where, sort: { field: 'startedAt', direction: 'desc' }, limit: filter.limit ?? 200 });
	const groups = new Map<string, { message: string; kind: string; build: string | null; count: number; visits: Set<string>; firstSeen: number; lastSeen: number }>();
	for (const { doc } of found) {
		if (!isLog(doc)) continue;
		const read = await visit(store, doc);
		if (read === undefined) continue;
		for (const entry of read.entries) {
			if (!isError({ kind: String(entry.kind), level: entry.level })) continue;
			const message = String(entry.message ?? '');
			const key = `${read.build ?? ''}\n${String(entry.kind)}\n${message}`;
			const at = Number(entry.at);
			const group = groups.get(key) ?? { message, kind: String(entry.kind), build: read.build, count: 0, visits: new Set<string>(), firstSeen: at, lastSeen: at };
			group.count += 1;
			group.visits.add(doc);
			group.firstSeen = Math.min(group.firstSeen, at);
			group.lastSeen = Math.max(group.lastSeen, at);
			groups.set(key, group);
		}
	}
	return [...groups.values()]
		.map(({ visits: seen, ...group }) => ({ ...group, visits: seen.size }))
		.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
};

/**
 * Remove every visit and process document that started before `olderThan`.
 *
 * Params:
 *   store: the application's store
 *   olderThan: a time in milliseconds since the epoch
 *
 * Returns: how many were removed. A process document of a server that has run longer than
 * that is removed under it, so prune from the module's own sweep, or later than an uptime.
 *
 * Example:
 *   await prune(store, Date.now() - 7 * 86_400_000);
 */
export const prune = async (store: Store, olderThan: number): Promise<number> => {
	let removed = 0;
	for (const { doc } of await store.find({ where: [{ field: 'startedAt', op: 'lt', value: olderThan }] })) {
		if (!isLog(doc)) continue;
		await store.remove(doc);
		removed += 1;
	}
	return removed;
};
