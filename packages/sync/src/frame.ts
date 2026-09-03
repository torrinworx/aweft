// Frames: what one side of a replication link says to the other.
//
// A frame is a value, not bytes. Handing one across an in process channel costs 0.011 us
// against 4.29 us to encode and decode it, so the encoding is a property of the transport
// that needs one rather than of the protocol (design 041). `encodeFrame` and `decodeFrame`
// are that encoding, and they are what a second implementation has to match.
//
// Every frame names a topic by a small integer agreed when the topic was joined. The string
// an application wrote is on the join frame and nowhere else: measured, a string on every
// frame costs 29.5% over the commit bytes it carries (`bench/replicate.ts`).

import {
	type Commit, type ObservableKind, type WireValue,
	codecError, decodeCommit, decodeValue, encodeCommit, encodeValue,
} from '@aweftjs/codec';

/** Where a document starts: the id of its root observable, and which kind that root is. */
export interface RootRef {
	readonly id: Uint8Array;
	readonly kind: ObservableKind;
}

/**
 * Why one delta of a commit was refused, in the form that crosses a link.
 *
 * The delta itself is not carried. The receiver of a refusal is the side that sent the
 * commit, so it already holds every delta; what it does not hold is the cause and the place.
 */
export interface WireReason {
	readonly code: string;
	readonly message: string;
	/** Where the delta lands, when the refusing side could decide that. */
	readonly path?: readonly string[];
}

/** Asks to sync a named document on this link, and gives it a number for later frames. */
export interface JoinFrame {
	readonly kind: 'join';
	readonly topic: number;
	readonly name: string;
	/** How many commits this side has already taken for this topic, so a resume can skip them. */
	readonly have: number;
	/** The session this is resuming, when it is resuming one. */
	readonly resume?: Uint8Array;
}

/** Answers a join: what the document is, and how much of what this side sent survived. */
export interface JoinedFrame {
	readonly kind: 'joined';
	readonly topic: number;
	/** The highest sequence number from the joining side that was accepted before now. */
	readonly accepted: number;
	/**
	 * Where the joining side stands in the topic's own stream once this frame is processed.
	 *
	 * With a reset, the sequence the reset was taken at. Without one, the `have` the join
	 * asked with, unchanged, and whatever was missed follows as ordinary commits.
	 */
	readonly seq: number;
	/**
	 * True when this frame describes the whole document, so the receiver drops anything it
	 * holds that the frame does not mention.
	 *
	 * It is a field of its own rather than "a reset is present", because a host whose document
	 * is empty has no commit to send and still has to be able to say so. Without it a replica
	 * holding stale content would keep it forever.
	 */
	readonly whole: boolean;
	/** The session id to present on a later resume. */
	readonly session: Uint8Array;
	readonly root: RootRef;
	/** The whole document said as one commit, when the joining side needs one. */
	readonly reset?: Commit;
}

/** Commits, in the order they were made, starting at the sequence number stated. */
export interface CommitsFrame {
	readonly kind: 'commits';
	readonly topic: number;
	readonly first: number;
	readonly commits: readonly Commit[];
}

/** Every commit through this sequence number was applied. */
export interface AcceptFrame {
	readonly kind: 'accept';
	readonly topic: number;
	/** The highest sequence number the sending side assigned that was accepted. */
	readonly through: number;
	/**
	 * Where the accepting side put the last of them in the topic's own stream.
	 *
	 * A commit is never sent back to whoever made it, so without this the sender would have a
	 * hole in its count of the topic and would ask to resume from before its own work.
	 */
	readonly at: number;
}

/** One commit was refused, and here is a reason for each delta that caused it. */
export interface RefuseFrame {
	readonly kind: 'refuse';
	readonly topic: number;
	readonly seq: number;
	readonly reasons: readonly WireReason[];
}

/** This side is done with the topic. The link stays up. */
export interface LeaveFrame {
	readonly kind: 'leave';
	readonly topic: number;
}

/**
 * The link cannot carry on for this topic.
 *
 * A refusal is not a fault: refusing a commit never closes anything (design 012). A fault
 * is a join that was turned away, or a frame that did not make sense.
 */
export interface FaultFrame {
	readonly kind: 'fault';
	readonly topic: number;
	readonly reason: string;
	readonly message: string;
}

