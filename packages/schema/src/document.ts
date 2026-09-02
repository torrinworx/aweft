// Where every observable lives, kept from the commits a document accepted (design 034).
//
// One parent and one slot per observable, and nothing else. Authority is decided by shape, so
// slot values, kinds and aliases are all absent on purpose: holding them would make this a
// second copy of the document with a second chance to disagree with the first.

import {
	type Commit, type Ref,
	bytesToHex, codecError, idToText, isReference,
} from '@aweftjs/codec';

/**
 * Where one observable is attached. Internal shape; the trailing underscores mark surface a
 * release build is free to rename, so nothing outside this package reads these fields.
 */
export interface IndexEntry {
	parent_: string | null;
	slot_: string | null;
	/** The observables this one attaches, by the slot each sits in. */
	children_: Map<string, string>;
}

/**
 * The attach edges of one document.
 *
 * Held by whoever judges commits for that document, fed every commit it accepts, and read by
 * `validate` and `pathOf`. Its fields are internal.
 */
export interface DocumentIndex {
	readonly root_: string;
	readonly entries_: Map<string, IndexEntry>;
}

/**
 * The name a slot has in a path.
 *
 * An object slot is its key, an array slot is its position in hex, and a map slot is the
 * identity in text form. This is the same spelling the conformance fixtures write a slot key
 * with, and `tests/conformance.test.ts` checks the two against each other rather than
 * assuming they agree.
 */
export const stepOf = (ref: Ref): string => {
	if (ref.kind === 'object') return ref.key;
	if (ref.kind === 'array') return bytesToHex(ref.key);
	return idToText(ref.key);
};

const entryOf = (index: DocumentIndex, key: string): IndexEntry => {
	const existing = index.entries_.get(key);
	if (existing !== undefined) return existing;

	const made: IndexEntry = { parent_: null, slot_: null, children_: new Map() };
	index.entries_.set(key, made);
	return made;
};

/**
 * Start an index for a document.
 *
 * Params:
 *   rootId: the id of the document's root observable
 *
 * Returns: an empty index. Feed it with `record`, one call per commit the document accepted,
 * and every observable it holds becomes reachable as those commits attach them.
 *
 * Example:
 *   const index = createIndex(idOf(doc));
 */
export const createIndex = (rootId: Uint8Array): DocumentIndex => {
	const root = idToText(rootId);
	const index: DocumentIndex = { root_: root, entries_: new Map() };
	entryOf(index, root);
	return index;
};

/**
 * What a commit does to the attach edges, judged against the index as it stands.
 *
 * Internal to the package: `validate` reads it to resolve paths the commit itself creates,
 * and `record` reads it to fold the commit in. Both need the same answer, and computing it
 * once in one place is what keeps a validated commit and a recorded commit the same commit.
 */
export interface Overlay {
	/** Observables this commit gives an attach edge, and where. */
	readonly attaching: Map<string, { readonly holder: string; readonly slot: string }>;
	/** Observables whose current attach edge this commit takes away. */
	readonly detaching: Set<string>;
	/** Observables that would end with more than one attach edge, so no path decides them. */
	readonly ambiguous: Set<string>;
}

/** A commit that moves no attach edge, which is most of them. Shared, and never written to. */
const NOTHING: Overlay = { attaching: new Map(), detaching: new Set(), ambiguous: new Set() };

/** Counting rather than checking each delta in turn, so the answer does not depend on the
 * order a commit's deltas happen to be in.
 *
 * The collections are built only once a commit turns out to move an edge. A burst of writes
 * into slots that already exist moves none, and that is the shape of most traffic, so it pays
 * for one scan and no allocation at all. */
export const overlayOf = (index: DocumentIndex, commit: Commit): Overlay => {
	let attaching: Map<string, { holder: string; slot: string }> | undefined;
	let detaching: Set<string> | undefined;
	let counts: Map<string, number> | undefined;

	const bump = (key: string, by: number): void => {
		counts ??= new Map();
		const existing = counts.get(key)
			?? (index.entries_.get(key)?.parent_ != null ? 1 : 0);
		counts.set(key, existing + by);
	};

	for (const delta of commit.deltas) {
		const holder = idToText(delta.id);
		const slot = stepOf(delta.ref);
		const displaced = index.entries_.get(holder)?.children_.get(slot);

		if (delta.type !== 'add' && displaced !== undefined) {
			bump(displaced, -1);
			(detaching ??= new Set()).add(displaced);
		}

		const value = delta.value;
		if (value !== undefined && isReference(value) && value.edge === 'attach') {
			const target = idToText(value.id);
			bump(target, 1);
			(attaching ??= new Map()).set(target, { holder, slot });
		}
	}

	if (counts === undefined) return NOTHING;

	const ambiguous = new Set<string>();
	for (const [key, count] of counts) if (count > 1) ambiguous.add(key);

	return {
		attaching: attaching ?? NOTHING.attaching,
		detaching: detaching ?? NOTHING.detaching,
		ambiguous,
	};
};

