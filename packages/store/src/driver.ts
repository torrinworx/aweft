// What a place to keep documents has to be able to do.
//
// Three operations and nothing clever: write some rows and one commit together, read the rows
// back, read a range of the tail. A target that cannot do those three is not a driver, and
// widening the interface until it fits one is how the weakest backend ends up deciding what
// the strongest may offer.
//
// The query surface is deliberately absent. open research gates it, because one
// query that is an index lookup on one driver and a capped scan on another is a performance
// cliff wearing a portable API.

import type { ObservableKind } from '@aweftjs/codec';
import type { SnapshotValue } from '@aweftjs/core';

/**
 * One observable, as a store holds it.
 *
 * `parent` and `slot` are null together, and mean the observable has no attach edge. Its
 * slots are kept anyway: detaching is not deleting (design 048), and what collects an
 * orphan is a sweep the host runs rather than the act of writing.
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
	readonly actor: string;
	readonly body: Uint8Array;
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
	readonly actor: string;
	readonly body: Uint8Array;
}

/**
 * A place to keep documents.
 *
 * Every method is asynchronous because the interesting drivers are, and a memory driver
 * pretending otherwise would let a consumer depend on synchrony the real ones cannot give.
 */
export interface Driver {
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

	/** Forget a document entirely: rows, tail and all. */
	remove(doc: string): Promise<void>;

	/** Release whatever the driver holds. Calling it twice is not an error. */
	close(): Promise<void>;
}
