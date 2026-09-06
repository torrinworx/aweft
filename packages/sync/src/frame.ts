// Frames: what one end of a link says to the other.
//
// A frame is a value, not bytes. Handing one across an in process channel costs 0.011 us
// against 4.29 us to encode and decode it, so the encoding is a property of the transport
// that needs one rather than of the protocol (design 041). `encodeFrame` and `decodeFrame`
// are that encoding, and they are what a second implementation has to match.
//
// Every frame names a topic by a small integer each end chose for the topics it opened. The
// string an application wrote is on the `open` frame and nowhere else: measured, a string on
// every frame costs 29.5% over the commit bytes it carries (`bench/replicate.ts`).

import {
	type Commit, type Id, type ObservableKind, type WireValue,
	codecError, decodeCommit, decodeValue, encodeCommit, encodeValue,
} from '@aweftjs/codec';

/** Where a document starts: the id of its root observable, and which kind that root is. */
export interface RootRef {
	readonly id: Id;
	readonly kind: ObservableKind;
}

/**
 * Why a commit was refused, in the form that crosses a link.
 *
 * The commit itself is not carried. The end that hears a refusal is the end that sent the
 * commit, so it already holds every delta; what it does not hold is the cause and the place.
 */
export interface WireReason {
	readonly code: string;
	readonly message: string;
	/** Where the delta lands, when the refusing end could decide that. */
	readonly path?: readonly string[];
}

/**
 * Shares a document under a name, and gives it the number the sender's later frames use.
 *
 * `want` asks the other end to say its whole document, which an end sets when it holds
 * nothing for the name: a document it has just minted, or one it has chosen to give up.
 */
export interface OpenFrame {
	readonly kind: 'open';
	readonly topic: number;
	readonly name: string;
	/** The sender's root, or null when the sender holds nothing under the name and wants the other end's. */
	readonly root: RootRef | null;
	readonly want: boolean;
}

/** The sender's whole document, said as one commit. Absent when the document is empty. */
export interface StateFrame {
	readonly kind: 'state';
	readonly topic: number;
	readonly commit?: Commit;
}

/** Commits, in the order they were made, starting at the sequence number stated. */
export interface CommitsFrame {
	readonly kind: 'commits';
	readonly topic: number;
	readonly first: number;
	readonly commits: readonly Commit[];
}

/**
 * One commit did not apply here, and here is why.
 *
 * `topic` is the refusing end's number and `seq` is the sequence the other end assigned.
 * A refusal refuses the commit and never the link.
 */
export interface RefusedFrame {
	readonly kind: 'refused';
	readonly topic: number;
	readonly seq: number;
	readonly reasons: readonly WireReason[];
}

/** This end is done with the topic. The link stays up for the others. */
export interface LeaveFrame {
	readonly kind: 'leave';
	readonly topic: number;
}

/**
 * The link cannot carry on for this topic.
 *
 * A refusal is not a fault: refusing a commit never ends anything. A fault is two documents
 * that are not one document, or a frame about a topic nothing is open under.
 *
 * The topic is the number the end being told uses, because the two cases that raise a fault
 * are exactly the two where the sender has no number to give: nothing is open under it, or
 * the topic is being turned away before it ever opened. Topic 0 is the link itself.
 */
export interface FaultFrame {
	readonly kind: 'fault';
	readonly topic: number;
	readonly reason: string;
	readonly message: string;
}

/** Everything one end of a link can say to the other. */
export type Frame =
	| OpenFrame | StateFrame | CommitsFrame | RefusedFrame | LeaveFrame | FaultFrame;

// The wire spells a kind as a small integer and this table is the only place the two meet.
// Appending is a format change; renumbering is a break.
const KINDS = ['open', 'state', 'commits', 'refused', 'leave', 'fault'] as const;
const ROOT_KINDS: readonly ObservableKind[] = ['object', 'array', 'map'];

const kindNumber = (kind: Frame['kind']): number => KINDS.indexOf(kind);

