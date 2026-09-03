// Keeping a document, and keeping it as it changes.
//
// A document opens from its rows and then persists itself: every commit it produces is
// written when it is produced. There is no save interval, because there is nothing expensive
// enough to be worth batching, and an interval is a window in which an accepted change is not
// yet written.

import {
	decodeCommit, encodeCommit, idToText, type Commit, type Delta, type ObservableKind,
} from '@aweftjs/codec';
import { apply, createArray, createMap, createObject, fromSnapshot, idOf, observer } from '@aweftjs/core';
import { idFromText } from '@aweftjs/codec';

import type { Driver, Found } from './driver.ts';
import { attachedBy, record, rowsFor, rowsFrom, snapshotOf, type Rows } from './rows.ts';
import {
	checkDeclaration, checkQuery, holds, projectionOf,
	type Declaration, type Indexable, type Query,
} from './query.ts';

/** One commit of a document's history, as `store` hands it back. */
export interface Held {
	readonly seq: number;
	readonly actor: string;
	readonly commit: Commit;
}

/**
 * One open document.
 *
 * `root` is the live observable. Mutate it and the change is persisted; nothing else is
 * needed. `seq` is the sequence of the last commit written, which is what a resuming session
 * presents.
 */
export interface Handle {
	readonly doc: string;
	readonly root: object;
	readonly seq: number;
}

interface State {
	doc: string;
	root: object;
	rootId: string;
	rootKind: ObservableKind;
	rows: Rows;
	fields: Record<string, Indexable>;
	projected: boolean;
	droppedAliases: string[];
	live: Set<string>;
	seq: number;
	actor: string;
	stop: () => void;
	queue: Promise<void>;
	failure: Error | null;
	refs: number;
}

const rootOf = (id: Uint8Array | undefined, kind: ObservableKind): object => {
	if (kind === 'object') return createObject(undefined, id);
	if (kind === 'array') return createArray(undefined, id) as unknown as object;
	return createMap(undefined, id) as unknown as object;
};

/**
 * A place that keeps documents.
 *
 * Params:
 *   driver: where the documents go
 *   declare: the paths to index, by the name a query calls each one
 *   actor: who a local write is recorded as, in the history a resuming session reads
 *
 * Returns: a store. Every document it opens is cached by name, so opening one twice hands
 * back the same live observable and the same handle, reference counted.
 *
 * Example:
 *   const store = createStore({ driver: memoryDriver() });
 *   const board = await store.open('board:42');
 *   (board.root as Record<string, unknown>).title = 'a board';
 *   await store.settled(board);
 */
/**
 * A place that keeps documents.
 *
 * Made by `createStore`. Every document it opens is cached by name, so opening one twice
 * hands back the same live observable, reference counted.
 */
export interface Store {
	/**
	 * Open a document, creating it when it is not there.
	 *
	 * Params:
	 *   doc: the document's name
	 *   kind: the root's kind, used only when the document is being created
	 *
	 * Returns: a handle whose `root` is live. Changes to it are persisted as they are made.
	 *
	 * A document is rebuilt from its rows, not by replaying its history: the rows are written
	 * in the same transaction as the commit, so they are never behind it.
	 *
	 * Example:
	 *   const board = await store.open('board:42');
	 */
	open(doc: string, kind?: ObservableKind): Promise<Handle>;

	/**
	 * Apply a commit that came from somewhere else, and persist it under its author.
	 *
	 * Params:
	 *   handle: the open document
	 *   commit: the commit to apply
	 *   actor: who wrote it, recorded beside it in the history
	 *
	 * Throws: whatever the applier throws, having changed nothing. Also `detached-elsewhere`
	 * when the commit re-attaches an observable this store still holds a row for but the
	 * reopened document does not hold, which would otherwise apply cleanly against an empty
	 * observable and lose what the row has (design 048).
	 *
	 * Example:
	 *   await store.receive(board, decodeCommit(bytes), 'u_7');
	 */
	receive(handle: Handle, commit: Commit, actor: string): Promise<number>;

	/**
	 * Wait until everything this document has produced is written.
	 *
	 * Params:
	 *   handle: the open document
	 *
	 * Throws: the first write that failed, if one did. The document is then ahead of what is
	 * stored, and the caller decides whether to reopen it or stop.
	 *
	 * Mutating is synchronous and writing is not, so there is a window of one turn between
	 * the two. This closes it. It is not a save interval: nothing is being held back.
	 *
	 * Example:
	 *   board.title = 'renamed';
	 *   await store.settled(board);
	 */
	settled(handle: Handle): Promise<void>;

