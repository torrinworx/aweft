// Recipe: an optimistic write the server refuses.
//
// The client writes at once, without asking. Most of the time that is right and the write
// simply crosses. When it is not, the write has already landed locally and has to be taken
// back. This is the whole round trip, including the rollback most applications forget.

import assert from 'node:assert/strict';

import { apply, createArray, createObject } from '@aweftjs/core';
import { connect, inProcess, type Refused } from '@aweftjs/sync';
import { explain } from '@aweftjs/debug';

interface Board { title: string; tasks: { title: string; done: boolean }[] }

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const [clientSide, serverSide] = inProcess();

// The server end. Its rules live in `accept`, which sees an arriving commit before it applies
// and returns the reasons to refuse. An empty array accepts. The package never asks who sent
// a commit, so "server" here is a topology this recipe chose, not a role the link knows.
const stored = createObject<Board>({ title: 'this week', tasks: createArray() });
const server = connect(serverSide);
server.share('board', stored, {
	accept: (commit) => commit.deltas.some((d) => d.type === 'remove')
		? [{ code: 'read-only', message: 'a task is closed, never removed' }]
		: [],
});

// The client end. It holds `undo` for anything refused, and decides what to do with it. The
// link never decides.
const refusals: Refused[] = [];
const client = connect(clientSide);
const shared = client.share<Board>('board', undefined, {
	refused: (report) => refusals.push(report),
});
const board = await shared.ready;

// The good path: the write lands here immediately, then crosses.
board.tasks.push(createObject({ title: 'write the recipe', done: false }));
assert.equal(board.tasks.length, 1, 'the write applied locally with no round trip');
await settle();
assert.equal(stored.tasks.length, 1, 'and then it arrived at the other end');
assert.equal(refusals.length, 0, 'nothing was refused');

// The refused path. The removal applies HERE first, because that is what optimistic means.
board.tasks.splice(0, 1);
assert.equal(board.tasks.length, 0, 'the client already believes the task is gone');
assert.equal(stored.tasks.length, 1, 'while the server still has it');

await settle();

assert.equal(refusals.length, 1, 'the sending end is told');
const report = refusals[0]!;
assert.equal(report.mine, true, 'mine is true because this end sent it');
assert.equal(report.reasons[0]!.code, 'read-only', 'carrying the code the rule returned');
assert.ok(report.undo !== undefined, 'and the commit that takes the write back');
assert.equal(stored.tasks.length, 1, 'the server never applied it');

// Rolling back is one line, and it is YOURS to decide. Applying `undo` yields; ignoring it
// keeps the local version and leaves the two ends apart until something else settles it.
assert.equal(board.tasks.length, 0, 'until you act, the client is still showing the wrong thing');
apply(board, report.undo!);
assert.equal(board.tasks.length, 1, 'the task is back');
assert.equal(board.tasks[0]!.title, 'write the recipe', 'with what it held before the write');

// A refusal reads as text without any work, which is what you want at three in the morning.
const readable = explain(stored);
assert.match(readable, /write the recipe/, 'the server document still holds the task');
assert.equal(report.reasons[0]!.message, 'a task is closed, never removed', 'and the rule said why');

// What this recipe does NOT do: it never decides for you. Nothing rolls back on its own,
// because an application that wants to keep its version and make the other end yield is just
// as valid, and this layer cannot tell the two apart.
client.close();
server.close();
console.log('recipes/optimistic-write: ok');
