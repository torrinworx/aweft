// The optimistic side of a link.
//
// A local commit applies at once and goes into a pending list. The host decides it later, and
// until then this side is showing state the host has not agreed to. Everything below is about
// getting back to the truth when it disagrees, without ever leaving the document forked.
//
// One mechanism does that, and it is used for every case: undo the pending list in reverse,
// apply whatever arrived, redo the list. A redo that cannot apply is a commit the host would
// refuse for the same cause, because both sides are applying the same sequence of commits;
// it is dropped and reported. The document therefore always equals what the host said, plus
// the local commits that still apply on top of it (design 011).

import { type Commit, idToText } from '@aweftjs/codec';
import { type Derived, idOf, mutable, snapshot } from '@aweftjs/core';

import type { Channel } from './channel.ts';
import { type Frame, type WireReason, reasonsOf } from './frame.ts';
import { reconcile, rootFrom } from './document.ts';
import { type Tracker, track } from './track.ts';
import { outbox } from './outbox.ts';

/** A local commit the host would not take, with everything known about why. */
export interface Refused {
	readonly commit: Commit;
	/** The prior values, which this side still holds even though they never crossed the link. */
	readonly undo: Commit | undefined;
	readonly reasons: readonly WireReason[];
}

/**
 * Where a replica stands.
 *
 * `joining` on the way in, `live` once the host has answered, `lost` while the link is down
 * and it is trying again, `left` once it was given up, `failed` when the host turned it away.
 */
export type ReplicaState = 'joining' | 'live' | 'lost' | 'left' | 'failed';

export interface JoinOptions<T> {
	/**
	 * The document to sync. It must share the host's root id.
	 *
	 * Leave it out and the document is built from what the host sends, and `ready` hands it
	 * over. That is the shape to reach for when the host owns the state and this side is only
	 * reading and writing it.
	 */
	readonly document?: T;
	/**
	 * Local commits the host would not take, delivered once, after the document is right again.
	 *
	 * They arrive as a group because refusals do: a refusal cannot come back faster than a
	 * round trip, and whatever was written on top of a doomed commit in the meantime goes with
	 * it. Without a handler they are lost, and a line is written to the console.
	 */
	readonly refused?: (group: readonly Refused[]) => void;
	/** The host turned this topic away, or could not carry on with it. */
	readonly fault?: (reason: string, message: string) => void;
}

/** One document syncing on a session. */
export interface Replica<T> {
	/** The document, once there is one. Present immediately when one was handed in. */
	readonly document: T | undefined;
	/** The document, when the host has answered. Rejects if the host turns the join away. */
	readonly ready: Promise<T>;
	readonly state: Derived<ReplicaState>;
	/** How many local commits the host has not decided yet. */
	readonly pending: Derived<number>;
	/** Put what is queued on the link now, rather than at the end of the tick. */
	flush(): void;
	/** Stop syncing this document. The link stays up for the others. */
	leave(): void;
}

export interface SessionOptions {
	/**
	 * How long to wait before trying the link again, given how many tries have failed.
	 * Return false to stop trying. The default backs off from 100ms to 30s.
	 */
	readonly retry?: (attempt: number) => number | false;
}

/** One link to a host, carrying any number of documents. */
export interface Session {
	readonly connected: Derived<boolean>;
	/**
	 * Sync a document the host serves under this name.
	 *
	 * Params:
	 *   name: what the host calls it
	 *   options: the document to sync, and where refusals go
	 */
	join<T extends object>(name: string, options?: JoinOptions<T>): Replica<T>;
	/** Drop the link and open a new one now, rather than waiting for the backoff. */
	reconnect(): void;
	/** Stop. Every replica is left and no further link is opened. */
	close(): void;
}