// Annotated rather than inferred: a `never` return only narrows control flow when the
// binding says so, and every check below leans on that.
const bad: (detail: string) => never = (detail) => {
	throw codecError('bad-frame', detail, 'Send frames encodeFrame wrote; a link reads nothing else.');
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

/** Is this one of the `{ code, message, path? }` objects a thrown refusal carries? */
const isReason = (value: unknown): value is WireReason => {
	const held = value as { code?: unknown; message?: unknown; path?: unknown } | null;
	return held !== null && typeof held === 'object'
		&& typeof held.code === 'string' && typeof held.message === 'string'
		&& (held.path === undefined || Array.isArray(held.path));
};

/**
 * The reasons to send back for a commit that would not apply.
 *
 * Params:
 *   error: whatever was thrown while the commit was applying
 *
 * Returns: one reason per cause. An error carrying a `refusals` array of
 * `{ code, message, path? }` gives one reason each; anything else carrying a stable `reason`
 * token gives one reason built from that token and the message.
 *
 * Throws the error back when it carries neither. Something with no cause on it is a defect
 * rather than a refusal, and swallowing it would report a bug as a conflict.
 *
 * Example:
 *   try { tracker.receive(commit); } catch (error) { answer(reasonsOf(error)); }
 */
export const reasonsOf = (error: unknown): WireReason[] => {
	const refusals = (error as { refusals?: unknown }).refusals;
	if (Array.isArray(refusals)) {
		const held = refusals.filter(isReason);
		if (held.length > 0) {
			return held.map((reason) => reason.path === undefined
				? { code: reason.code, message: reason.message }
				: { code: reason.code, message: reason.message, path: [...reason.path] });
		}
	}

	const reason = (error as { reason?: string }).reason;
	if (typeof reason !== 'string') throw error;
	return [{ code: reason, message: (error as Error).message }];
};

/** The reasons an error carries, or undefined when it is not a refusal at all. */
export const refusalOf = (error: unknown): WireReason[] | undefined => {
	try {
		return reasonsOf(error);
	} catch {
		return undefined;
	}
};

/** What an error says, for a reason built from something that was not a refusal. */
export const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * Turn a frame into the bytes a transport carries.
 *
 * Params:
 *   frame: the frame to write
 *
 * Returns: the bytes. The same frame always writes the same bytes, because every value in it
 * goes through the one canonical encoding this stack has.
 *
 * Throws: whatever the encoding refuses, naming the rule broken: `empty-commit`,
 * `invalid-value`, `lone-surrogate` and the rest. A frame built from a document this end
 * holds breaks none of them.
 *
 * Example:
 *   socket.send(encodeFrame({ kind: 'leave', topic: 3 }));
 */
export const encodeFrame = (frame: Frame): Uint8Array => {
	const head = kindNumber(frame.kind);

	if (frame.kind === 'open') {
		return encodeValue([head, frame.topic, frame.name,
			frame.root === null ? null : frame.root.id,
			frame.root === null ? null : ROOT_KINDS.indexOf(frame.root.kind), frame.want]) as Uint8Array;
	}
	if (frame.kind === 'state') {
		return encodeValue([head, frame.topic,
			frame.commit === undefined ? null : encodeCommit(frame.commit)]) as Uint8Array;
	}
	if (frame.kind === 'commits') {
		return encodeValue([head, frame.topic, frame.first,
			frame.commits.map((commit) => encodeCommit(commit))]) as Uint8Array;
	}
	if (frame.kind === 'refused') {
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
 * `invalid-utf8` and the rest. Branch on there being a `CodecError`, not on one reason. Bytes
 * that do not decode end the link; a commit that is refused never does.
 *
 * Example:
 *   const frame = decodeFrame(event.data);
 */
/** A topic number: an integer from 1. Zero names the link, which only a fault may do. */
const asTopic = (value: WireValue, allowLink: boolean): number => {
	const n = asNumber(value, 'a topic');
	if (n < 1 && !(allowLink && n === 0)) bad(`${n} is not a topic number`);
	return n;
};

/** A sequence number: an integer from 1. */
const asSeq = (value: WireValue): number => {
	const n = asNumber(value, 'a sequence number');
	if (n < 1) bad(`${n} is not a sequence number`);
	return n;
};

export const decodeFrame = (bytes: Uint8Array): Frame => {
	const value = decodeValue(bytes);
	if (!Array.isArray(value) || value.length === 0) bad('a frame is a non-empty array');

	const list = value as readonly WireValue[];
	const head = asNumber(list[0]!, 'a frame kind');
	const kind = KINDS[head];
	if (kind === undefined) bad(`${head} is not a frame kind`);

	if (kind === 'open') {
		const [, topic, name, rootId, rootKind, want] = asArray(value, 6, 'an open');
		if (typeof want !== 'boolean') bad('a want is a boolean');
		const nothing = rootId === null || rootKind === null;
		if (nothing && (rootId !== null || rootKind !== null)) bad('an open with no root has neither an id nor a kind');
		if (nothing && !want) bad('an end that holds nothing wants the other end\'s state');
		let root: RootRef | null = null;
		if (!nothing) {
			const kindOfRoot = ROOT_KINDS[asNumber(rootKind!, 'a root kind')];
			if (kindOfRoot === undefined) bad(`${String(rootKind)} is not an observable kind`);
			// Not assertId: the width of a root id is not this layer's rule, and refusing it here
			// would end the link where the applier refuses the commit instead.
			root = { id: asBytes(rootId!, 'a root id') as Id, kind: kindOfRoot! };
		}
		return {
			kind, topic: asTopic(topic!, false), name: asText(name!, 'a topic name'), root, want: want as boolean,
		};
	}
	if (kind === 'state') {
		const [, topic, commit] = asArray(value, 3, 'a state');
		const frame: StateFrame = { kind, topic: asTopic(topic!, false) };
		return commit === null
			? frame
			: { ...frame, commit: decodeCommit(asBytes(commit!, 'a state commit')) };
	}
	if (kind === 'commits') {
		const [, topic, first, commits] = asArray(value, 4, 'a commits frame');
		if (!Array.isArray(commits)) bad('a commits frame carries an array of commits');
		const held = commits as readonly WireValue[];
		if (held.length === 0) bad('a commits frame carries at least one commit');
		return {
			kind, topic: asTopic(topic!, false), first: asSeq(first!),
			commits: held.map((c) => decodeCommit(asBytes(c, 'a commit'))),
		};
	}
	if (kind === 'refused') {
		const [, topic, seq, reasons] = asArray(value, 4, 'a refused');
		if (!Array.isArray(reasons)) bad('a refused carries an array of reasons');
		const held = reasons as readonly WireValue[];
		if (held.length === 0) bad('a refused carries at least one reason');
		return {
			kind, topic: asTopic(topic!, false), seq: asSeq(seq!),
			reasons: held.map((raw) => {
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
		return { kind, topic: asTopic(topic!, false) };
	}
	const [, topic, reason, message] = asArray(value, 4, 'a fault');
	return {
		kind, topic: asTopic(topic!, true), reason: asText(reason!, 'a fault reason'),
		message: asText(message!, 'a fault message'),
	};
};