	/**
	 * Find documents by a declared path.
	 *
	 * Params:
	 *   query: its conditions, and how to order and page them
	 *
	 * Returns: one entry per match, each carrying the declared fields the index already held,
	 * so listing what was found does not mean reopening every document.
	 *
	 * Throws `undeclared` when a condition or the sort names a path nothing indexed. That is
	 * refused rather than answered by a scan, because the scan is not slow in the same way on
	 * two drivers, and a query whose cost depends on where it runs is a cliff wearing a
	 * portable API. Declare the path, or reach for `scan` and say so.
	 *
	 * The FIRST condition is the one an index answers, and it does the pruning; the rest narrow
	 * what it returned. So order the conditions with the most selective one first, which is the
	 * whole of the tuning advice.
	 *
	 * Paging is by `after`, which takes the `doc` of the last entry of the previous page.
	 *
	 * Example:
	 *   for (const { doc, fields } of await store.find({
	 *     where: [{ field: 'ownerId', op: 'eq', value: 'u_7' }],
	 *   })) console.log(doc, fields.title);
	 */
	find(query: Query): Promise<Found[]>;

	/**
	 * Read documents without an index.
	 *
	 * Params:
	 *   limit: how many to return, required
	 *   after: the `doc` of the last entry of the previous page
	 *
	 * Returns: one entry per document, in a stable order, each with its declared fields.
	 *
	 * This is the un-indexed read, and it is a separate call with a required limit so that
	 * reaching for one is a decision rather than something a query falls into. What it costs
	 * depends on the driver, which is exactly why `find` will not do it.
	 *
	 * Example:
	 *   for (const { doc } of await store.scan(100, lastSeen)) await migrate(doc);
	 */
	scan(limit: number, after?: string): Promise<Found[]>;

	/**
	 * The commits after a sequence, oldest first.
	 *
	 * Params:
	 *   doc: the document's name
	 *   seq: the sequence the asker already has
	 *
	 * Returns: what it missed, each with the actor that wrote it.
	 *
	 * This is what a resuming session asks for (design 045). A sequence older than the tail
	 * reaches back to is answered with what the tail still holds, so a caller compares the
	 * first sequence it gets against the one it asked for and resynchronizes when there is a
	 * hole.
	 *
	 * Example:
	 *   const missed = await store.since('board:42', session.seq);
	 */
	since(doc: string, seq: number): Promise<Held[]>;

	/**
	 * Drop the history a session can no longer ask for.
	 *
	 * Params:
	 *   doc: the document's name
	 *   keep: how many of the most recent commits to keep
	 *
	 * The tail is derived, so this loses nothing the document holds. Keep at least as much as
	 * the longest outage a session is allowed to resume from; past that a session
	 * resynchronizes instead, which costs one document rather than one commit.
	 *
	 * Example:
	 *   await store.truncate('board:42', 1000);
	 */
	truncate(doc: string, keep: number): Promise<void>;

	/**
	 * The observables this document holds that nothing attaches.
	 *
	 * Params:
	 *   handle: the open document
	 *
	 * Returns: their ids. Detaching is not deleting, so these keep their rows until something
	 * collects them (design 048).
	 *
	 * Example:
	 *   if (store.orphans(board).length > 10_000) await store.sweep(board);
	 */
	orphans(handle: Handle): string[];

	/**
	 * Forget every observable nothing attaches.
	 *
	 * Params:
	 *   handle: the open document
	 *
	 * Returns: how many rows went. They are gone from storage, not just from this handle.
	 *
	 * This is the policy call, and it is the application's: nothing here sweeps on its own,
	 * because the growth is visible and bounded while an automatic sweep is data leaving at a
	 * moment nothing announces. A swept observable cannot be re-attached afterwards.
	 *
	 * Example:
	 *   const gone = await store.sweep(board);
	 */
	sweep(handle: Handle): Promise<number>;

	/**
	 * Stop following a document.
	 *
	 * The last closer tears it down. Anything still unwritten is written first, and a write
	 * that failed is raised here rather than going quiet.
	 */
	close(handle: Handle): Promise<void>;

	/** Forget a document entirely: its rows, its history, and anything open on it. */
	remove(doc: string): Promise<void>;

	/**
	 * Close every open document and release the driver.
	 *
	 * The driver is finished afterwards and this store cannot be used again. To finish with
	 * one document and keep the store, use `close`.
	 */
	stop(): Promise<void>;