/** One local commit that has not been decided yet, and the commit that undoes it. */
interface Pending {
	readonly seq: number;
	readonly commit: Commit;
	/** Absent when re-applying it changed nothing, so undoing it would change nothing either. */
	readonly undo: Commit | undefined;
	/**
	 * True once a rebase found it can no longer apply here.
	 *
	 * It stays in the list rather than leaving it, because the host has been sent that sequence
	 * number, or is about to be, and a hole in the run would make the next frame arrive out of
	 * order and end the link. It is not applied and not undone; it waits for the host to refuse
	 * it, which the host will, for the same cause.
	 */
	dead: boolean;
}

interface Sub {
	readonly topic: number;
	readonly name: string;
	document: object | undefined;
	tracker: Tracker | undefined;
	pending: Pending[];
	/** The sequence number the next local commit gets. */
	nextSeq: number;
	/** How far along the topic's own stream this side is. */
	have: number;
	session: Uint8Array | undefined;
	joined: boolean;
	left: boolean;
	/** The host turned this topic away. Nothing rejoins it; the caller leaves and joins again. */
	failed: boolean;
	/** How many times in a row this side has asked for the document without getting anywhere. */
	resyncs: number;
	/** The undo of the commit that most recently landed, captured while it was landing. */
	landed: Commit | undefined;
	readonly state: Derived<ReplicaState>;
	readonly count: Derived<number>;
	readonly options: JoinOptions<object>;
	settle: ((document: object) => void) | undefined;
	fail: ((error: Error) => void) | undefined;
}

const BACKOFF = (attempt: number): number => Math.min(100 * 2 ** attempt, 30_000);

/** How many fruitless requests for the document in a row before this side gives up on a topic. */
const RESYNC_LIMIT = 5;

/**
 * Open a session to a host.
 *
 * Params:
 *   open: makes a channel. It is called again on every reconnect, so opening the socket,
 *     and everything that authenticates it, stays yours
 *   options: how to back off when the link will not open
 *
 * Returns: a session. Nothing crosses it until something is joined.
 *
 * Example:
 *   const session = connect(() => fromWebSocket(new WebSocket(url)));
 *   const board = session.join('board:42');
 *   const doc = await board.ready;
 */
