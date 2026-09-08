// What a place to keep documents has to be able to do.
//
// Three operations and nothing clever: write some rows and one commit together, read the rows
// back, read a range of the tail. A target that cannot do those three is not a driver, and
// widening the interface until it fits one is how the weakest backend ends up deciding what
// the strongest may offer.
//
// The query half is four more: declare the paths to index, carry a commit's changes to them,
// answer a condition through one of those indexes, and read rows for the escape hatch. A
// driver never invents an index, because IndexedDB cannot: `createIndex` is legal only inside
// a version change, so the declaration arrives before any data does (design 049).

import type { ObservableKind } from '@aweftjs/codec';
import type { SnapshotValue } from '@aweftjs/core';

import type { Declaration, Indexable, Where } from './query.ts';

/**
 * One observable, as a store holds it.
 *
 * `parent` and `slot` are null together, and mean the observable has no attach edge. Its
 * slots are kept anyway: detaching is not deleting (design 048), and what collects an
 * orphan is a sweep the application runs rather than the act of writing.
 *
 * A slot holds a primitive, bytes, or a reference to another observable. A driver that keeps
 * slots as JSON writes a byte value as `{ bytes: <base64> }` and turns that object back into a
 * `Uint8Array` on read, because JSON has no other way to carry one and the obvious way loses it
 * in silence (design 163). No reference carries that key and no primitive is an object.
 */
export interface Row {
	readonly id: string;
	readonly kind: ObservableKind;
	readonly parent: string | null;
	readonly slot: string | null;
	readonly slots: Readonly<Record<string, SnapshotValue>>;
}

/**
 * What one commit did to one observable.
 *
 * Slots, not the whole row. A commit changes the slots it names and nothing else, so writing
 * the row whole would make two writers touching different slots of one observable overwrite
 * each other: the same lost update a whole-document write causes, one level down. A driver
 * merges this into what it holds.
 *
 * `edge` is present only when the commit changed where the observable is attached, and null
 * inside it means it was detached and keeps its slots.
 */
export interface Patch {
	readonly id: string;
	readonly kind: ObservableKind;
	readonly edge?: { readonly parent: string; readonly slot: string } | null;
	readonly set: Readonly<Record<string, SnapshotValue>>;
	readonly unset: readonly string[];
}

/** One commit as it was persisted, with the sequence its document gave it. */
export interface Entry {
	readonly seq: number;
	readonly body: Uint8Array;
	/**
	 * The declared fields this commit changed, and their new values. Written in the same
	 * transaction as the commit, so a query never reads a state that was never committed.
	 * Absent fields did not change.
	 */
	readonly project?: Readonly<Record<string, Indexable>>;
}

/**
 * One document as a query answers it: its name, the declared fields it holds, and where it sat
 * in the order it was found in.
 *
 * `cursor` is minted by the driver and opaque to everyone else. It carries the sort value and
 * the name, so that seeking past it works whether or not the document is still there or still
 * ranks where it did (design 060). It means something only to the driver that minted it, and
 * only under the sort it was minted for.
 */
export interface Found {
	readonly doc: string;
	readonly fields: Readonly<Record<string, Indexable>>;
	readonly cursor: string;
}

/**
 * What a driver is asked for: one indexed condition, and how to order and page what it finds.
 *
 * Exactly one condition, because that is the one an index answers. `store` narrows the result
 * with the rest of the query, so every driver does the same amount of the work.
 *
 * `after` is the `cursor` of the last hit of the previous page. A driver seeks past the
 * position the cursor names, by the value inside it, and never by looking the document up
 * again. A cursor minted under a different sort is refused with `reason: 'cursor'`.
 */
export interface Lookup {
	readonly where: Where;
	readonly sort?: { readonly field: string; readonly direction: 'asc' | 'desc' };
	readonly limit?: number;
	readonly after?: string;
}

