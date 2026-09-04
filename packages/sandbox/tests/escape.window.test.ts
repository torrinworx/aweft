// The window half of the escape suite, in every runner that runs under Node. The frame runner
// runs the same checks under a browser in escape.iframe.test.ts.

import test from 'node:test';

import { roomChecks } from '@aweftjs/testing';

import { runners } from './helpers.ts';

for (const [label, make] of Object.entries(runners)) {
	for (const c of roomChecks()) {
		test(`${label}: ${c.name}`, () => c.run(make));
	}
}
