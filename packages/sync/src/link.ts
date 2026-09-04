// A link: two equal ends moving commits between documents.
//
// Both ends run this file. There is nothing in it that one end does and the other does not:
// each numbers the topics it opens, each hands an arriving commit to its own `accept` before
// applying it, each answers a commit it will not take with a refusal, and neither ever
// decides which end yields (design 053).
//
// An arriving commit is applied through the topic's tracker and never with a bare `apply`.
// That is what stops it being sent back where it came from, and it is also what makes several
// networks on one document work: a commit that lands through this link is an ordinary local
// commit to every other link, store and watcher holding the same document (design 055).

import { type Commit, idToText } from '@aweftjs/codec';
import { apply, idOf, kindOf, snapshot } from '@aweftjs/core';

import type { Channel } from './channel.ts';
import { asCommit, reconcile, rootFrom } from './document.ts';
import { type Frame, type OpenFrame, type WireReason, messageOf, refusalOf } from './frame.ts';
import { outbox } from './outbox.ts';
import { type Tracker, track } from './track.ts';

/** What the application does about the commits crossing one topic. */
export interface ShareHandlers {
	/** Hear an arriving commit before it applies. Return the reasons to refuse it; empty accepts. Default accepts. */
	readonly accept?: ((commit: Commit) => readonly WireReason[]) | undefined;
	/** A commit did not apply: one this end refused (`mine` false) or one the other end refused of ours (`mine` true). */
	readonly refused?: ((report: Refused) => void) | undefined;
	/** The topic ended with a fault: `root-mismatch`, `no-document` when neither end holds it, `no-topic`, `left` when the other end left it, or `closed` when the channel ended under the link. */
	readonly fault?: ((reason: string, message: string) => void) | undefined;
}

/** One commit that did not apply, at whichever end refused it. */
export interface Refused {
	readonly mine: boolean;
	readonly seq: number;
	readonly reasons: readonly WireReason[];
	/** Present when this end still holds the commit (always for `mine` false; within the window for `mine` true). */
	readonly commit?: Commit;
	/** The commit that undoes it, when known. */
	readonly undo?: Commit;
}

/** One document shared on a link. */
export interface Shared<T extends object> {
	/** The document, once there is one: at once when handed in, after the other end's `open` when minted. */
	readonly document: T | undefined;
	/** The document once it is worth reading: at once when handed in, after the other end's state when minted. */
	readonly ready: Promise<T>;
	/** Ask the other end for its state and move this document to it. Yielding, as design 054 describes. */
	resync(): void;
	/** Stop sharing. Sends `leave`. The document is left as it is. */
	stop(): void;
}

/** A link over one channel, carrying any number of documents. */
export interface Link {
	share<T extends object>(name: string, document?: T, handlers?: ShareHandlers): Shared<T>;
	close(): void;
}

/** What a link may be told about how it runs. */
export interface LinkOptions {
	/** How many sent commits per topic to keep so a `refused` can be reported with its commit. Default 256. */
	readonly window?: number;
}

/** One commit this end sent, kept so a refusal about it can be reported with it. */
interface Sent {
	readonly seq: number;
	readonly commit: Commit;
	readonly undo: Commit;
}

/** One topic, as this end holds it. */
interface Topic {
	readonly name: string;
	/** This end's number for it, which is what this end's frames name. */
	readonly mine: number;
	/** The other end's number, once its `open` has arrived. */
	theirs: number | undefined;
	document: object | undefined;
	tracker: Tracker | undefined;
	handlers: ShareHandlers;
	opened: boolean;
	live: boolean;
	ended: boolean;
	/** This end asked for the other end's state, so it holds nothing that should be sent. */
	wanted: boolean;
	/** The other end asked for this end's state. */
	theyWant: boolean;
	nextSeq: number;
	sent: Sent[];
	/** Commits made before the topic was live, waiting to go. */
	held: Sent[];
	settle: ((document: object) => void) | undefined;
	fail: ((error: Error) => void) | undefined;
}

const DEFAULT_WINDOW = 256;

