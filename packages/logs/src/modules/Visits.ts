// logs/Visits: the keeper. The visit and process documents, the entries appended to them, the
// binding of a connection to a visit, `write` for any module, the caps, and the sweep
// (design 261).

import { codecError, createId, idToText } from '@aweftjs/codec';
import { atomic, createArray, createObject } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';
import type { Handle, Store } from '@aweftjs/store';

import { type Batch, type Entry, type Primitive, entryOf, flat, full, isError, trim } from '../entries.ts';
import { storeOf } from '../props.ts';

export const defaults = {
	keep: 30,
	sweepMs: 3_600_000,
	batch: 500,
	entry: 4096,
	perVisit: 10_000,
	batchesPerMinute: 60,
	visitsPerMinute: 600,
	idleMs: 60_000,
	build: null as string | null,
};

/** The root of a visit or process document, as the module writes it. */
interface Root {
	kind: 'visit' | 'process';
	user: string | null;
	build: string | null;
	browser: Record<string, Primitive> | null;
	startedAt: number;
	endedAt: number | null;
	errors: number;
	entries: Record<string, Primitive>[];
}

/** A document this module holds open, and the timer that lets a visit go. */
interface Holding {
	readonly handle: Handle;
	idle: ReturnType<typeof setTimeout> | undefined;
}

/** The instance: what the gate reads, the page's call, and what a module calls. */
export interface Visits {
	readonly public: true;
	/** This process's document, `process:<id>`; a fresh one once it fills. */
	readonly process: string;
	/** Bind the asking connection to a visit: `{ visit }` from the page, once per socket. */
	call(args: unknown, context: unknown): { bound: true };
	/**
	 * Keep a batch from a page.
	 *
	 * Throws: `malformed` when the body is not a batch; `capped` over a cap.
	 */
	record(batch: unknown, context: unknown): Promise<{ kept: number }>;
	/**
	 * A module's own record: `{ kind, ...fields }`, into the visit bound to `context`, or into
	 * this process's document without one. An entry with no `kind` is dropped.
	 */
	write(entry: Readonly<Record<string, unknown>>, context?: unknown): Promise<void>;
	/** The visit a context is bound to, by reference or by the session it carries. */
	visitOf(context: unknown): string | undefined;
	/** Remove every visit and process document older than `keep`, this process's own excepted. */
	sweep(): Promise<number>;
	stop(): Promise<void>;
}

const refuse = (detail: string, fix: string): Error => codecError('invalid-config', `logs/Visits was given ${detail}`, fix);

const numberOf = (config: Readonly<Record<string, unknown>>, key: keyof typeof defaults): number => {
	const held: unknown = config[key];
	if (typeof held !== 'number' || !(held > 0)) throw refuse(`${key} ${JSON.stringify(held)}`, 'Give that setting a number above zero.');
	return held;
};

const over = (what: string): Error =>
	codecError('capped', `${what} is over the cap`, 'Send fewer, or raise the cap in logs/Visits\'s config.');

const malformed = (detail: string): Error =>
	codecError('malformed', `logs/Visits was handed ${detail}`, 'Send { visit, entries: [{ at, kind, ... }] } as JSON.');

/** A count per key inside a one-minute window. */
const perMinute = (): { allow(key: string, max: number): boolean } => {
	const counts = new Map<string, { since: number; count: number }>();
	return {
		allow: (key, max) => {
			const now = Date.now();
			// Drop windows that have passed before this one grows without bound: the map is keyed
			// by visit id, which the caller cannot be trusted not to vary forever.
			if (counts.size > 4096) for (const [k, v] of counts) if (now - v.since >= 60_000) counts.delete(k);
			const held = counts.get(key);
			if (held === undefined || now - held.since >= 60_000) {
				counts.set(key, { since: now, count: 1 });
				return true;
			}
			held.count += 1;
			return held.count <= max;
		},
	};
};

const idText = (): string => idToText(createId());

