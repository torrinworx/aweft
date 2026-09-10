// The publishing shape, run over the manifests that actually exist.
//
// A manifest that cannot publish, or that publishes the wrong thing, costs a version number to
// find out about: npm has no unpublish worth the name. So the gate reads them here rather than
// leaving it to the one command that would say so.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { type PublishManifest, checkPublishing } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');

const manifests: PublishManifest[] = readdirSync(join(root, 'packages'))
	.filter((name) => statSync(join(root, 'packages', name)).isDirectory())
	.filter((name) => existsSync(join(root, 'packages', name, 'package.json')))
	.map((name) => JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')) as PublishManifest);

const violations = checkPublishing(manifests);

if (violations.length > 0) {
	for (const line of violations) console.error(line);
	console.error(`\n${violations.length} publishing violation(s).`);
	process.exit(1);
}

const version = manifests[0]?.version ?? 'nothing';
console.log(`publishing: ${manifests.length} manifests publishable at ${version}`);
