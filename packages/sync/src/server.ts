// The authoritative side of a link.
//
// A host holds documents. A connection is one client talking to it, and may join several
// topics. The order a host publishes in is the order every replica ends up in, which is what
// makes convergence a property of the protocol rather than of a merge rule.
//
// One path applies a commit to a served document, and it does validate, apply, record in that
// order. Nothing else can reach the document with a commit, so the pairing `schema` documents
// as a contract is structural here.

import { type Commit, codecError, createId, idToText } from '@aweftjs/codec';
import { type ObservableKind, idOf, kindOf } from '@aweftjs/core';
import {
	type Actor, type DocumentIndex, type Policy, checkPolicy, createIndex, record, validate,
} from '@aweftjs/schema';

import type { Channel } from './channel.ts';
import { type Frame, reasonsOf } from './frame.ts';
import { asCommit } from './document.ts';
import { type Tracker, track } from './track.ts';
import { outbox } from './outbox.ts';

/** A document a host serves, and the authority that governs writes to it. */
export interface Topic {
	/** Any observable in the document. It is served from its root. */
	readonly document: object;
	/**
	 * Who may write what.
	 *
	 * `'trusted'` means no authority check on this topic, and it is spelled out rather than
	 * defaulted: an authenticated client is not an authorized one, and a policy that could be
	 * left out by accident would ship the hole it exists to close. Reach for it on a link that
	 * carries no untrusted party, such as one in the same process.
	 */
	readonly policy: Policy | 'trusted';
}

/**
 * Which document a name means to this actor, or undefined to refuse the join.
 *
 * It is called once per join. Returning the same document for two names serves one document
 * under both, and returning different documents for one name serves each actor their own.
 */
export type Resolve = (name: string, actor: Actor) => Topic | undefined;

export interface HostOptions {
	/**
	 * How many recent commits per topic to keep, so a client that reconnects quickly is sent
	 * what it missed instead of the whole document. Zero always resends the document.
	 */
	readonly replay?: number;
	/** How many disconnected sessions to remember, so a reconnect can pick up where it was. */
	readonly sessions?: number;
}

/** One client talking to a host. */
export interface Connection {
	readonly actor: Actor;
	/** End it. The client's session is remembered, so it can resume. */
	close(): void;
}

/** A host: documents, and the connections reading and writing them. */
export interface Host {
	/**
	 * Take a channel as one client. The caller has already decided who they are.
	 *
	 * Params:
	 *   channel: the link
	 *   actor: who this connection speaks as. Read from the connection, never from a message
	 */
	accept(channel: Channel, actor: Actor): Connection;
	/** Close every connection. The documents are untouched. */
	close(): void;
	/** How many connections are open. */
	readonly connections: number;
}

/** A document being served, shared by every connection that reached it. */
interface Live {
	readonly document: object;
	readonly policy: Policy | 'trusted';
	readonly index: DocumentIndex | undefined;
	readonly tracker: Tracker;
	readonly members: Set<Member>;
	readonly buffer: { seq: number; commit: Commit }[];
	seq: number;
	/** What a policy has to say to be the same policy. Two joins may not disagree about it. */
	readonly authority: string;
	/** The member whose commit is landing, so it is not sent its own work back. */
	origin: Member | undefined;
	/** The sequence number that member gave the commit that is landing. */
	originSeq: number;
}

/** One connection's subscription to one document. */
interface Member {
	readonly conn: Conn;
	readonly topic: number;
	readonly name: string;
	readonly live: Live;
	/** The next sequence number this connection is expected to send for this topic. */
	next: number;
	/**
	 * An accept this member is owed, held back so consecutive commits share one frame.
	 *
	 * It goes out before anything else this member is told. A watcher on the host writing in
	 * answer to a commit publishes before the batch is finished, and a client that heard about
	 * that write before it heard where its own commit landed would see a hole in the topic
	 * stream that is not there, and ask for the document again, forever.
	 */
	owed: { through: number; at: number } | undefined;
}

interface Conn {
	readonly channel: Channel;
	readonly actor: Actor;
	readonly session: Uint8Array;
	readonly members: Map<number, Member>;
	readonly send: (frame: Frame) => void;
	readonly flush: () => void;
}

/** What a host remembers about a client that went away, so it can pick up where it was. */
interface Remembered {
	readonly actor: string;
	readonly accepted: Map<string, number>;
}

const rootOf = (document: object): { id: Uint8Array; kind: ObservableKind } =>
	({ id: idOf(document), kind: kindOf(document) });

/**
 * Start a host.
 *
 * Params:
 *   resolve: which document a topic name means to an actor, or undefined to refuse it
 *   options: how much to keep for a resume
 *
 * Returns: a host. Nothing happens until a channel is handed to `accept`.
 *
 * Example:
 *   const host = serve((name) => name === 'board' ? { document: board, policy } : undefined);
 *   server.on('connection', (socket, actor) => host.accept(fromWebSocket(socket), actor));
 */