/** Everything one side of a replication link can say to the other. */
export type Frame =
	| JoinFrame | JoinedFrame | CommitsFrame | AcceptFrame | RefuseFrame | LeaveFrame | FaultFrame;

// The wire spells a kind as a small integer and this table is the only place the two meet.
// Appending is a format change; renumbering is a break.
const KINDS = ['join', 'joined', 'commits', 'accept', 'refuse', 'leave', 'fault'] as const;
const ROOT_KINDS: readonly ObservableKind[] = ['object', 'array', 'map'];

const kindNumber = (kind: Frame['kind']): number => KINDS.indexOf(kind);

// Annotated rather than inferred: a `never` return only narrows control flow when the
// binding says so, and every check below leans on that.
const bad: (detail: string) => never = (detail) => {
	throw codecError('bad-frame', detail);
};

const asArray = (value: WireValue, arity: number, what: string): readonly WireValue[] => {
	if (!Array.isArray(value)) bad(`${what} is an array`);
	const list = value as readonly WireValue[];
	if (list.length !== arity) bad(`${what} has ${arity} elements, not ${list.length}`);
	return list;
};

const asNumber = (value: WireValue, what: string): number => {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
		bad(`${what} is a whole number, not ${String(value)}`);
	}
	return value as number;
};

const asText = (value: WireValue, what: string): string => {
	if (typeof value !== 'string') bad(`${what} is text, not ${String(value)}`);
	return value as string;
};

const asBytes = (value: WireValue, what: string): Uint8Array => {
	if (!(value instanceof Uint8Array)) bad(`${what} is bytes, not ${String(value)}`);
	return value as Uint8Array;
};

const asPath = (value: WireValue): readonly string[] | undefined => {
	if (value === null) return undefined;
	if (!Array.isArray(value)) bad('a reason path is an array or null');
	return (value as readonly WireValue[]).map((step) => asText(step, 'a path step'));
};

const reasonValue = (reason: WireReason): WireValue =>
	[reason.code, reason.message, reason.path === undefined ? null : [...reason.path]];

/**
 * The reasons to send back for a refusal that came out of an applier rather than a policy.
 *
 * Every refusal in this stack carries a stable token as `reason`. Anything without one is a
 * defect rather than a refusal, so it is re-thrown instead of being reported as one.
 */
export const reasonsOf = (error: unknown): WireReason[] => {
	const reason = (error as { reason?: string }).reason;
	if (typeof reason !== 'string') throw error;
	return [{ code: reason, message: (error as Error).message }];
};

/**
 * Turn a frame into the bytes a transport carries.
 *
 * Params:
 *   frame: the frame to write
 *
 * Returns: the bytes. The same frame always writes the same bytes, because every value in it
 * goes through the one canonical encoding this stack has.
 *
 * Example:
 *   channel.send(encodeFrame({ kind: 'accept', topic: 0, through: 12 }));
 */
export const encodeFrame = (frame: Frame): Uint8Array => {
	const head = kindNumber(frame.kind);

	if (frame.kind === 'join') {
		return encodeValue([head, frame.topic, frame.name, frame.have,
			frame.resume === undefined ? null : frame.resume]) as Uint8Array;
	}
	if (frame.kind === 'joined') {
		return encodeValue([head, frame.topic, frame.accepted, frame.seq, frame.whole, frame.session,
			frame.root.id, ROOT_KINDS.indexOf(frame.root.kind),
			frame.reset === undefined ? null : encodeCommit(frame.reset)]) as Uint8Array;
	}
	if (frame.kind === 'commits') {
		return encodeValue([head, frame.topic, frame.first,
			frame.commits.map((commit) => encodeCommit(commit))]) as Uint8Array;
	}
	if (frame.kind === 'accept') {
		return encodeValue([head, frame.topic, frame.through, frame.at]) as Uint8Array;
	}
	if (frame.kind === 'refuse') {
		return encodeValue([head, frame.topic, frame.seq,
			frame.reasons.map(reasonValue)]) as Uint8Array;
	}
	if (frame.kind === 'leave') {
		return encodeValue([head, frame.topic]) as Uint8Array;
	}
	return encodeValue([head, frame.topic, frame.reason, frame.message]) as Uint8Array;
};

