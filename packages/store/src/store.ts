// Keeping a document, and keeping it as it changes.
//
// A document opens from its rows and then persists itself: every commit it produces is
// written when it is produced. There is no save interval, because there is nothing expensive
// enough to be worth batching, and an interval is a window in which an accepted change is not
// yet written.

import {
	codecError, decodeCommit, encodeCommit, idToText, type Commit, type Delta, type Id,
	type ObservableKind,
} from '@aweftjs/codec';
import { apply, createArray, createMap, createObject, fromSnapshot, idOf, observer } from '@aweftjs/core';
import { idFromText } from '@aweftjs/codec';

import type { Driver, Found } from './driver.ts';
import { attachedBy, reachable, record, rowsFor, rowsFrom, snapshotOf, type Rows } from './rows.ts';
import {
	checkDeclaration, checkQuery, holds, projectionOf,
	type Declaration, type Indexable, type Query,
} from './query.ts';

/** One commit of a document's history, as `store` hands it back. */
export interface Held {
	readonly seq: number;
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
	/** What `sweep` freed. The row it deleted was the only thing that knew. */
	swept: Set<string>;
	seq: number;
	stop: () => void;
	queue: Promise<void>;
	failure: Error | null;
	refs: number;
}

const rootOf = (id: Id | undefined, kind: ObservableKind): object => {
	if (kind === 'object') return createObject(undefined, id);
	if (kind === 'array') return createArray(undefined, id) as unknown as object;
	return createMap(undefined, id) as unknown as object;
};

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
	 * Throws: `create-not-held` when the driver refuses to create the document and does not
	 * hold it either, which is a driver that broke its own create contract.
	 *
	 * Example:
	 *   const board = await store.open('board:42');
	 */
	open(doc: string, kind?: ObservableKind): Promise<Handle>;

	/**
	 * Apply a commit that came from somewhere else, and persist it.
	 *
	 * Params:
	 *   handle: the open document
	 *   commit: the commit to apply
	 *
	 * Returns: the sequence the commit was written under.
	 *
	 * Applying through the store rather than around it is what makes a refusal arrive before
	 * anything is written (design 056).
	 *
	 * Throws: whatever the applier throws, having changed nothing. Also `detached-elsewhere`
	 * when the commit re-attaches an observable this store still holds a row for but the
	 * reopened document does not hold, which would otherwise apply cleanly against an empty
	 * observable and lose what the row has (design 048).
	 *
	 * Example:
	 *   await store.receive(board, decodeCommit(bytes));
	 */
	receive(handle: Handle, commit: Commit): Promise<number>;

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
	 * There is no query for every document ordered by a field: a condition is required, and it
	 * is what selects. Reading everything is `scan`, which orders by name.
	 *
	 * Paging is by `after`, which takes the `cursor` of the last hit of the previous page. A
	 * cursor names a position in the order asked for, not a document, so a page after a hit
	 * that has since been removed or re-ranked carries on from where it was. A cursor is only
	 * meaningful under the sort it came from; one from another sort is refused.
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
	 *   after: the `cursor` of the last hit of the previous page
	 *
	 * Returns: one entry per document, in a stable order, each with its declared fields.
	 *
	 * Throws: `invalid-limit` when the limit is not a whole number of at least 1, and `cursor`
	 * when `after` is not a cursor a previous page of this same call handed back.
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
	 * Returns: what it missed, oldest first, each with the sequence it was written under.
	 *
	 * Throws: `truncated` when the tail no longer reaches back to the sequence asked for. It is
	 * thrown rather than answered with what the tail still holds, because a short answer reads
	 * exactly like a complete one and a caller that missed everything would be told it missed
	 * nothing (design 051). Catch it and take the document whole:
	 *
	 * Example:
	 *   try {
	 *     for (const { seq, commit } of await store.since('board:42', session.seq)) send(seq, commit);
	 *   } catch (e) {
	 *     if ((e as { reason?: string }).reason !== 'truncated') throw e;
	 *     await sendWholeDocument('board:42');
	 *   }
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
	 * Throws: `not-open` when the handle names a document this store has closed.
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
	 * Throws: `not-open` when the handle names a document this store has closed, or the first
	 * write that failed, if one did.
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