export const connect = (
	open: () => Channel | Promise<Channel>,
	options: SessionOptions = {},
): Session => {
	const retry = options.retry ?? BACKOFF;
	const connected = mutable(false);
	const subs = new Map<number, Sub>();
	let channel: Channel | undefined;
	let post: ReturnType<typeof outbox> | undefined;
	let nextTopic = 0;
	let attempt = 0;
	let stopped = false;
	let opening = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const report = (sub: Sub, group: Refused[]): void => {
		if (group.length === 0) return;
		if (sub.options.refused === undefined) {
			console.warn(`aweft/sync: ${group.length} refused commit(s) on ${sub.name} and no handler`);
			return;
		}
		sub.options.refused(group);
	};

	/**
	 * Undo pending commits from the newest back to `downTo`, so each undo meets the state it
	 * was made against. Anything before `downTo` is left alone.
	 */
	const rewind = (sub: Sub, downTo: number): void => {
		for (let i = sub.pending.length - 1; i >= downTo; i--) {
			const entry = sub.pending[i]!;
			if (entry.dead || entry.undo === undefined) continue;
			sub.tracker!.receive(entry.undo);
		}
	};

	/**
	 * Re-apply a list on top of whatever the document now holds, appending what took to the
	 * pending list. What will not go is a commit the host would refuse for the same cause.
	 */
	const replay = (sub: Sub, list: readonly Pending[], group: Refused[]): void => {
		for (const entry of list) {
			if (entry.dead) {
				sub.pending.push(entry);
				continue;
			}

			// The entry takes its place in the list before it is applied, so a commit a watcher
			// makes in answer to it lands after it rather than in front of it. The list is the
			// order the document saw things, and every undo is met by the state it was made
			// against only while that holds.
			const at = sub.pending.length;
			sub.pending.push(entry);
			sub.landed = undefined;
			try {
				sub.tracker!.receive(entry.commit);
				sub.pending[at] = { seq: entry.seq, commit: entry.commit, undo: sub.landed, dead: false };
			} catch (error) {
				sub.pending[at] = { ...entry, dead: true };
				group.push({ commit: entry.commit, undo: entry.undo, reasons: reasonsOf(error) });
			}
		}
		sub.count.set(sub.pending.length);
	};

	const sendPending = (sub: Sub, from: number): void => {
		// By sequence, not by the order the document saw them: a commit a watcher made during a
		// rebase sits in the middle of the list and carries the newest number. The host applies
		// what it is sent in the order it is sent, and refuses anything that does not fit there,
		// which is the ordinary path back into step.
		const going = sub.pending
			.filter((entry) => entry.seq >= from)
			.sort((a, b) => a.seq - b.seq);
		if (going.length === 0 || post === undefined) return;
		post.send({
			kind: 'commits', topic: sub.topic, first: going[0]!.seq,
			commits: going.map((entry) => entry.commit),
		});
	};

	const startTracking = (sub: Sub, document: object): void => {
		sub.document = document;
		sub.tracker = track(document, ({ commit, undo, landed }) => {
			if (landed) {
				sub.landed = undo;
				return;
			}
			const seq = sub.nextSeq;
			sub.nextSeq += 1;
			sub.pending.push({ seq, commit, undo, dead: false });
			sub.count.set(sub.pending.length);
			if (sub.joined && post !== undefined) {
				post.send({ kind: 'commits', topic: sub.topic, first: seq, commits: [commit] });
			}
		});
	};

	const onJoined = (sub: Sub, frame: Frame & { kind: 'joined' }): void => {
		sub.session = frame.session;

		if (sub.document === undefined) {
			startTracking(sub, rootFrom(frame.root.id, frame.root.kind));
		} else if (idToText(idOf(sub.document)) !== idToText(frame.root.id)) {
			sub.state.set('failed');
			sub.failed = true;
			sub.fail?.(new Error(`root-mismatch: ${sub.name} is a different document here`));
			sub.options.fault?.('root-mismatch', `${sub.name} is a different document here`);
			return;
		}

		const group: Refused[] = [];
		rewind(sub, 0);
		const held = sub.pending;
		sub.pending = [];

		if (frame.whole) {
			// Say the host's document into a scratch tree, then move this one to match it. The
			// document the caller holds is never swapped: every watcher and every derived value
			// pointing at it keeps working, and the change reads like any other.
			//
			// An empty scratch is the point of the `whole` flag: with no reset to carry, this is
			// what drops whatever this side was still holding.
			const scratch = rootFrom(frame.root.id, frame.root.kind);
			if (frame.reset !== undefined) {
				const tracker = track(scratch, () => {});
				tracker.receive(frame.reset);
				tracker.stop();
			}
			const fix = reconcile(sub.document!, snapshot(scratch));
			if (fix !== undefined) sub.tracker!.receive(fix);
		}

		sub.have = frame.seq;
		// Everything at or below `accepted` was decided while the link was up or while it was
		// down. Either way the reconcile above has already made the document match, so what is
		// replayed is only what the host has not seen.
		replay(sub, held.filter((entry) => entry.seq > frame.accepted), group);

		sub.joined = true;
		sub.state.set('live');
		sendPending(sub, frame.accepted + 1);
		sub.settle?.(sub.document!);
		report(sub, group);
	};

	const onCommits = (sub: Sub, frame: Frame & { kind: 'commits' }): void => {
		if (frame.first !== sub.have + 1) {
			// A hole in the host's stream. Nothing here can repair it, so ask for the document.
			resync(sub);
			return;
		}

		const group: Refused[] = [];
		const held = sub.pending;
		if (held.length > 0) rewind(sub, 0);

		// A fresh list before anything is applied, always, even when there was nothing pending.
		// A watcher writing in answer to what is arriving pushes onto the pending list, and if
		// that were still the list being replayed, the replay would walk a list it is appending
		// to and never reach the end of it.
		sub.pending = [];

		try {
			for (const commit of frame.commits) {
				sub.tracker!.receive(commit);
				sub.have += 1;
			}
		} catch {
			// The host's own commit does not apply here, so the two documents disagree about
			// more than this frame. Ask for the whole thing rather than guess.
			replay(sub, held, group);
			report(sub, group);
			resync(sub);
			return;
		}

		if (held.length > 0) replay(sub, held, group);
		sub.resyncs = 0;
		report(sub, group);
	};

	const onAccept = (sub: Sub, frame: Frame & { kind: 'accept' }): void => {
		// A commit this side gave up on that the host took anyway means the two are applying
		// different sequences, which nothing here can reason its way out of. Ask for the
		// document rather than carry on holding something the host does not have.
		const raised = sub.pending.some((entry) => entry.dead && entry.seq <= frame.through);

		// This side's own commits take the topic's next sequence numbers, and everything the
		// host published before them was sent here. So the accept can carry this side forward
		// by at most the commits it covers: further than that, and something did not arrive.
		const covered = sub.pending.filter((entry) => entry.seq <= frame.through).length;
		const skipped = frame.at > sub.have + covered;

		sub.pending = sub.pending.filter((entry) => entry.seq > frame.through);
		sub.count.set(sub.pending.length);
		if (frame.at > sub.have) sub.have = frame.at;

		if (raised || skipped) resync(sub);
	};

	const onRefuse = (sub: Sub, frame: Frame & { kind: 'refuse' }): void => {
		const at = sub.pending.findIndex((entry) => entry.seq === frame.seq);
		if (at < 0) return;

		const group: Refused[] = [];
		// Only back to the refused one. The commits before it are untouched by this.
		rewind(sub, at);

		const refused = sub.pending[at]!;
		const after = sub.pending.slice(at + 1);
		sub.pending.length = at;
		// One that a rebase already gave up on was reported then; the host agreeing is not news.
		if (!refused.dead) {
			group.push({ commit: refused.commit, undo: refused.undo, reasons: frame.reasons });
		}

		replay(sub, after, group);
		report(sub, group);
	};

	const rejoin = (sub: Sub, have: number): void => {
		if (post === undefined || sub.failed) return;
		sub.joined = false;
		sub.state.set('joining');
		post.send({
			kind: 'join', topic: sub.topic, name: sub.name, have,
			...(sub.session === undefined ? {} : { resume: sub.session }),
		});
	};

	/**
	 * Ask for the document, because this side has lost the thread.
	 *
	 * It leaves the topic and joins it as if it had never held it, session and all. A host
	 * cannot tell "I hold nothing" from "I have lost my place" by a count alone, and answering
	 * the second with a replay of commits this side already applied is an endless conversation
	 * rather than a recovery.
	 */
	const resync = (sub: Sub): void => {
		if (post === undefined || sub.failed) return;

		// Asking again and again without getting anywhere is a disagreement neither side can
		// talk its way out of, and asking forever starves the machine rather than reporting it.
		//
		// Only taking a commit from the host counts as getting somewhere. An accept does not:
		// a client that is writing collects accepts whatever else is wrong, and clearing the
		// count on one would leave a client that writes able to ask forever.
		sub.resyncs += 1;
		if (sub.resyncs > RESYNC_LIMIT) {
			const message = `${sub.name} asked for the document ${sub.resyncs} times without moving`;
			sub.state.set('failed');
			sub.failed = true;
			sub.joined = false;
			sub.fail?.(new Error(`resync-loop: ${message}`));
			sub.options.fault?.('resync-loop', message);
			return;
		}

		if (sub.joined) post.send({ kind: 'leave', topic: sub.topic });
		sub.session = undefined;
		sub.have = 0;

		// Joining as if this side had never been here means the host has forgotten how far it
		// had numbered this client, and will expect one. Nothing pending has a number that is
		// spoken for any more, so they are renumbered from one, in the order they will be sent.
		const order = [...sub.pending].sort((a, b) => a.seq - b.seq);
		const renumbered = new Map(order.map((entry, i) => [entry.seq, i + 1]));
		sub.pending = sub.pending.map((entry) => ({ ...entry, seq: renumbered.get(entry.seq)! }));
		sub.nextSeq = order.length + 1;

		rejoin(sub, 0);
	};

	const onFrame = (frame: Frame): void => {
		const sub = subs.get(frame.topic);
		if (sub === undefined || sub.left) return;

		if (frame.kind === 'joined') onJoined(sub, frame);
		else if (frame.kind === 'commits') onCommits(sub, frame);
		else if (frame.kind === 'accept') onAccept(sub, frame);
		else if (frame.kind === 'refuse') onRefuse(sub, frame);
		else if (frame.kind === 'fault') {
			sub.state.set('failed');
			sub.joined = false;
			sub.failed = true;
			sub.fail?.(new Error(`${frame.reason}: ${frame.message}`));
			sub.options.fault?.(frame.reason, frame.message);
		}
	};

	const wire = (opened: Channel): void => {
		channel = opened;
		post = outbox(opened);
		attempt = 0;
		connected.set(true);

		opened.receive(onFrame);
		opened.closed(() => {
			connected.set(false);
			channel = undefined;
			post = undefined;
			for (const sub of subs.values()) {
				if (sub.left || sub.failed) continue;
				sub.joined = false;
				sub.state.set('lost');
			}
			schedule();
		});

		for (const sub of subs.values()) {
			if (!sub.left && !sub.failed) rejoin(sub, sub.have);
		}
	};

	const start = (): void => {
		if (stopped || opening || channel !== undefined) return;
		opening = true;
		void (async () => {
			try {
				const opened = await open();
				opening = false;
				if (stopped) {
					opened.close();
					return;
				}
				wire(opened);
			} catch {
				opening = false;
				connected.set(false);
				schedule();
			}
		})();
	};

	function schedule(): void {
		if (stopped || timer !== undefined) return;
		const wait = retry(attempt);
		attempt += 1;
		if (wait === false) return;
		timer = setTimeout(() => {
			timer = undefined;
			start();
		}, wait);
		timer.unref?.();
	}

	return {
		connected,

		join: <T extends object>(name: string, opts: JoinOptions<T> = {}): Replica<T> => {
			const topic = nextTopic;
			nextTopic += 1;

			const sub: Sub = {
				topic, name, document: opts.document, tracker: undefined, pending: [], nextSeq: 1,
				have: 0, session: undefined, joined: false, left: false, failed: false, resyncs: 0,
				landed: undefined,
				state: mutable<ReplicaState>('joining'), count: mutable(0),
				options: opts as JoinOptions<object>, settle: undefined, fail: undefined,
			};
			subs.set(topic, sub);

			const ready = new Promise<T>((settle, fail) => {
				sub.settle = settle as (document: object) => void;
				sub.fail = fail;
			});
			// A join that fails before anything awaits it must not take the process down.
			ready.catch(() => {});

			if (opts.document !== undefined) startTracking(sub, opts.document);
			if (channel === undefined) start();
			else rejoin(sub, 0);

			return {
				get document() {
					return sub.document as T | undefined;
				},
				ready,
				state: sub.state,
				pending: sub.count,
				flush: () => { post?.flush(); },
				leave: () => {
					if (sub.left) return;
					sub.left = true;
					sub.state.set('left');
					sub.tracker?.stop();
					subs.delete(topic);
					post?.send({ kind: 'leave', topic });
					post?.flush();
				},
			};
		},

		reconnect: () => {
			if (channel === undefined) {
				attempt = 0;
				start();
				return;
			}
			channel.close();
		},

		close: () => {
			stopped = true;
			if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
			for (const sub of subs.values()) {
				sub.left = true;
				sub.state.set('left');
				sub.tracker?.stop();
			}
			subs.clear();
			channel?.close();
			connected.set(false);
		},
	};
};
