// The socket harness: two ends of one socket with no port, and the lifecycle the stack listens
// for. Four suites wrote this by hand, so what they each relied on is pinned here once.

import test from 'node:test';
import assert from 'node:assert/strict';

import { socketPair } from '../src/index.ts';

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

test('what one end sends, the other hears', async () => {
	const [near, far] = socketPair();
	const heard: unknown[] = [];
	far.addEventListener('message', (event) => { heard.push(event.data); });

	near.send('hello');
	assert.deepEqual(heard, [], 'delivery is not synchronous, or a send would re-enter its own sender');
	await tick();
	assert.deepEqual(heard, ['hello']);
});

test('each end records what it sent', () => {
	const [near, far] = socketPair();
	near.send('one');
	far.send('two');
	assert.deepEqual(near.sent, ['one']);
	assert.deepEqual(far.sent, ['two']);
});

test('closing one end closes the other, and fires close at both', async () => {
	const [near, far] = socketPair();
	const closed: string[] = [];
	near.addEventListener('close', () => { closed.push('near'); });
	far.addEventListener('close', () => { closed.push('far'); });

	near.close();
	await tick();
	assert.deepEqual(closed, ['near', 'far']);
	assert.equal(near.readyState, 3);
	assert.equal(far.readyState, 3);
});

test('a close after a close does nothing', async () => {
	const [near, far] = socketPair();
	let fired = 0;
	near.addEventListener('close', () => { fired += 1; });

	near.close();
	near.close();
	await tick();
	assert.equal(fired, 1);
	assert.equal(far.readyState, 3);
});

test('the near end can start connecting, because that is the order a page sees', () => {
	const [near, far] = socketPair(0);
	assert.equal(near.readyState, 0, 'the page has not been told the socket is open yet');
	assert.equal(far.readyState, 1, 'the server was handed an accepted socket');
});

test('a listener added while an event is dispatching does not hear that event', async () => {
	const [near, far] = socketPair();
	const heard: string[] = [];
	let added = false;
	far.addEventListener('message', () => {
		heard.push('first');
		if (added) return;
		added = true;
		far.addEventListener('message', () => { heard.push('late'); });
	});

	near.send('one');
	await tick();
	assert.deepEqual(heard, ['first'], 'a real EventTarget does not call a listener added mid-dispatch');

	near.send('two');
	await tick();
	assert.deepEqual(heard, ['first', 'first', 'late'], 'it hears the next event, in the order it was added');
});

test('a listener that throws does not stop the listeners after it', async () => {
	const [near, far] = socketPair();
	const heard: string[] = [];
	// `loadServer` puts two of these on one socket, the link and the call channel. Without this
	// the link throwing means the call channel never hears the message, and an ask that never
	// settles is a test that times out pointing at the wrong thing.
	far.addEventListener('message', () => { throw new Error('the first listener blew up'); });
	far.addEventListener('message', () => { heard.push('second'); });

	near.send('one');
	await tick();
	assert.deepEqual(heard, ['second']);
	assert.equal(far.thrown.length, 1, 'the throw is recorded rather than lost');
});

test('a send before the socket is open, or after it closed, reaches nobody', async () => {
	const [connecting, itsPeer] = socketPair(0);
	const early: unknown[] = [];
	itsPeer.addEventListener('message', (event) => { early.push(event.data); });
	connecting.send('too soon');
	await tick();
	assert.deepEqual(early, [], 'a real socket refuses a send before it is open');

	const [near, far] = socketPair();
	const late: unknown[] = [];
	far.addEventListener('message', (event) => { late.push(event.data); });
	near.close();
	await tick();
	near.send('too late');
	await tick();
	assert.deepEqual(late, [], 'a real socket drops a send after it closed');
});