/**
 * A place that keeps documents.
 *
 * Params:
 *   driver: where the documents go
 *   declare: the paths to index, by the name a query calls each one
 *
 * Returns: a store. Every document it opens is cached by name, so opening one twice hands
 * back the same live observable and the same handle, reference counted.
 *
 * Throws: `empty-path` when a declared field names no steps, and `wildcard-path` when one of
 * its steps is not a literal. Both are checked here, before anything is built from them.
 *
 * Example:
 *   const store = createStore({ driver: memoryDriver() });
 *   const board = await store.open('board:42');
 *   (board.root as Record<string, unknown>).title = 'a board';
 *   await store.settled(board);
 */
export const createStore = (
	{ driver, declare = {} }: { driver: Driver; declare?: Declaration },
): Store => {
	checkDeclaration(declare);
	const open_ = new Map<string, State>();
	// A document being built, before it is a State. `open` awaits the driver four times, so
	// without this two callers in one tick both miss `open_` and both build one, and the
	// second overwrites the first: two live copies of one document, writes through one
	// invisible to the other, and the loser's observer still writing to the driver after its
	// handle is closed. `Promise.all([open(d), open(d)])` is the ordinary shape in a server.
	const opening_ = new Map<string, Promise<State>>();
	const declared = driver.declare(declare);

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

	const persist = async (state: State, commit: Commit): Promise<void> => {
		const change = record(state.rows, commit);
		const project = moved(state);
		state.seq = await driver.write({
			...(project === undefined ? {} : { project }),
			doc: state.doc,
			root: state.rootId,
			rootKind: state.rootKind,
			rows: change.touched,
			dropped: change.dropped,
			body: encodeCommit(commit),
		});
	};

	/** Persist in the order the commits happened, and hold the first failure. */
	const enqueue = (state: State, commit: Commit): void => {
		// A local re-attach of a swept observable is the same loss as the remote one, one layer
		// down: the commit names the observable and not its contents, so the row comes back
		// empty. `receive` can refuse before applying; a local write has already happened, so
		// the only honest answer is the latch every unpersistable write takes.
		for (const id of attachedBy(commit)) {
			if (state.swept.has(id) && state.failure === null) state.failure = sweptAway(id);
		}

		state.queue = state.queue.then(async () => {
			if (state.failure !== null) return;
			try { await persist(state, commit); }
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

	const truncatedPast = (doc: string, seq: number, gone: number): Error => codecError(
		'truncated',
		`${doc} no longer holds the commits after ${seq}, the tail starts past ${gone}`,
		'Open the document and take it whole, rather than asking for the commits it missed.',
	);

	const sweptAway = (id: string): Error => codecError(
		'detached-elsewhere',
		`${id} was swept, so the row holding what it contained is gone and re-attaching it would store an empty one`,
		'Attach a new observable here instead of one this store already swept.',
	);

	const raise = (state: State): void => {
		if (state.failure === null) return;
		throw state.failure;
	};

	const open = async (doc: string, kind: ObservableKind = 'object'): Promise<Handle> => {
		const already = open_.get(doc);
		if (already !== undefined) { already.refs++; return handleOf(already); }

		const inFlight = opening_.get(doc);
		if (inFlight !== undefined) {
			const shared = await inFlight;
			// It can have been closed while this caller waited, in which case there is nothing
			// to take a reference to and the whole thing starts again.
			if (open_.get(doc) !== shared) return open(doc, kind);
			shared.refs++;
			return handleOf(shared);
		}

		// Registered before the first await, so every caller in this tick joins this build.
		const building = build(doc, kind);
		opening_.set(doc, building);
		try {
			return handleOf(await building);
		} finally {
			opening_.delete(doc);
		}
	};

	const build = async (doc: string, kind: ObservableKind): Promise<State> => {
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
				throw codecError('create-not-held', `the driver would not create ${doc} and does not hold it`,
					'Fix the driver so create refuses only a name it already holds.');
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
			swept: new Set<string>(),
			seq: await driver.head(doc),
			stop: () => {},
			queue: Promise.resolve(),
			failure: null,
			refs: 1,
		};

		state.stop = observer(state.root).watch(watcher(state));

		open_.set(doc, state);
		return state;
	};

	const handleOf = (state: State): Handle => ({
		doc: state.doc,
		root: state.root,
		get seq(): number { return state.seq; },
	});

	const stateOf = (handle: Handle): State => {
		const state = open_.get(handle.doc);
		if (state === undefined) {
			throw codecError('not-open', `${handle.doc} is not open`,
				'Open the document again and use the handle that call hands back.');
		}
		return state;
	};

	const receive = async (handle: Handle, commit: Commit): Promise<number> => {
		const state = stateOf(handle);
		raise(state);

		for (const id of attachedBy(commit)) {
			if (state.swept.has(id)) throw sweptAway(id);
			if (state.live.has(id)) continue;
			if (!state.rows.has(id)) continue;
			throw codecError(
				'detached-elsewhere',
				`${id} is held as a detached row and cannot be re-attached into a reopened document`,
				'Attach a new observable here, or apply the commit to the document that still holds it.',
			);
		}

		apply(state.root, commit);

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

		// Design 051. An empty result reads exactly like "you are current", so a caller that
		// missed everything is told it missed nothing. The partial case was already detectable
		// and the whole case was not, which is the shape that loses the most.
		const first = entries[0];
		if (first === undefined) {
			const head = await driver.head(doc);
			if (seq < head) throw truncatedPast(doc, seq, head);
		} else if (first.seq !== seq + 1) {
			throw truncatedPast(doc, seq, first.seq - 1);
		}

		return entries.map((e) => ({ seq: e.seq, commit: decodeCommit(e.body) }));
	};

	const truncate = async (doc: string, keep: number): Promise<void> => {
		const head = await driver.head(doc);
		if (head > keep) await driver.truncate(doc, head - keep);
	};

	const orphans = (handle: Handle): string[] => {
		const state = stateOf(handle);
		// Reachability, not parent pointers. Detaching a branch takes the edge off the top and
		// leaves everything under it pointing at a parent that is itself unreachable, so the
		// parent test finds one row of a dead subtree and no public call could ever free the
		// rest.
		const held = reachable(state.rows, state.rootId);
		const out: string[] = [];
		for (const id of state.rows.keys()) if (!held.has(id)) out.push(id);
		return out;
	};

	const checkLimit = (limit: number): void => {
		if (Number.isInteger(limit) && limit > 0) return;
		throw codecError('invalid-limit', `${String(limit)} is not a positive limit`,
			'Pass a whole number of at least 1 as the limit.');
	};

	const find = async (query: Query): Promise<Found[]> => {
		await declared;
		checkQuery(query, declare);
		// A driver reads a limit as a number it can pass to storage. A negative one is a
		// question nobody meant to ask, and it arrives at the driver as whatever that storage
		// makes of it, which on SQL is an error from inside the driver naming nothing.
		if (query.limit !== undefined) checkLimit(query.limit);

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
		checkLimit(limit);
		return after === undefined ? driver.scan(limit) : driver.scan(limit, after);
	};

	const sweep = async (handle: Handle): Promise<number> => {
		const state = stateOf(handle);
		await state.queue;
		raise(state);

		const gone = orphans(handle);
		if (gone.length === 0) return 0;
		for (const id of gone) {
			state.rows.delete(id);
			state.swept.add(id);
		}
		await driver.forget(state.doc, gone);
		return gone.length;
	};

	/** Stop following a document. The last closer tears it down. */
	const close = async (handle: Handle): Promise<void> => {
		const state = open_.get(handle.doc);
		if (state === undefined) return;
		state.refs--;
		if (state.refs > 0) return;

		// Drain with the observer still on. Stopping first loses any write made while this
		// await runs: the handle is still open, `settled` reports success, and the change is
		// nowhere in the driver.
		await state.queue;
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
		let failed: Error | null = null;
		for (const state of [...open_.values()]) {
			state.stop();
			await state.queue;
			failed ??= state.failure;
		}
		open_.clear();
		await driver.close();
		// The last moment a caller can hear that a write failed. `close` raises it; going quiet
		// here means the news arrives when nothing can be done about it, which is never.
		if (failed !== null) throw failed;
	};

	return {
		open, receive, settled, since, truncate, orphans, sweep, find, scan, close, remove, stop,
		head: driver.head.bind(driver),
	};
};
