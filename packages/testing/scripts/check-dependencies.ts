// The dependency allowlist, run over the manifests that actually exist.
//
// The allowlist is here, in the check, so a claim that the gate refuses a second test
// framework names the file that refuses it. Widening it is a policy change and belongs in
// the same commit as the reasoning.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { type Manifest, checkManifests } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');

const manifests: Manifest[] = readdirSync(join(root, 'packages'))
	.filter((name) => statSync(join(root, 'packages', name)).isDirectory())
	.map((name) => JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')) as Manifest);

const violations = checkManifests(manifests, [], {
	// The boundary scanner parses source the way the compiler does, and the compiler is
	// already the one root toolchain.
	'@aweftjs/testing': ['typescript'],
});

if (violations.length > 0) {
	for (const line of violations) console.error(line);
	console.error(`\n${violations.length} dependency violation(s).`);
	process.exit(1);
}

console.log(`dependencies: ${manifests.length} manifests inside the allowlist`);