/**
 * Read a frame back out of the bytes a transport delivered.
 *
 * Params:
 *   bytes: one frame's bytes, exactly. Trailing bytes are refused
 *
 * Returns: the frame.
 *
 * Throws a `CodecError` when the bytes are not a frame, naming the field that was wrong. The
 * `reason` is `bad-frame` for a frame this package can read but does not accept, and whatever
 * the byte layer says otherwise: `truncated`, `trailing-bytes`, `unsupported-major`,
 * `invalid-utf8` and the rest. Branch on there being a `CodecError`, not on one reason. A
 * frame that does not decode is a fault and may close a link; a commit that is refused never
 * does (design 012).
 *
 * Example:
 *   const frame = decodeFrame(event.data);
 */
export const decodeFrame = (bytes: Uint8Array): Frame => {
	const value = decodeValue(bytes);
	if (!Array.isArray(value) || value.length === 0) bad('a frame is a non-empty array');

	const list = value as readonly WireValue[];
	const head = asNumber(list[0]!, 'a frame kind');
	const kind = KINDS[head];
	if (kind === undefined) bad(`${head} is not a frame kind`);

	if (kind === 'join') {
		const [, topic, name, have, resume] = asArray(value, 5, 'a join');
		const frame: JoinFrame = {
			kind, topic: asNumber(topic!, 'a topic'), name: asText(name!, 'a topic name'),
			have: asNumber(have!, 'a have count'),
		};
		return resume === null ? frame : { ...frame, resume: asBytes(resume!, 'a session id') };
	}
	if (kind === 'joined') {
		const [, topic, accepted, seq, whole, session, rootId, rootKind, reset] =
			asArray(value, 9, 'a joined');
		const root = ROOT_KINDS[asNumber(rootKind!, 'a root kind')];
		if (root === undefined) bad(`${String(rootKind)} is not an observable kind`);
		if (typeof whole !== 'boolean') bad('a whole flag is a boolean');
		const frame: JoinedFrame = {
			kind, topic: asNumber(topic!, 'a topic'), accepted: asNumber(accepted!, 'an accepted count'),
			seq: asNumber(seq!, 'a sequence number'), whole: whole as boolean,
			session: asBytes(session!, 'a session id'),
			root: { id: asBytes(rootId!, 'a root id'), kind: root! },
		};
		return reset === null ? frame : { ...frame, reset: decodeCommit(asBytes(reset!, 'a reset')) };
	}
	if (kind === 'commits') {
		const [, topic, first, commits] = asArray(value, 4, 'a commits frame');
		if (!Array.isArray(commits)) bad('a commits frame carries an array of commits');
		const list_ = commits as readonly WireValue[];
		if (list_.length === 0) bad('a commits frame carries at least one commit');
		return {
			kind, topic: asNumber(topic!, 'a topic'), first: asNumber(first!, 'a sequence number'),
			commits: list_.map((c) => decodeCommit(asBytes(c, 'a commit'))),
		};
	}
	if (kind === 'accept') {
		const [, topic, through, at] = asArray(value, 4, 'an accept');
		return {
			kind, topic: asNumber(topic!, 'a topic'), through: asNumber(through!, 'a sequence number'),
			at: asNumber(at!, 'a topic sequence'),
		};
	}
	if (kind === 'refuse') {
		const [, topic, seq, reasons] = asArray(value, 4, 'a refuse');
		if (!Array.isArray(reasons)) bad('a refuse carries an array of reasons');
		const list_ = reasons as readonly WireValue[];
		if (list_.length === 0) bad('a refuse carries at least one reason');
		return {
			kind, topic: asNumber(topic!, 'a topic'), seq: asNumber(seq!, 'a sequence number'),
			reasons: list_.map((raw) => {
				const [code, message, path] = asArray(raw, 3, 'a reason');
				const steps = asPath(path!);
				const reason: WireReason = {
					code: asText(code!, 'a reason code'), message: asText(message!, 'a reason message'),
				};
				return steps === undefined ? reason : { ...reason, path: steps };
			}),
		};
	}
	if (kind === 'leave') {
		const [, topic] = asArray(value, 2, 'a leave');
		return { kind, topic: asNumber(topic!, 'a topic') };
	}
	const [, topic, reason, message] = asArray(value, 4, 'a fault');
	return {
		kind, topic: asNumber(topic!, 'a topic'), reason: asText(reason!, 'a fault reason'),
		message: asText(message!, 'a fault message'),
	};
};
