// A shared workspace with three actors, and a policy that decides every commit it takes.
//
// The job is one an application would actually have: members keep their own profile, everyone
// writes notes, a moderator pins them and keeps an audit trail, and nobody at all touches a
// verification flag. What makes it a proof rather than a demo is that every commit goes over
// the real seam, encoded to bytes and decoded on the far side, and the server knows nothing
// about who sent it beyond the actor on the connection. An unauthorized commit never reaches
// the document, and the client that sent it converges back to what the server took.
//
// Run: node examples/schema/main.ts

import { decodeCommit, encodeCommit, idFromText } from '@aweftjs/codec';
import type { Commit, Delta } from '@aweftjs/codec';
import {
	alias, apply, atomic, createArray, createMap, createObject, idOf, observer, snapshot,
	textIdOf,
} from '@aweftjs/core';
import type { Change, ObservableMap, Snapshot } from '@aweftjs/core';
import { ANY, REST, SELF, createIndex, pathOf, record, validate } from '@aweftjs/schema';
import type { Actor, Policy, Reason } from '@aweftjs/schema';

// --- the application ---------------------------------------------------------------------

interface Profile extends Record<string, unknown> { name?: string; verified?: boolean }
interface Note extends Record<string, unknown> { title?: string; pinned?: boolean }

interface Space {
	users?: ObservableMap<Profile>;
	notes?: Record<string, Note>;
	audit?: string[];
}

/**
 * Who may write what.
 *
 * This is the whole authority of the application, and it is data: it can be printed, diffed
 * and stored, and nothing else in the program decides a write.
 */
const policy: Policy = [
	// Your own profile is yours, and everything in it.
	{ effect: 'allow', path: ['users', SELF, REST] },
	// Except the verification flag, which is nobody's. A deny beats every allow, so the
	// moderator rules below do not quietly reopen it.
	{ effect: 'deny', path: ['users', ANY, 'verified'] },
	// Notes are shared: anyone may start one and write what a note says. The fields are named
	// rather than covered by one subtree grant, because `pinned` below has different authority
	// and a grant of ['notes', REST] would hand it out with the rest.
	{ effect: 'allow', path: ['notes', ANY] },
	{ effect: 'allow', path: ['notes', ANY, 'title'] },
	{ effect: 'allow', path: ['notes', ANY, 'body'] },
	// Pinning and the audit trail belong to moderators.
	{ effect: 'allow', path: ['notes', ANY, 'pinned'], roles: ['moderator'] },
	{ effect: 'allow', path: ['audit', REST], roles: ['moderator'] },
];

// --- the checks --------------------------------------------------------------------------

let checks = 0;

const check = (ok: boolean, what: string): void => {
	checks += 1;
	if (!ok) {
		console.error(`FAIL: ${what}`);
		process.exit(1);
	}
};