/** A fault the topic ends with, as an error `ready` can be rejected with. */
const faulted = (reason: string, message: string): Error =>
	Object.assign(new Error(`${reason}: ${message}`), { reason });

/**
 * Share documents with the other end of a channel.
 *
 * Params:
 *   channel: the transport, already open. Both ends call this, with the same code
 *   options: `window`, how many sent commits per topic are kept for reporting a refusal
 *
 * Returns: the link. `share` puts a document on it; `close` ends it.
 *
 * A link decides nothing about the commits it carries. It numbers topics, batches what goes
 * out, hands an arriving commit to the topic's `accept`, applies what is accepted and answers
 * what is not. Which end yields in a conflict is the application's (design 054).
 *
 * Nothing resumes: a new channel is a new link, and re-sharing on it is the application's,
 * the same way opening the socket was.
 *
 * Example:
 *   const link = connect(fromWebSocket(socket));
 *   const board = link.share('board', document);
 *   await board.ready;
 */
export const connect = (channel: Channel, options: LinkOptions = {}): Link => {
	const post = outbox(channel);
	const size = options.window ?? DEFAULT_WINDOW;

	/** By this end's number, which is what a `fault` about a topic names. */
	const mine = new Map<number, Topic>();
	/** By the other end's number, which is what every other frame about a topic names. */
	const theirs = new Map<number, Topic>();
	/** Opens for a name nothing here shares yet, so the two orders of the handshake agree. */
	const waiting = new Map<string, OpenFrame>();

	let next = 1;
	let over = false;

	// `tell` is false when this end is the one ending it, because an application does not need
	// to be told about the leave it just asked for. `ready` is rejected either way: a promise
	// for a document that is never going to arrive is worse than a rejection nobody reads.
	const end = (topic: Topic, reason: string, message: string, tell: boolean): void => {
		if (topic.ended) return;
		topic.ended = true;
		topic.live = false;
		topic.tracker?.stop();
		mine.delete(topic.mine);
		if (topic.theirs !== undefined) theirs.delete(topic.theirs);
		topic.fail?.(faulted(reason, message));
		if (tell) topic.handlers.fault?.(reason, message);
	};

	const sendOpen = (topic: Topic, want: boolean): void => {
		const document = topic.document;
		topic.opened = true;
		post.send({
			kind: 'open', topic: topic.mine, name: topic.name,
			root: document === undefined ? null : { id: idOf(document), kind: kindOf(document) }, want,
		});
	};

	const sendState = (topic: Topic): void => {
		const whole = asCommit(topic.document!);
		post.send(whole === undefined
			? { kind: 'state', topic: topic.mine }
			: { kind: 'state', topic: topic.mine, commit: whole });
	};

	// Watch the document for commits this end makes. A commit that landed through this
	// tracker came from the other end and is not sent back; everything else goes, including a
	// commit that landed through a second link on the same document.
	const adopt = (topic: Topic, document: object): void => {
		topic.document = document;
		topic.tracker = track(document, ({ commit, undo, landed }) => {
			if (landed || topic.ended) return;
			const entry: Sent = { seq: topic.nextSeq, commit, undo };
			topic.nextSeq += 1;
			topic.sent.push(entry);
			if (topic.sent.length > size) topic.sent.shift();

			if (topic.live) {
				post.send({ kind: 'commits', topic: topic.mine, first: entry.seq, commits: [commit] });
			} else {
				topic.held.push(entry);
			}
		});
		// A minted document is empty until the state arrives, and handing an empty document to
		// whoever awaited it is how a caller ends up reading a board with no columns in it.
		if (!topic.wanted) topic.settle?.(document);
	};

	const goLive = (topic: Topic): void => {
		topic.live = true;
		const held = topic.held;
		topic.held = [];

		// The state says the whole document, so it already covers everything made before now.
		if (topic.theyWant) {
			sendState(topic);
		} else if (held.length > 0) {
			post.send({
				kind: 'commits', topic: topic.mine, first: held[0]!.seq,
				commits: held.map((entry) => entry.commit),
			});
		}
	};

	/** Does this end's document answer to the root the other end named? */
	const sameDocument = (topic: Topic, frame: OpenFrame): boolean =>
		frame.root !== null
		&& idToText(idOf(topic.document!)) === idToText(frame.root.id)
		&& kindOf(topic.document!) === frame.root.kind;

	// Neither end holds the document, so there is nothing for either to mint from. Loud at
	// both ends, because a share that waits forever is the footgun this exists to remove.
	const nothing = (topic: Topic, frame: OpenFrame): void => {
		const message = `neither end holds ${frame.name}`;
		post.send({ kind: 'fault', topic: frame.topic, reason: 'no-document', message });
		end(topic, 'no-document', message, true);
	};

	const mismatch = (topic: Topic, frame: OpenFrame): void => {
		const message = `${frame.name} is a different document at each end`;
		post.send({ kind: 'fault', topic: frame.topic, reason: 'root-mismatch', message });
		end(topic, 'root-mismatch', message, true);
	};

	const pair = (topic: Topic, frame: OpenFrame): void => {
		topic.theirs = frame.topic;
		if (topic.document === undefined) {
			if (frame.root === null) {
				nothing(topic, frame);
				return;
			}
			topic.wanted = true;
			adopt(topic, rootFrom(frame.root.id, frame.root.kind));
		} else if (frame.root !== null && !sameDocument(topic, frame)) {
			mismatch(topic, frame);
			return;
		}

		theirs.set(frame.topic, topic);
		topic.theyWant = frame.want;
		if (!topic.opened) sendOpen(topic, topic.wanted);
		goLive(topic);
	};

	const onOpen = (frame: OpenFrame): void => {
		const known = theirs.get(frame.topic);
		if (known !== undefined) {
			// Asking again for a topic that is already live is how an end says it is yielding.
			if (frame.root === null || !sameDocument(known, frame)) {
				mismatch(known, frame);
				return;
			}
			known.theyWant = frame.want;
			if (frame.want) sendState(known);
			return;
		}

		for (const topic of mine.values()) {
			if (topic.name === frame.name && topic.theirs === undefined) {
				pair(topic, frame);
				return;
			}
		}
		// Nothing here shares that name yet. Hold it, so sharing later still opens the topic.
		waiting.set(frame.name, frame);
	};

	const refuse = (topic: Topic, seq: number, reasons: readonly WireReason[], commit: Commit): void => {
		post.send({ kind: 'refused', topic: topic.mine, seq, reasons });
		topic.handlers.refused?.({ mine: false, seq, reasons, commit });
	};

	// A throw out of `accept` is a refusal: the commit did not land, and the other end has to
	// hear that rather than drift. A throw out of a watcher while the commit lands is different:
	// the commit is in, the application's own code failed, and that is raised as the
	// application's error once the frame is done, so a bad watcher cannot make the rest of a
	// frame vanish and leave two ends silently different.
	const onCommits = (topic: Topic, first: number, commits: readonly Commit[]): void => {
		let seq = first;
		let escaped: unknown;
		let anyEscaped = false;
		for (const commit of commits) {
			let reasons: readonly WireReason[];
			try {
				reasons = topic.handlers.accept?.(commit) ?? [];
			} catch (error) {
				reasons = [{ code: 'accept-threw', message: messageOf(error) }];
			}
			if (reasons.length > 0) {
				refuse(topic, seq, reasons, commit);
			} else {
				try {
					topic.tracker!.receive(commit);
				} catch (error) {
					const refusal = refusalOf(error);
					if (refusal !== undefined) {
						refuse(topic, seq, refusal, commit);
					} else if (!anyEscaped) {
						anyEscaped = true;
						escaped = error;
					}
				}
			}
			// A refusal refuses the commit and never the ones around it.
			seq += 1;
		}
		if (anyEscaped) queueMicrotask(() => { throw escaped; });
	};

	// Build what the other end says into a scratch document of the same root, then move this
	// one to it. The document the application holds is never swapped: every watcher and every
	// derived value pointing at it keeps working, and the change reads like any other.
	const onState = (topic: Topic, commit: Commit | undefined): void => {
		const document = topic.document!;
		const scratch = rootFrom(idOf(document), kindOf(document));
		if (commit !== undefined) apply(scratch, commit);

		const fix = reconcile(document, snapshot(scratch));
		if (fix !== undefined) topic.tracker!.receive(fix);
		topic.wanted = false;
		topic.settle?.(document);
	};

	const onRefused = (topic: Topic, seq: number, reasons: readonly WireReason[]): void => {
		const held = topic.sent.find((entry) => entry.seq === seq);
		topic.handlers.refused?.(held === undefined
			? { mine: true, seq, reasons }
			: { mine: true, seq, reasons, commit: held.commit, undo: held.undo });
	};

	const onFault = (frame: Frame & { kind: 'fault' }): void => {
		if (frame.topic === 0) {
			for (const topic of [...mine.values()]) end(topic, frame.reason, frame.message, true);
			channel.close();
			return;
		}
		const topic = mine.get(frame.topic);
		if (topic !== undefined) end(topic, frame.reason, frame.message, true);
	};

	const onFrame = (frame: Frame): void => {
		if (over) return;
		if (frame.kind === 'open') {
			onOpen(frame);
			return;
		}
		if (frame.kind === 'fault') {
			onFault(frame);
			return;
		}

		const topic = theirs.get(frame.topic);
		if (topic === undefined) {
			// The number is the sender's, and the sender is the end being told, so it can find
			// the topic that ended. The link carries on.
			post.send({
				kind: 'fault', topic: frame.topic, reason: 'no-topic',
				message: `nothing here is open as topic ${frame.topic}`,
			});
			return;
		}

		if (frame.kind === 'commits') onCommits(topic, frame.first, frame.commits);
		else if (frame.kind === 'state') onState(topic, frame.commit);
		else if (frame.kind === 'refused') onRefused(topic, frame.seq, frame.reasons);
		else end(topic, 'left', `the other end left ${topic.name}`, true);
	};

	// `tell` is true when the channel ended under the link (the other end went away, or the
	// transport gave up), which the application did not ask for and has to hear about. A close
	// this end asked for tells nobody, the same as a leave it asked for.
	const shutdown = (tell: boolean): void => {
		if (over) return;
		over = true;
		for (const topic of [...mine.values()]) {
			end(topic, 'closed', tell ? 'the channel ended' : 'the link closed', tell);
		}
		waiting.clear();
	};

	channel.receive(onFrame);
	channel.closed(() => shutdown(true));

	return {
		share: <T extends object>(name: string, document?: T, handlers: ShareHandlers = {}) => {
			const topic: Topic = {
				name, mine: next, theirs: undefined, document: undefined, tracker: undefined,
				handlers, opened: false, live: false, ended: false, wanted: false, theyWant: false,
				nextSeq: 1, sent: [], held: [], settle: undefined, fail: undefined,
			};
			next += 1;
			mine.set(topic.mine, topic);

			const ready = new Promise<object>((settle, fail) => {
				topic.settle = settle;
				topic.fail = fail;
			});
			// An application that never reads `ready` is not killed by a link that ended before
			// the document arrived. The promise handed back still rejects for whoever awaits it.
			ready.catch(() => {});

			if (document !== undefined) adopt(topic, document);

			const held = waiting.get(name);
			if (held !== undefined) {
				waiting.delete(name);
				pair(topic, held);
			} else {
				// An end with nothing says so and asks, so two ends with nothing find out.
				if (document === undefined) topic.wanted = true;
				sendOpen(topic, document === undefined);
			}

			return {
				get document() {
					return topic.document as T | undefined;
				},
				ready: ready as Promise<T>,
				resync: () => {
					topic.wanted = true;
					if (topic.document !== undefined && !topic.ended) sendOpen(topic, true);
				},
				stop: () => {
					if (topic.ended) return;
					post.send({ kind: 'leave', topic: topic.mine });
					end(topic, 'left', `this end left ${topic.name}`, false);
				},
			};
		},

		close: () => {
			try {
				post.flush();
			} catch {
				// The channel is going down either way, and close is not where a caller can act
				// on a transport that would not take the last frame.
			}
			shutdown(false);
			channel.close();
		},
	};
};
