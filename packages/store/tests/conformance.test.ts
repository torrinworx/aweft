import test from 'node:test';

import { driverChecks } from '@aweftjs/testing';

import { memoryDriver } from '../src/index.ts';

// The memory driver proves the contract rather than being trusted with it.
for (const check of driverChecks()) {
	test(`[memory] ${check.name}`, () => check.run(() => memoryDriver()));
}
