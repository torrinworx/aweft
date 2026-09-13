// The security suite over this application: the same modules, the same battery, the same gate
// the backend boots with. An application copies this file and changes the two lines that name
// its own modules and store.
//
// Run: node --import @aweftjs/build/loader --test recipes/full-stack/tests/*.test.ts

import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { auth, paths } from '@aweftjs/auth';
import { fromDirectory } from '@aweftjs/modules/node';
import { createStore, memoryDriver } from '@aweftjs/store';
import { loadServer, securityChecks } from '@aweftjs/testing';

const modules = fileURLToPath(new URL('../backend/modules', import.meta.url));

for (const c of securityChecks({ gate: 'auth/Gate' })) {
	test(`${c.requirements.join(' ')}: ${c.name}`, () => c.run(async (given) => {
		const store = createStore({ driver: memoryDriver(), declare: { ...paths } });
		const server = await loadServer({ ...given, sources: [fromDirectory(modules), auth, ...given.sources], store });
		return { ...server, stop: async () => { await server.stop(); await store.stop(); } };
	}));
}
