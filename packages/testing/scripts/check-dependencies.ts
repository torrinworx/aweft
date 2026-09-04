// The dependency allowlist, run over the manifests that actually exist.
//
// The allowlist is here, in the check, so a claim that the gate refuses a second test
// framework names the file that refuses it. Widening it is a policy change and belongs in
// the same commit as the reasoning.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { type Manifest, checkManifests } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');

// A directory with no manifest is build residue, not a package: a checkout that moves across
// a package's first commit leaves the ignored build info behind and the directory with it.
// The coverage runner already skips those, and the two checks disagreeing meant this one died
// on a stack trace where the other carried on.
const manifests: Manifest[] = readdirSync(join(root, 'packages'))
	.filter((name) => statSync(join(root, 'packages', name)).isDirectory())
	.filter((name) => existsSync(join(root, 'packages', name, 'package.json')))
	.map((name) => JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')) as Manifest);

const violations = checkManifests(manifests, [], {
	// The boundary scanner parses source the way the compiler does, and the compiler is
	// already the one root toolchain.
	'@aweftjs/testing': ['typescript'],
	// The frame runner's escape suite runs in a real browser, because no fake DOM enforces an
	// iframe's isolation (design 070). Dev only, this package only.
	'@aweftjs/sandbox': ['playwright'],
	// The server side of the WebSocket protocol is hostile-input parsing this stack does not
	// write itself (design 072). Its declaration file rides along as a dev
	// dependency. This package only.
	'@aweftjs/server': ['ws', '@types/ws'],
});

if (violations.length > 0) {
	for (const line of violations) console.error(line);
	console.error(`\n${violations.length} dependency violation(s).`);
	process.exit(1);
}

console.log(`dependencies: ${manifests.length} manifests inside the allowlist`);
