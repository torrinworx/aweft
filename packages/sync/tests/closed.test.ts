// The channel ending under a link is something the application did not ask for, so it hears
// about it. Without that, every topic ends in silence.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createObject } from '@aweftjs/core';
import { connect, inProcess } from '@aweftjs/sync';

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

test('when the channel ends under a link, every share hears closed through fault, and a waiting ready rejects', async () => {
	const [a, b] = inProcess();
	const near = connect(a);
	const far = connect(b);
	const faults: string[] = [];

	near.share('board', createObject({ title: 'x' }), { fault: (reason) => { faults.push(`board:${reason}`); } });
	const copy = far.share('board', undefined, { fault: (reason) => { faults.push(`copy:${reason}`); } });
	await copy.ready;
	const never = near.share('other', undefined, { fault: (reason) => { faults.push(`other:${reason}`); } });
	never.ready.catch(() => {});

	b.close();
	await tick();
	await tick();
	assert.deepStrictEqual(faults.sort(), ['board:closed', 'copy:closed', 'other:closed']);
	await assert.rejects(never.ready, (error: { reason?: string }) => error.reason === 'closed');
});

test('closing the link yourself tells nobody, because you asked for it', async () => {
	const [a, b] = inProcess();
	const near = connect(a);
	connect(b);
	const faults: string[] = [];
	near.share('board', createObject({}), { fault: (reason) => { faults.push(reason); } });
	await tick();

	near.close();
	await tick();
	await tick();
	assert.deepStrictEqual(faults, []);
});