export default async (props: ModuleProps): Promise<Visits> => {
	const { config } = props;
	const store: Store = storeOf(props);
	const keep = numberOf(config, 'keep');
	const sweepMs = numberOf(config, 'sweepMs');
	const batch = numberOf(config, 'batch');
	const entryBytes = numberOf(config, 'entry');
	const perVisit = numberOf(config, 'perVisit');
	const batchesPerMinute = numberOf(config, 'batchesPerMinute');
	const visitsPerMinute = numberOf(config, 'visitsPerMinute');
	const idleMs = numberOf(config, 'idleMs');
	if (config.build !== null && typeof config.build !== 'string') {
		throw refuse(`build ${JSON.stringify(config.build)}`, 'Give build a string, such as a commit hash, or null.');
	}
	const build = config.build as string | null;

	let process = `process:${idText()}`;
	const held = new Map<string, Holding>();
	// Two first writes to one document in the same tick would each open it, and the store would
	// count two opens against the one close; the second joins the first's open instead.
	const opening = new Map<string, Promise<Holding>>();
	const bound = new WeakMap<object, string>();
	// The latest visit each session sent a batch from, so a request with that cookie lands there.
	// Bounded, oldest out, because sessions are as many as the application has.
	const bySession = new Map<string, string>();
	const remember = (session: string, name: string): void => {
		bySession.delete(session);
		bySession.set(session, name);
		if (bySession.size > 10_000) bySession.delete(bySession.keys().next().value!);
	};
	const batches = perMinute();
	const visits = perMinute();

	/** The document, opened once and held; a visit is let go of `idleMs` after its last use. */
	const opened = (name: string): Promise<Holding> => {
		const holding = held.get(name);
		if (holding !== undefined) {
			if (holding.idle !== undefined) { clearTimeout(holding.idle); holding.idle = undefined; }
			return Promise.resolve(holding);
		}
		const inFlight = opening.get(name);
		if (inFlight !== undefined) return inFlight;
		const building = (async (): Promise<Holding> => {
			const handle = await store.open(name);
			const root = handle.root as Root;
			if (root.kind === undefined) {
				atomic(() => {
					root.kind = name.startsWith('process:') ? 'process' : 'visit';
					root.user = null;
					root.build = root.kind === 'process' ? build : null;
					root.browser = null;
					root.startedAt = Date.now();
					root.endedAt = null;
					root.errors = 0;
					root.entries = createArray();
				});
			}
			const made: Holding = { handle, idle: undefined };
			held.set(name, made);
			return made;
		})();
		opening.set(name, building);
		void building.then(() => opening.delete(name), () => opening.delete(name));
		return building;
	};

	/**
	 * This process's document, or a fresh one once the next entry would be its sentinel: the
	 * record goes on, and the full document is closed here and swept in its time.
	 */
	const rotated = async (): Promise<string> => {
		const { handle } = await opened(process);
		if ((handle.root as Root).entries.length + 1 < perVisit) return process;
		const was = held.get(process);
		held.delete(process);
		process = `process:${idText()}`;
		await opened(process);
		if (was !== undefined) await store.close(was.handle);
		return process;
	};

	const release = (name: string): void => {
		const holding = held.get(name);
		if (holding === undefined || name === process) return;
		if (holding.idle !== undefined) clearTimeout(holding.idle);
		holding.idle = setTimeout(() => {
			held.delete(name);
			void store.close(holding.handle).catch(() => undefined);
		}, idleMs);
		holding.idle.unref?.();
	};

	/** Append what fits under the caps, count the errors, and keep the tail to one commit. */
	const append = async (name: string, entries: readonly Entry[], onRoot?: (root: Root) => void): Promise<number> => {
		const { handle } = await opened(name);
		const root = handle.root as Root;
		let kept = 0;
		atomic(() => {
			onRoot?.(root);
			for (const entry of entries) {
				const room = perVisit - root.entries.length;
				if (room <= 0) break;
				// The last slot the visit has room for is a sentinel saying it filled, so a reader
				// knows what stopped; every other entry is trimmed to the byte budget, keeping its
				// kind so an error over the budget is still an error and still groups.
				const stored = room === 1 ? full(entry) : JSON.stringify(entry).length <= entryBytes ? entry : trim(entry, entryBytes);
				root.entries.push(createObject(flat(stored)));
				if (isError(stored)) root.errors += 1;
				kept += 1;
			}
		});
		await store.settled(handle);
		await store.truncate(name, 1);
		release(name);
		return kept;
	};

	const sessionOf = (context: unknown): string | undefined => {
		const session: unknown = (context as { session?: unknown } | null)?.session;
		return typeof session === 'string' ? session : undefined;
	};

	const userOf = (context: unknown): string | undefined => {
		const user: unknown = (context as { user?: unknown } | null)?.user;
		return typeof user === 'string' ? user : undefined;
	};

	const visitOf = (context: unknown): string | undefined => {
		if (context !== null && typeof context === 'object') {
			const byReference = bound.get(context);
			if (byReference !== undefined) return byReference;
		}
		const session = sessionOf(context);
		return session === undefined ? undefined : bySession.get(session);
	};

	const visitName = (visit: unknown): string => {
		if (typeof visit !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(visit)) throw malformed(`a visit id of ${JSON.stringify(visit)}`);
		return `visit:${visit}`;
	};

	/** A visit not held counts against the new-visit cap: a page that keeps sending is held. */
	const admit = (name: string): void => {
		if (held.has(name)) return;
		if (!visits.allow('visits', visitsPerMinute)) throw over('new visits this minute');
	};

	const record = async (body: unknown, context: unknown): Promise<{ kept: number }> => {
		if (body === null || typeof body !== 'object') throw malformed('a body that is not an object');
		const { visit, entries, browser, build: pageBuild, ended } = body as Partial<Batch>;
		const name = visitName(visit);
		if (!Array.isArray(entries)) throw malformed('a batch with no entries list');
		if (entries.length > batch) throw over(`a batch of ${String(entries.length)}`);
		const made: Entry[] = [];
		for (const raw of entries) {
			if (raw === null || typeof raw !== 'object') throw malformed('an entry that is not an object');
			const entry = entryOf(raw as Record<string, unknown>, 'page');
			if (entry === undefined) throw malformed('an entry with no kind');
			made.push(entry);
		}
		admit(name);
		if (!batches.allow(name, batchesPerMinute)) throw over('batches this minute for one visit');
		const user = userOf(context);
		const session = sessionOf(context);
		if (session !== undefined) remember(session, name);
		const kept = await append(name, made, (root) => {
			if (user !== undefined) root.user = user;
			if (root.build === null && typeof pageBuild === 'string') root.build = pageBuild;
			if (root.browser === null && browser !== null && typeof browser === 'object') root.browser = createObject(flat(browser));
			if (ended === true) root.endedAt = Date.now();
		});
		return { kept };
	};

	let processWrites: Promise<unknown> = Promise.resolve();
	const write = async (fields: Readonly<Record<string, unknown>>, context?: unknown): Promise<void> => {
		const entry = entryOf(fields, 'server');
		if (entry === undefined) return;
		const visit = visitOf(context);
		if (visit !== undefined) { await append(visit, [entry]); return; }
		// One at a time into the process document, so a full one rotates exactly once.
		const next = processWrites.then(async () => append(await rotated(), [entry]));
		processWrites = next.catch(() => undefined);
		await next;
	};

	const sweep = async (): Promise<number> => {
		const cutoff = Date.now() - keep * 86_400_000;
		let removed = 0;
		for (const { doc } of await store.find({ where: [{ field: 'startedAt', op: 'lt', value: cutoff }] })) {
			if (doc === process || !(doc.startsWith('visit:') || doc.startsWith('process:'))) continue;
			const holding = held.get(doc);
			if (holding !== undefined) {
				if (holding.idle !== undefined) clearTimeout(holding.idle);
				held.delete(doc);
				await store.close(holding.handle);
			}
			await store.remove(doc);
			removed += 1;
		}
		return removed;
	};

	// Loud at load rather than at the first sweep an hour in: the sweep queries a declared
	// path, and a store that has not declared it refuses the query.
	try {
		await store.find({ where: [{ field: 'startedAt', op: 'lt', value: 0 }], limit: 1 });
	} catch {
		throw codecError(
			'undeclared', 'the store does not declare the paths this battery queries',
			'Spread paths from @aweftjs/logs into the store\'s declare.',
		);
	}
	await opened(process);
	await sweep();
	const timer = setInterval(() => { void sweep().catch(() => undefined); }, sweepMs);
	timer.unref?.();

	return {
		public: true,
		get process() { return process; },
		call: (args, context) => {
			const name = visitName((args as { visit?: unknown } | null)?.visit);
			if (context !== null && typeof context === 'object') bound.set(context, name);
			const session = sessionOf(context);
			if (session !== undefined) remember(session, name);
			return { bound: true };
		},
		record,
		write,
		visitOf,
		sweep,
		stop: async () => {
			clearInterval(timer);
			for (const [name, holding] of held) {
				if (holding.idle !== undefined) clearTimeout(holding.idle);
				held.delete(name);
				await store.close(holding.handle);
			}
		},
	};
};
