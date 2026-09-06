// Recipe: two clients editing one document.
//
// The question this answers is what happens when two people type at once. Both ends are the
// same code, the link is symmetric, and neither end is the authority. It runs in one process
// over the in-process channel, which behaves exactly as a socket does: delivery is always
// asynchronous, so a test that does not wait is a test that passes by accident.

import assert from 'node:assert/strict';

import { createArray, createObject } from '@aweftjs/core';
import { connect, inProcess } from '@aweftjs/sync';

interface Board { title: string; tasks: { title: string }[] }

// Settle the link: delivery is queued, so waiting a macrotask is what "after it arrives" means.
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const [here, there] = inProcess();

// The end that has the document shares it under a name. The name is the topic and rides on the
// opening frame only.
const board = createObject<Board>({ title: 'this week', tasks: createArray() });
const alice = connect(here);
alice.share('board', board);

// The end that has nothing names the same topic and waits. The document it gets back is minted
// from the other end's root id, so both ends agree on identity without being told.
const bob = connect(there);
const bobBoard = bob.share<Board>('board');
const mirror = await bobBoard.ready;

assert.equal(mirror.title, 'this week', 'the second end starts from the first end state');
assert.notEqual(mirror, board, 'and it is its own document, not a shared reference');

// One edit crosses.
board.tasks.push(createObject({ title: 'write the recipe' }));
await settle();
assert.equal(mirror.tasks.length, 1, 'a push at one end arrives at the other');
assert.equal(mirror.tasks[0]!.title, 'write the recipe', 'with what it carried');

// Both ends edit at once. Neither waits for the other, which is the whole point of a local
// first write: each applies immediately and the commits cross afterwards.
board.tasks.push(createObject({ title: 'from alice' }));
mirror.tasks.push(createObject({ title: 'from bob' }));
await settle();

assert.equal(board.tasks.length, 3, 'alice sees both new rows');
assert.equal(mirror.tasks.length, 3, 'and so does bob');
assert.deepEqual(
	board.tasks.map((t) => t.title),
	mirror.tasks.map((t) => t.title),
	'the two lists agree on order, because a position is chosen once and carried, not recomputed',
);

// Both ends write the SAME slot at once. Read this part carefully, because it is the one place
// the stack does not decide for you and the failure is quiet if you assume it does.
//
// Inserts never collide: both rows above survived. Replacing one slot does collide. Each end
// applies its own write, then the other's arrives and is applied on top, so the two end up
// holding each other's value and stay that way. Waiting longer does not fix it. There is no
// tiebreak, because any tiebreak this layer picked would be wrong for some application.
const bobShare = bobBoard;
board.title = 'alice week';
mirror.title = 'bob week';
await settle();

assert.equal(board.title, 'bob week', 'alice ended up holding bob write');
assert.equal(mirror.title, 'alice week', 'and bob ended up holding alice');
assert.notEqual(board.title, mirror.title, 'so the two ends have diverged, and will stay so');

// Yielding is how it ends, and choosing who yields is your application's rule to write. The end
// that yields throws its version away and moves to the other end's state. The document is moved
// rather than swapped, so every watcher and reference you are holding keeps working.
bobShare.resync();
await settle();
assert.equal(mirror.title, board.title, 'after the yield the two ends agree again');
assert.equal(mirror.title, 'bob week', 'on the state the end that did not yield was holding');

// Closing one end stops the traffic and leaves both documents where they were.
const settled = board.title;
alice.close();
mirror.title = 'after the close';
await settle();
assert.equal(board.title, settled, 'nothing arrives on a closed link');
assert.equal(mirror.title, 'after the close', 'and the local write still applied locally');

bob.close();
console.log('recipes/two-clients: ok');
