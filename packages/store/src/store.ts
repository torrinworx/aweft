// Keeping a document, and keeping it as it changes.
//
// A document opens from its rows and then persists itself: every commit it produces is
// written when it is produced. There is no save interval, because there is nothing expensive
// enough to be worth batching, and an interval is a window in which an accepted change is not
// yet written.

import {
	decodeCommit, encodeCommit, idToText, type Commit, type ObservableKind,
} from '@aweftjs/codec';
import { apply, createArray, createMap, createObject, fromSnapshot, idOf, observer } from '@aweftjs/core';
import { idFromText } from '@aweftjs/codec';

import type { Driver } from './driver.ts';
import { attachedBy, record, rowsFor, rowsFrom, snapshotOf, type Rows } from './rows.ts';

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
export const createStore = ({ driver }: { driver: Driver }) => {
	const open_ = new Map<string, State>();

	/** Write one commit: rows and tail together, and move the sequence. */
	const persist = async (state: State, commit: Commit, actor: string): Promise<void> => {
		const change = record(state.rows, commit);
		state.seq = await driver.write({
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
	const open = async (doc: string, kind: ObservableKind = 'object'): Promise<Handle> => {
		const already = open_.get(doc);
		if (already !== undefined) { already.refs++; return handleOf(already); }

		// Find or create, and the create has to be atomic: two callers opening the same name at
		// once must not build two documents with different roots, which is what a login path
		// does every time two requests for one account arrive together.
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
		const snap = fresh ? null : snapshotOf(rows, stored.root);

		const state: State = {
			doc,
			root: snap === null ? rootOf(idFromText(stored.root), stored.rootKind) : fromSnapshot(snap),
			rootId: stored.root,
			rootKind: stored.rootKind,
			rows,
			live: new Set(snap === null ? [stored.root] : Object.keys(snap.observables)),
			seq: await driver.head(doc),
			actor: 'local',
			stop: () => {},
			queue: Promise.resolve(),
			failure: null,
			refs: 1,
		};

		state.stop = observer(state.root).watch((change) => {
			const commit: Commit = { deltas: [...change.deltas] };
			for (const id of attachedBy(commit)) state.live.add(id);
			enqueue(state, commit);
		});

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
	const receive = async (handle: Handle, commit: Commit, actor: string): Promise<number> => {
		const state = stateOf(handle);

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

		await settled(handle);
		if (state.failure !== null) { const e = state.failure; state.failure = null; throw e; }
		return state.seq;
	};

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
	const settled = async (handle: Handle): Promise<void> => {
		const state = stateOf(handle);
		await state.queue;
		if (state.failure !== null) { const e = state.failure; state.failure = null; throw e; }
	};

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
	const since = async (doc: string, seq: number): Promise<Held[]> => {
		const entries = await driver.since(doc, seq);
		return entries.map((e) => ({ seq: e.seq, actor: e.actor, commit: decodeCommit(e.body) }));
	};

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
	const truncate = async (doc: string, keep: number): Promise<void> => {
		const head = await driver.head(doc);
		if (head > keep) await driver.truncate(doc, head - keep);
	};

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
	const orphans = (handle: Handle): string[] => {
		const state = stateOf(handle);
		const out: string[] = [];
		for (const [id, row] of state.rows) if (row.parent === null && id !== state.rootId) out.push(id);
		return out;
	};

	/**
	 * Forget every observable nothing attaches.
	 *
	 * Params:
	 *   handle: the open document
	 *
	 * Returns: how many rows went.
	 *
	 * This is the policy call, and it is the application's: nothing here sweeps on its own,
	 * because the growth is visible and bounded while an automatic sweep is data leaving at a
	 * moment nothing announces.
	 *
	 * Example:
	 *   const gone = await store.sweep(board);
	 */
	const sweep = async (handle: Handle): Promise<number> => {
		const state = stateOf(handle);
		const gone = orphans(handle);
		for (const id of gone) state.rows.delete(id);
		if (gone.length > 0) {
			await driver.write({
				doc: state.doc, root: state.rootId, rootKind: state.rootKind,
				rows: [], dropped: gone, actor: 'sweep', body: new Uint8Array(0),
			});
		}
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
		open_.delete(state.doc);
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

	return { open, receive, settled, since, truncate, orphans, sweep, close, remove, stop, head: driver.head.bind(driver) };
};