	/** The sequence of a document's most recent commit, or 0 when it has none. */
	head(doc: string): Promise<number>;
}

export const createStore = (
	{ driver, declare = {}, actor = 'local' }:
	{ driver: Driver; declare?: Declaration; actor?: string },
): Store => {
	checkDeclaration(declare);
	const open_ = new Map<string, State>();
	const declared = driver.declare(Object.keys(declare));

	/** Write one commit: rows and tail together, and move the sequence. */
	// Recompute the declared fields and send only what moved. Reading them is a walk of the
	// declared depth and does not grow with the commit, so this is cheaper than asking of every
	// delta whether it landed on a declared path, and it cannot disagree with the rows.
	const moved = (state: State): Record<string, Indexable> | undefined => {
		const now = projectionOf(state.rows, state.rootId, declare);

		// A document nobody has projected yet writes every declared field, including the ones
		// that are null. Sending only what changed would leave a document whose declared path is
		// empty out of the index entirely, and `field eq null` would not find it.
		if (!state.projected) {
			state.projected = true;
			state.fields = now;
			return Object.keys(now).length === 0 ? undefined : now;
		}

		let changed: Record<string, Indexable> | undefined;
		for (const [field, value] of Object.entries(now)) {
			if (state.fields[field] === value) continue;
			state.fields[field] = value;
			(changed ??= {})[field] = value;
		}
		return changed;
	};

	const persist = async (state: State, commit: Commit, actor: string): Promise<void> => {
		const change = record(state.rows, commit);
		const project = moved(state);
		state.seq = await driver.write({
			...(project === undefined ? {} : { project }),
			doc: state.doc,
			root: state.rootId,
			rootKind: state.rootKind,
			rows: change.touched,
			dropped: change.dropped,
			actor,
			body: encodeCommit(commit),
		});
	};

	/** Persist in the order the commits happened, and hold the first failure. */
	const enqueue = (state: State, commit: Commit): void => {
		// Read the actor now, not when the write runs: writing is deferred by a turn, and by
		// then a `receive` has already put the local actor back.
		const actor = state.actor;
		state.queue = state.queue.then(async () => {
			if (state.failure !== null) return;
			try { await persist(state, commit, actor); }
			catch (e) { state.failure = e as Error; }
		});
	};

	// A write that failed is terminal for its document, and the error keeps being thrown rather
	// than handed to whoever asked first. The document has gone on mutating and the commits
	// behind the failure were skipped, so what is stored is not what the document says and no
	// later write can make it so. Reopen it, which rebuilds from what is actually stored.
	const watcher = (state: State) => (change: { deltas: readonly Delta[] }): void => {
		const commit: Commit = { deltas: [...change.deltas] };
		for (const id of attachedBy(commit)) state.live.add(id);
		enqueue(state, commit);
	};

	const raise = (state: State): void => {
		if (state.failure === null) return;
		throw state.failure;
	};

	const open = async (doc: string, kind: ObservableKind = 'object'): Promise<Handle> => {
		const already = open_.get(doc);
		if (already !== undefined) { already.refs++; return handleOf(already); }

		// Find or create, and the create has to be atomic: two callers opening the same name at
		// once must not build two documents with different roots, which is what a login path
		// does every time two requests for one account arrive together.
		await declared;
		let stored = await driver.read(doc);
		if (stored === null) {
			const rootId = idToText(idOf(rootOf(undefined, kind))!);
			stored = (await driver.create(doc, rootId, kind))
				? { root: rootId, rootKind: kind, rows: [] }
				: await driver.read(doc);
			if (stored === null) {
				throw new Error(`store: the driver would not create ${doc} and does not hold it`);
			}
		}

		const fresh = stored.rows.length === 0;
		const rows = fresh ? rowsFor(stored.root, stored.rootKind) : rowsFrom(stored.rows);
		const built = fresh ? null : snapshotOf(rows, stored.root);

		const state: State = {
			doc,
			root: built === null
				? rootOf(idFromText(stored.root), stored.rootKind)
				: fromSnapshot(built.snapshot),
			rootId: stored.root,
			rootKind: stored.rootKind,
			rows,
			fields: {},
			projected: false,
			droppedAliases: built?.dropped ?? [],
			live: new Set(built === null ? [stored.root] : Object.keys(built.snapshot.observables)),
			seq: await driver.head(doc),
			actor,
			stop: () => {},
			queue: Promise.resolve(),
			failure: null,
			refs: 1,
		};

		state.stop = observer(state.root).watch(watcher(state));

		open_.set(doc, state);
		return handleOf(state);
	};

	const handleOf = (state: State): Handle => ({
		doc: state.doc,
		root: state.root,
		get seq(): number { return state.seq; },
	});

	const stateOf = (handle: Handle): State => {
		const state = open_.get(handle.doc);
		if (state === undefined) throw new Error(`store: ${handle.doc} is not open`);
		return state;
	};

	const receive = async (handle: Handle, commit: Commit, actor: string): Promise<number> => {
		const state = stateOf(handle);
		raise(state);

		for (const id of attachedBy(commit)) {
			if (state.live.has(id)) continue;
			if (!state.rows.has(id)) continue;
			throw Object.assign(
				new Error(`detached-elsewhere: ${id} is held as a detached row and cannot be re-attached into a reopened document`),
				{ reason: 'detached-elsewhere' },
			);
		}

		const before = state.actor;
		state.actor = actor;
		try { apply(state.root, commit); }
		finally { state.actor = before; }

		await state.queue;
		raise(state);
		return state.seq;
	};

	const settled = async (handle: Handle): Promise<void> => {
		const state = stateOf(handle);
		await state.queue;
		raise(state);
	};

	const since = async (doc: string, seq: number): Promise<Held[]> => {
		const entries = await driver.since(doc, seq);
		return entries.map((e) => ({ seq: e.seq, actor: e.actor, commit: decodeCommit(e.body) }));
	};

	const truncate = async (doc: string, keep: number): Promise<void> => {
		const head = await driver.head(doc);
		if (head > keep) await driver.truncate(doc, head - keep);
	};

	const orphans = (handle: Handle): string[] => {
		const state = stateOf(handle);
		const out: string[] = [];
		for (const [id, row] of state.rows) if (row.parent === null && id !== state.rootId) out.push(id);
		return out;
	};

	const find = async (query: Query): Promise<Found[]> => {
		await declared;
		checkQuery(query, declare);

		const [first, ...rest] = query.where;
		const sort = query.sort === undefined
			? undefined
			: { field: query.sort.field, direction: query.sort.direction ?? 'asc' as const };

		// Only the driver's own limit is safe to push down when nothing narrows afterwards.
		const pushLimit = rest.length === 0 ? query.limit : undefined;
		const hits = await driver.find({
			where: first!,
			...(sort === undefined ? {} : { sort }),
			...(pushLimit === undefined ? {} : { limit: pushLimit }),
			...(query.after === undefined ? {} : { after: query.after }),
		});

		const kept = rest.length === 0
			? hits
			: hits.filter((found) => rest.every((w) => holds(w, found.fields[w.field] ?? null)));

		return query.limit === undefined ? kept : kept.slice(0, query.limit);
	};

	const scan = async (limit: number, after?: string): Promise<Found[]> => {
		await declared;
		if (!Number.isInteger(limit) || limit <= 0) throw new Error('store: scan needs a positive limit');
		return after === undefined ? driver.scan(limit) : driver.scan(limit, after);
	};

	const sweep = async (handle: Handle): Promise<number> => {
		const state = stateOf(handle);
		await state.queue;
		raise(state);

		const gone = orphans(handle);
		if (gone.length === 0) return 0;
		for (const id of gone) state.rows.delete(id);
		await driver.forget(state.doc, gone);
		return gone.length;
	};

	/** Stop following a document. The last closer tears it down. */
	const close = async (handle: Handle): Promise<void> => {
		const state = open_.get(handle.doc);
		if (state === undefined) return;
		state.refs--;
		if (state.refs > 0) return;
		state.stop();
		await state.queue;
		// A reopen can land inside that await and take a reference back. Deleting anyway would
		// hand that caller a handle whose observer is already stopped.
		if (state.refs > 0) { state.stop = observer(state.root).watch(watcher(state)); return; }
		open_.delete(state.doc);
		raise(state);
	};

	/** Forget a document entirely: its rows, its history, and anything open on it. */
	const remove = async (doc: string): Promise<void> => {
		const state = open_.get(doc);
		if (state !== undefined) { state.stop(); await state.queue; open_.delete(doc); }
		await driver.remove(doc);
	};

	/** Close every open document and release the driver. */
	const stop = async (): Promise<void> => {
		for (const state of [...open_.values()]) { state.stop(); await state.queue; }
		open_.clear();
		await driver.close();
	};

	return {
		open, receive, settled, since, truncate, orphans, sweep, find, scan, close, remove, stop,
		head: driver.head.bind(driver),
	};
};