/** The attach path of an observable, judged against the index plus what a commit would do. */
export const resolve = (
	index: DocumentIndex,
	overlay: Overlay,
	key: string,
): readonly string[] | 'unreachable' | 'multiple-attach' => {
	const steps: string[] = [];
	// A walk that has taken more steps than the index has entries is going round a ring, so
	// counting is the whole cycle guard and it allocates nothing on the path that is hot.
	let hops = index.entries_.size + overlay.attaching.size;
	let at = key;

	for (;;) {
		if (at === index.root_) return steps.reverse();
		if (overlay.ambiguous.has(at)) return 'multiple-attach';
		if (hops-- <= 0) return 'unreachable';

		const edge = overlay.attaching.get(at);
		if (edge !== undefined) {
			steps.push(edge.slot);
			at = edge.holder;
			continue;
		}

		// An edge this commit removes is not counted, so a commit may write into a subtree in the
		// same breath as it detaches it, and the write is judged at the path that subtree had
		// when the commit began. This is the applier's own rule, and design 037 is why the two
		// follow each other rather than each being right on its own.
		const entry = index.entries_.get(at);
		if (entry === undefined || entry.parent_ === null) return 'unreachable';
		steps.push(entry.slot_!);
		at = entry.parent_;
	}
};

/**
 * Would this attach edge put an observable inside its own subtree?
 *
 * The applier refuses that as `unreachable`, because a ring has no top and nothing in it has
 * a path. Walking up from the holder is the whole test: reach the child and the edge closes a
 * ring, reach the root and it does not.
 */
export const enclosesItself = (
	index: DocumentIndex,
	overlay: Overlay,
	child: string,
	holder: string,
): boolean => {
	let hops = index.entries_.size + overlay.attaching.size;
	let at = holder;

	for (;;) {
		if (at === child) return true;
		if (at === index.root_ || hops-- <= 0) return false;

		const edge = overlay.attaching.get(at);
		if (edge !== undefined) {
			at = edge.holder;
			continue;
		}

		const entry = index.entries_.get(at);
		if (entry === undefined || entry.parent_ === null) return false;
		at = entry.parent_;
	}
};

/**
 * Where an observable lives, as the path from the document root to it.
 *
 * Params:
 *   index: the index for that document
 *   id: the observable's id
 *
 * Returns: the slot names from the root down, or undefined when nothing attaches it. The root
 * itself is the empty path. A detached observable stays in the index and answers undefined,
 * which is the same answer as one this index has never seen.
 *
 * Example:
 *   pathOf(index, idOf(task));  // ['board', 'tasks', '40']
 */
export const pathOf = (
	index: DocumentIndex,
	id: Uint8Array,
): readonly string[] | undefined => {
	const at = resolve(index, NOTHING, idToText(id));
	return typeof at === 'string' ? undefined : at;
};

const detach = (index: DocumentIndex, key: string): void => {
	const entry = index.entries_.get(key);
	if (entry === undefined || entry.parent_ === null) return;

	index.entries_.get(entry.parent_)?.children_.delete(entry.slot_!);
	entry.parent_ = null;
	entry.slot_ = null;
};

/**
 * Fold an accepted commit into the index.
 *
 * Params:
 *   index: the index for the document the commit was applied to
 *   commit: that commit
 *
 * Call it after the commit was applied, never before: a commit the applier refuses must not
 * reach the index, or the index describes a document that does not exist (design 034).
 *
 * Throws `multiple-attach` when the commit would leave an observable with two attach edges,
 * which is the one breach of that contract this fold can see for itself.
 *
 * Example:
 *   apply(doc, commit);
 *   record(index, commit);
 */
export const record = (index: DocumentIndex, commit: Commit): void => {
	// An add into a slot the index already fills is a commit the applier refused, so it was
	// never applied and must not be folded in. This is the second breach of the record-after-
	// apply contract the fold can see for itself, and it lives here rather than in the overlay
	// because `validate` shares that and a validator returns a verdict, never a throw.
	for (const delta of commit.deltas) {
		if (delta.type !== 'add') continue;
		const holder = idToText(delta.id);
		if (index.entries_.get(holder)?.children_.has(stepOf(delta.ref)) === true) {
			throw codecError(
				'slot-exists',
				`${holder} already holds ${stepOf(delta.ref)}, so this is not the commit that was applied`,
			);
		}
	}

	const overlay = overlayOf(index, commit);
	if (overlay.ambiguous.size > 0) {
		const [first] = overlay.ambiguous;
		throw codecError(
			'multiple-attach',
			`${first} would have two attach edges, and an observable lives in one place`,
		);
	}

	// Detaching before attaching, so a commit that moves an observable from one slot to
	// another reads as one move rather than as a collision with itself.
	for (const key of overlay.detaching) detach(index, key);

	for (const [child, edge] of overlay.attaching) {
		const parent = entryOf(index, edge.holder);
		const entry = entryOf(index, child);
		entry.parent_ = edge.holder;
		entry.slot_ = edge.slot;
		parent.children_.set(edge.slot, child);
	}

	// An observable a delta names but nothing attaches still gets an entry, so a later commit
	// attaching it has somewhere to write and a delta naming it resolves as unreachable rather
	// than as unknown, which is the same refusal for the same reason.
	for (const delta of commit.deltas) entryOf(index, idToText(delta.id));
};