/**
 * What one commit changes in a document, handed to a driver as a single unit of work.
 *
 * `rows` are merged slot by slot, `dropped` are the ids that lost their last edge, and `body`
 * is the commit itself.
 * A driver applies all of it or none of it: rows that disagree with the tail beside them is
 * the one corruption this design can produce, and a transaction is what rules it out.
 */
export interface Write {
	readonly doc: string;
	readonly root: string;
	readonly rootKind: ObservableKind;
	readonly rows: readonly Patch[];
	readonly dropped: readonly string[];
	readonly body: Uint8Array;
	/**
	 * The declared fields this commit changed, and their new values. Written in the same
	 * transaction as the commit, so a query never reads a state that was never committed.
	 * Absent fields did not change.
	 */
	readonly project?: Readonly<Record<string, Indexable>>;
}

export interface Driver {
	/**
	 * Name the paths this store indexes, before anything is written.
	 *
	 * Called once, when the store is made. A driver that has to build its indexes up front
	 * does it here; one that can add them later still may not, because the store's behaviour
	 * must not depend on which driver it is running on.
	 *
	 * The declaration carries each field's path, not its name alone, because a driver that
	 * already holds documents has to bring their projection into line with it, here, before
	 * this resolves (design 162). A document lacks a field when it has no value for it and
	 * equally when it holds one computed from another path, so a driver records the paths it
	 * projected under and computes again from the rows, with `projectionOf`, whenever one
	 * changes. A field the declaration no longer names leaves the projection, so `Found.fields`
	 * carries the declared fields and nothing else.
	 *
	 * Skip that and a document written under an older declaration and never written again is
	 * missing from `find` on the new field, including `field eq null`, while its rows hold the
	 * value, or worse, answers from a path nobody declares any more.
	 */
	declare(declaration: Declaration): Promise<void>;

	/** Answer one indexed condition. Only fields passed to `declare` are ever asked for. */
	find(lookup: Lookup): Promise<Found[]>;

	/**
	 * Every document, for the escape hatch. `limit` is required, and a driver stops there.
	 * `after` is the `cursor` of the last hit of a previous `scan`.
	 *
	 * This is the un-indexed read, and it is separate so that reaching for one is a decision
	 * rather than an accident.
	 */
	scan(limit: number, after?: string): Promise<Found[]>;

	/**
	 * Apply one commit's rows and append it to the tail, atomically, and return the sequence
	 * the commit was given. Sequences start at 1 and are contiguous within a document.
	 */
	write(write: Write): Promise<number>;

	/**
	 * Claim a document's name and its root, if nobody has.
	 *
	 * Returns: true when this call created it, false when it was already there. Two callers
	 * racing to open the same name must not both win, or they build two documents with
	 * different roots and one of them is thrown away at its first write. A driver serving more
	 * than one process makes this atomic; a memory driver is one process and already is.
	 */
	create(doc: string, root: string, rootKind: ObservableKind): Promise<boolean>;

	/** Every row of a document, attached and detached alike, or null when it has none. */
	read(doc: string): Promise<{ root: string; rootKind: ObservableKind; rows: Row[] } | null>;

	/** The commits after `seq`, oldest first. What a resuming session asks for. */
	since(doc: string, seq: number): Promise<Entry[]>;

	/** The highest sequence a document has, or 0 when it has no commits. */
	head(doc: string): Promise<number>;

	/** Forget the tail up to and including `seq`. What bounds the history. */
	truncate(doc: string, seq: number): Promise<void>;

	/**
	 * Forget these observables, for good.
	 *
	 * Distinct from `Write.dropped`, which says an observable lost its attach edge and whose
	 * rows are KEPT (design 048). This is the sweep, and it is the only thing that frees one.
	 */
	forget(doc: string, ids: readonly string[]): Promise<void>;

	/** Forget a document entirely: rows, tail and all. */
	remove(doc: string): Promise<void>;

	/** Release whatever the driver holds. Calling it twice is not an error. */
	close(): Promise<void>;
}
