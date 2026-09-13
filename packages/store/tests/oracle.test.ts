// The store against its second reading, over the memory driver. The Postgres driver runs the
// same oracle from its own suite, where the cluster is.

import test from 'node:test';

import { memoryDriver } from '../src/index.ts';
import { memoryTarget, oracle } from './oracle.ts';

for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 20260913, 4242]) {
	test(`the store answers as the model says over seeded random operations, seed ${String(seed)}`, async () => {
		await oracle(memoryTarget(memoryDriver()), seed, 120);
	});
}