export const serve = (resolve: Resolve, options: HostOptions = {}): Host => {
	const replay = options.replay ?? 256;
	const remembered = new Map<string, Remembered>();
	const rememberLimit = options.sessions ?? 1000;
	const documents = new Map<string, Live>();
	const conns = new Set<Conn>();

	/**
	 * The one way a commit reaches the members of a topic.
	 *
	 * It runs from inside core's delivery, so the order here is the order the document saw
	 * things: a commit that arrived, then anything a server-side watcher wrote in answer.
	 */
	const sendTo = (member: Member, frame: Frame): void => {
		if (member.owed !== undefined) {
			member.conn.send({ kind: 'accept', topic: member.topic, ...member.owed });
			member.owed = undefined;
		}
		member.conn.send(frame);
	};

	const publish = (live: Live, commit: Commit, landed: boolean): void => {
		live.seq += 1;
		const seq = live.seq;

		// The accept is owed from the moment the commit is numbered, which is before anything a
		// watcher writes in answer to it can be published. Order, not batching, is the point.
		if (landed && live.origin !== undefined) live.origin.owed = { through: live.originSeq, at: seq };

		if (replay > 0) {
			live.buffer.push({ seq, commit });
			if (live.buffer.length > replay) live.buffer.shift();
		}

		// Recording goes after core applied it, which is exactly where this runs, and it is the
		// only place a served document's index is fed. Nothing else can get it out of step.
		if (live.index !== undefined) record(live.index, commit);

		for (const member of live.members) {
			// Never the connection that sent it: it applied the commit locally already, and a
			// second arrival would give whatever it attached a second attach edge.
			if (landed && member === live.origin) continue;
			sendTo(member, { kind: 'commits', topic: member.topic, first: seq, commits: [commit] });
		}
	};

	const liveFor = (topic: Topic): Live => {
		const key = idToText(idOf(topic.document));
		// A policy is plain data, so this is what it says rather than which array it is, and a
		// resolve that builds its rules fresh every call still matches itself.
		const authority = JSON.stringify(topic.policy);
		const known = documents.get(key);
		if (known !== undefined) {
			// Two names for one document is fine and two authorities over it is not: whichever
			// join arrived first would decide what everyone after it may write.
			if (known.authority !== authority) {
				throw codecError(
					'policy-mismatch',
					`${key} is already served under a different policy, and a document has one`,
				);
			}
			return known;
		}

		if (topic.policy !== 'trusted') checkPolicy(topic.policy);

		const index = topic.policy === 'trusted' ? undefined : createIndex(idOf(topic.document));
		if (index !== undefined) {
			// A document the server built by mutating rather than by replay has no commits to
			// feed an index with. Saying it as one commit is that bootstrap, and it is the same
			// commit a replica with nothing is sent.
			const whole = asCommit(topic.document);
			if (whole !== undefined) record(index, whole);
		}

		// The listener names the record it is stored on. Tracking only ever fires from a
		// mutation, and no mutation can happen between these two statements.
		let live: Live;
		const tracker = track(topic.document, ({ commit, landed }) => { publish(live, commit, landed); });
		live = {
			document: topic.document, policy: topic.policy, index, tracker, authority,
			members: new Set(), buffer: [], seq: 0, origin: undefined, originSeq: 0,
		};

		documents.set(key, live);
		return live;
	};

	const forget = (conn: Conn): void => {
		const accepted = new Map<string, number>();
		for (const member of conn.members.values()) {
			// Everything through here was decided, accepted or refused. A verdict that was in
			// flight when the link dropped is lost; the reconcile on the way back makes the
			// document right either way.
			accepted.set(member.name, member.next - 1);
			member.live.members.delete(member);
		}
		conn.members.clear();
		conns.delete(conn);

		remembered.set(idToText(conn.session), { actor: conn.actor.id, accepted });
		while (remembered.size > rememberLimit) {
			remembered.delete(remembered.keys().next().value!);
		}
	};

	const accept = (channel: Channel, actor: Actor): Connection => {
		const post = outbox(channel);
		const conn: Conn = {
			channel, actor, session: createId(), members: new Map(),
			send: post.send, flush: post.flush,
		};
		conns.add(conn);

		// A join that is turned away is an answer, not a protocol violation, so the link carries
		// on for whatever else is on it. Only a frame that makes no sense ends it (design 012).
		const refuseJoin = (topic: number, reason: string, message: string): void => {
			conn.send({ kind: 'fault', topic, reason, message });
		};

		const fault = (topic: number, reason: string, message: string): void => {
			conn.send({ kind: 'fault', topic, reason, message });
			post.flush();
			channel.close();
		};

		const join = (topic: number, name: string, have: number, resume?: Uint8Array): void => {
			// A join for a topic this connection already holds is the client saying it lost the
			// thread and wants the document again, not a mistake. Only a second name on one
			// number is a mistake.
			const existing = conn.members.get(topic);
			if (existing !== undefined && existing.name !== name) {
				refuseJoin(topic, 'topic-in-use', `${topic} already names ${existing.name} on this connection`);
				return;
			}
			if (existing !== undefined) {
				existing.live.members.delete(existing);
				conn.members.delete(topic);
			}

			const resolved = resolve(name, actor);
			if (resolved === undefined) {
				refuseJoin(topic, 'no-topic', `nothing is served as ${name}`);
				return;
			}

			const live = liveFor(resolved);
			const prior = resume === undefined ? undefined : remembered.get(idToText(resume));
			// A resume only counts when this host is the one that handed out the session and the
			// actor is the same. Anything else is a client that has to be sent the document.
			const resuming = prior !== undefined && prior.actor === actor.id;
			// A connection that is still up knows how far it got without being told.
			const accepted = existing !== undefined
				? existing.next - 1
				: resuming ? prior.accepted.get(name) ?? 0 : 0;
			const held = existing !== undefined || resuming;

			const member: Member = { conn, topic, name, live, next: accepted + 1, owed: undefined };
			conn.members.set(topic, member);
			live.members.add(member);

			// Everything the client missed is still here: send that, not the whole document. It
			// needs the client to have held the document before, and the buffer to reach back far
			// enough to touch where the client stopped.
			// A client that has lost the thread leaves the topic before it joins again, so it
			// arrives here holding neither a member nor a session and is sent the document.
			// Replaying commits it already applied is what turns one lost frame into an endless
			// conversation, so `held` is what decides this and not the count alone.
			const last = live.buffer[live.buffer.length - 1];
			const covered = have === live.seq
				|| (last !== undefined && last.seq === live.seq && live.buffer[0]!.seq <= have + 1);
			const missed = held && have <= live.seq && covered
				? live.buffer.filter((entry) => entry.seq > have)
				: undefined;

			if (missed !== undefined) {
				conn.send({
					kind: 'joined', topic, accepted, seq: have, whole: false, session: conn.session,
					root: rootOf(live.document),
				});
				if (missed.length > 0) {
					conn.send({
						kind: 'commits', topic, first: missed[0]!.seq,
						commits: missed.map((entry) => entry.commit),
					});
				}
			} else {
				// `whole` says so even when there is no commit to carry: an empty document is
				// still a document, and a replica holding stale content has to hear that.
				const everything = asCommit(live.document);
				conn.send({
					kind: 'joined', topic, accepted, seq: live.seq, whole: true, session: conn.session,
					root: rootOf(live.document),
					...(everything === undefined ? {} : { reset: everything }),
				});
			}
		};

		const takeCommits = (member: Member, first: number, commits: readonly Commit[]): void => {
			if (first !== member.next) {
				fault(member.topic, 'out-of-order', `expected ${member.next} and was sent ${first}`);
				return;
			}

			const live = member.live;

			for (let i = 0; i < commits.length; i++) {
				const commit = commits[i]!;
				const seq = first + i;
				member.next = seq + 1;

				if (live.index !== undefined && live.policy !== 'trusted') {
					const verdict = validate(commit, { index: live.index, policy: live.policy, actor });
					if (!verdict.ok) {
						sendTo(member, {
							kind: 'refuse', topic: member.topic, seq,
							reasons: verdict.reasons.map((reason) => ({
								code: reason.code, message: reason.message,
								...(reason.path === undefined ? {} : { path: [...reason.path] }),
							})),
						});
						continue;
					}
				}

				live.origin = member;
				live.originSeq = seq;
				try {
					live.tracker.receive(commit);
				} catch (error) {
					sendTo(member, { kind: 'refuse', topic: member.topic, seq, reasons: reasonsOf(error) });
					continue;
				} finally {
					live.origin = undefined;
				}

				// A commit whose deltas all write what the slot already holds changes nothing, so
				// nothing is published for it and nothing owed an accept. It was still decided,
				// and a client waiting on it waits forever.
				if (member.owed?.through !== seq) member.owed = { through: seq, at: live.seq };
			}

			// Whatever is still owed goes now. Nothing after this point can reorder it.
			if (member.owed !== undefined) {
				conn.send({ kind: 'accept', topic: member.topic, ...member.owed });
				member.owed = undefined;
			}
		};

		channel.receive((frame) => {
			try {
				dispatch(frame);
			} catch (error) {
				// A host that throws mid-frame would otherwise leave the client waiting forever.
				// Say why, in the words the refusal used when it had any of its own.
				const reason = (error as { reason?: string }).reason;
				fault(frame.topic, reason ?? 'host-error', (error as Error).message);
			}
		});

		function dispatch(frame: Frame): void {
			if (frame.kind === 'join') {
				join(frame.topic, frame.name, frame.have, frame.resume);
				return;
			}

			const member = conn.members.get(frame.topic);
			if (member === undefined) {
				fault(frame.topic, 'no-such-topic', `${frame.topic} was never joined`);
				return;
			}

			if (frame.kind === 'commits') {
				takeCommits(member, frame.first, frame.commits);
			} else if (frame.kind === 'leave') {
				member.live.members.delete(member);
				conn.members.delete(frame.topic);
			} else {
				fault(frame.topic, 'not-for-a-host', `a host is not sent ${frame.kind}`);
			}
		}

		channel.closed(() => { forget(conn); });

		return {
			actor,
			close: () => { channel.close(); },
		};
	};

	return {
		accept,
		close: () => {
			for (const conn of [...conns]) conn.channel.close();
		},
		get connections() {
			return conns.size;
		},
	};
};