const canonical = (value: unknown): string => {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;

	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
		.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
		.join(',')}}`;
};

const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

const codes = (report: Report): string[] =>
	report.refused.flatMap((r) => r.reasons.map((reason) => reason.code));

// --- the server --------------------------------------------------------------------------

const server = createObject<Space>();
const index = createIndex(idOf(server));

interface Sent { readonly bytes: Uint8Array; readonly commit: Commit; readonly inverse: Commit }

/** Everything one refusal window produced, handed to the application as one event. */
interface Report { readonly refused: readonly { readonly reasons: readonly Reason[] }[] }

interface Client {
	actor: Actor;
	readonly doc: Space;
	outgoing: Sent[];
	receiving: boolean;
}

const clients: Client[] = [];
let sender: Client | undefined;

/** What the server has taken and not yet sent on, with who it came from. */
const outbound: Array<{ readonly commit: Commit; readonly from: Client | undefined }> = [];

// Everything the server takes, from a client or from its own hand, goes to the index and into
// the outbound queue. Recording after the commit was applied is the contract: a commit the
// applier refused must never reach the index.
observer(server).watch((change: Change) => {
	record(index, change);
	outbound.push({ commit: { deltas: [...change.deltas] }, from: sender });
});

/**
 * Send what the server took to every replica but the one it came from.
 *
 * Queued rather than sent from inside the watcher, because delivery is deferred: a commit
 * applied from inside a watcher reaches that document's own watchers after the outer watcher
 * has returned, so a flag held across the `apply` call would already be false when they run.
 * A real transport queues here anyway, since writing to a socket is not synchronous.
 */
const deliver = (): void => {
	while (outbound.length > 0) {
		const { commit, from } = outbound.shift()!;

		for (const client of clients) {
			if (client === from) continue;
			client.receiving = true;
			apply(client.doc, commit);
			client.receiving = false;
		}
	}
};

type Verdict = { ok: true } | { ok: false; reasons: readonly Reason[] };

/**
 * Take a commit from a client.
 *
 * The connection says who is speaking and the policy says what they may do. A refusal refuses
 * the commit and the connection stays up.
 */
const submit = (from: Client, bytes: Uint8Array): Verdict => {
	const commit = decodeCommit(bytes);

	const verdict = validate(commit, { index, policy, actor: from.actor });
	if (!verdict.ok) return { ok: false, reasons: verdict.reasons };

	sender = from;
	apply(server, commit);
	sender = undefined;
	return { ok: true };
};

// --- the clients -------------------------------------------------------------------------

const connect = (actor: Actor): Client => {
	const client: Client = {
		actor,
		doc: createObject<Space>(undefined, idOf(server)),
		outgoing: [],
		receiving: false,
	};

	observer(client.doc).watch((change: Change) => {
		// A watcher cannot tell an applied commit from a local mutation, so this flag is what
		// keeps the server's own broadcasts out of this client's outbox.
		if (client.receiving) return;
		client.outgoing.push({
			bytes: encodeCommit(change),
			commit: { deltas: [...change.deltas] },
			inverse: change.inverse(),
		});
	});

	clients.push(client);
	return client;
};

/**
 * Send everything this client has written, and converge if any of it was refused.
 *
 * Rolling back to the last state the server accepted and replaying what it took is the only
 * recovery that works in every case, and it is the framework's job rather than the
 * application's. What the application gets is one report for the whole window.
 */
const flush = (client: Client): Report => {
	const sent = client.outgoing;
	client.outgoing = [];

	const accepted: Sent[] = [];
	const refused: { reasons: readonly Reason[] }[] = [];

	for (const item of sent) {
		const verdict = submit(client, item.bytes);
		if (verdict.ok) accepted.push(item);
		else refused.push({ reasons: verdict.reasons });
	}

	deliver();

	if (refused.length > 0) {
		client.receiving = true;
		for (let i = sent.length - 1; i >= 0; i--) apply(client.doc, sent[i]!.inverse);
		for (const item of accepted) apply(client.doc, item.commit);
		client.receiving = false;
	}

	return { refused };
};

// --- the run -----------------------------------------------------------------------------

const alice = connect({ id: 'not yet known' });
const bob = connect({ id: 'not yet known' });
const mod = connect({ id: 'not yet known', roles: ['moderator'] });

// The server lays the space out by hand. A local write on the machine that holds the document
// needs no wire and no policy; the policy is what guards the wire, which is where everything
// below this line goes.
atomic(() => {
	server.users = createMap<Profile>();
	server.notes = createObject<Record<string, Note>>();
	server.audit = createArray<string>();
});

const profileFor = (name: string): string => {
	let id = '';
	atomic(() => {
		const profile = createObject<Profile>();
		server.users!.add(profile);
		profile.name = name;
		profile.verified = false;
		id = textIdOf(profile);
	});
	return id;
};

alice.actor = { id: profileFor('Alice') };
bob.actor = { id: profileFor('Bob') };
mod.actor = { id: profileFor('Mod'), roles: ['moderator'] };
deliver();

check(server.users!.size === 3, 'the space starts with three profiles');
check(same(snapshot(alice.doc), snapshot(server)), 'every replica has the space the server laid out');

// 1. An actor writes their own region, and it lands everywhere.
alice.doc.users!.get(alice.actor.id)!.name = 'Alice A';
check(flush(alice).refused.length === 0, 'writing your own profile is authorized');
check(server.users!.get(alice.actor.id)!.name === 'Alice A', 'the authorized write reached the server');
check(bob.doc.users!.get(alice.actor.id)!.name === 'Alice A', 'and reached the other replicas');

// 2. The same write into somebody else's region is refused, and the sender converges.
alice.doc.users!.get(bob.actor.id)!.name = 'Bob B';
const intrusion = flush(alice);
check(codes(intrusion).join() === 'unauthorized', 'writing another profile is refused as unauthorized');
check(server.users!.get(bob.actor.id)!.name === 'Bob', 'the refused write never reached the document');
check(alice.doc.users!.get(bob.actor.id)!.name === 'Bob', 'and the client rolled back to what the server took');
check(same(snapshot(alice.doc), snapshot(server)), 'a refusal leaves the replica in step, not forked');

// 3. A whole subtree in one commit is judged at the paths that commit gives it.
atomic(() => {
	const note = createObject<Note>();
	alice.doc.notes!.n1 = note;
	note.title = 'first note';
});
check(flush(alice).refused.length === 0, 'a new note and its contents are one authorized commit');
check(server.notes!.n1!.title === 'first note', 'the subtree landed whole');

// 4. A rule that names a role reaches only actors holding it.
alice.doc.notes!.n1!.pinned = true;
check(codes(flush(alice)).join() === 'unauthorized', 'a member cannot pin a note');
check(server.notes!.n1!.pinned === undefined, 'and the pin did not land');

mod.doc.notes!.n1!.pinned = true;
check(flush(mod).refused.length === 0, 'a moderator can pin a note');
check(server.notes!.n1!.pinned === true, 'and the pin landed');

mod.doc.audit!.push('pinned n1');
check(flush(mod).refused.length === 0, 'a moderator writes the audit trail');
alice.doc.audit!.push('and so do I');
check(codes(flush(alice)).join() === 'unauthorized', 'a member does not');
check(server.audit!.length === 1, 'the audit trail holds only what a moderator wrote');

// 5. A deny beats every allow, including the one a role gave.
mod.doc.users!.get(mod.actor.id)!.verified = true;
check(codes(flush(mod)).join() === 'unauthorized', 'a deny beats the role grant that would have allowed it');
check(server.users!.get(mod.actor.id)!.verified === false, 'so the flag nobody may set is still false');

// 6. A refusal arrives as a group: the commit that was refused, and everything that depended
//    on it, in one report against a document that is already consistent.
const stranger = createObject<Profile>();
atomic(() => {
	alice.doc.users!.get(bob.actor.id)!.pet = stranger;
	stranger.name = 'rex';
});
stranger.kind = 'cat';
stranger.age = 3;

const group = flush(alice);
check(group.refused.length === 3, 'three commits were sent inside the refusal window');
check(
	codes(group).join() === 'unauthorized,unauthorized,unreachable,unreachable',
	`the first is refused on authority and the rest as unreachable, got ${codes(group).join()}`,
);
check(same(snapshot(alice.doc), snapshot(server)), 'the whole window rolled back, leaving no fork');
check(server.users!.get(bob.actor.id)!.pet === undefined, 'and none of it reached the document');

// 7. A hostile client does not have to use the framework. This frame is built by hand and
//    gives another actor's profile a second home inside the sender's own region, which no
//    mutation through the API could produce, so the seam is the only thing standing in
//    the way.
const capture: Delta = {
	type: 'add',
	id: idFromText(alice.actor.id),
	ref: { kind: 'object', key: 'captured' },
	value: { edge: 'attach', kind: 'object', id: idFromText(bob.actor.id) },
};
const stolen = submit(alice, encodeCommit({ deltas: [capture] }));
check(!stolen.ok, 'a hand built frame does not get past the seam');
check(
	!stolen.ok && stolen.reasons.map((r) => r.code).join() === 'multiple-attach',
	'and it is refused because no path would decide who owns the profile',
);
check(server.users!.get(alice.actor.id)!.captured === undefined, 'nothing of it reached the document');

// 8. An alias is not a capture: it is authorized where it is written, and grants nothing about
//    what it names.
alice.doc.users!.get(alice.actor.id)!.friend = alias(alice.doc.users!.get(bob.actor.id)!);
check(flush(alice).refused.length === 0, 'naming another actor profile from your own region is fine');
(alice.doc.users!.get(alice.actor.id)!.friend as Profile).name = 'through the alias';
check(codes(flush(alice)).join() === 'unauthorized', 'and writing through the alias is still refused');
check(server.users!.get(bob.actor.id)!.name === 'Bob', 'so the profile the alias names is untouched');

// 9. Every replica, and the index, still agree with the document.
const places = (state: Snapshot): Map<string, readonly string[]> => {
	const found = new Map<string, readonly string[]>([[state.root, []]]);
	const queue = [state.root];

	while (queue.length > 0) {
		const at = queue.shift()!;
		const here = found.get(at)!;
		for (const [slot, value] of Object.entries(state.observables[at]?.slots ?? {})) {
			if (value === null || typeof value !== 'object' || value instanceof Uint8Array) continue;
			if (value.edge !== 'attach' || found.has(value.ref)) continue;
			found.set(value.ref, [...here, slot]);
			queue.push(value.ref);
		}
	}
	return found;
};

for (const client of clients) {
	check(same(snapshot(client.doc), snapshot(server)), 'every replica ends where the server is');
}

let placed = 0;
for (const [id, path] of places(snapshot(server))) {
	const at = pathOf(index, idFromText(id));
	check(at !== undefined && same(at, path), `the index places ${id} where the document does`);
	placed += 1;
}
check(placed >= 8, `the document has enough in it to be worth checking, saw ${placed}`);

console.log(`schema proof: ${checks} checks, ${placed} observables placed, ${server.users!.size} actors`);
