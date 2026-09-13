// The security suite over the real battery: what every application that loads `auth` behind
// `auth/Gate` inherits (design 271).

import test from 'node:test';

import { loadServer, securityChecks } from '@aweftjs/testing';

import { auth } from '../src/index.ts';

import { newStore } from './helpers.ts';

for (const c of securityChecks({ gate: 'auth/Gate' })) {
	test(`${c.requirements.join(' ')}: ${c.name}`, () => c.run(async (given) => {
		const store = newStore();
		const server = await loadServer({ ...given, sources: [auth, ...given.sources], store });
		return { ...server, stop: async () => { await server.stop(); await store.stop(); } };
	}));
}
