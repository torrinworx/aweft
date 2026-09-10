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
	// already the one root toolchain. The database is the throwaway cluster on the `/postgres`
	// subpath (design 254): optional peers, so nothing here installs one for a consumer, and
	// devDependencies as well because this package's own suite starts a real cluster.
	'@aweftjs/testing': ['typescript', 'embedded-postgres', 'pg', '@types/pg'],
	// The frame runner's escape suite runs in a real browser, because no fake DOM enforces an
	// iframe's isolation (design 070). Dev only, this package only.
	'@aweftjs/sandbox': ['playwright'],
	// The server side of the WebSocket protocol is hostile-input parsing this stack does not write
	// itself (design 072). Its declaration file rides along as a dev dependency. This package only.
	'@aweftjs/server': ['ws', '@types/ws'],
	// One transform has to run in a bundler and in a browser, so it needs a parser that reads
	// TypeScript and JSX and still fits a page: 89 KB gzipped against `typescript`'s 1,595 KB, and
	// `acorn` cannot read TypeScript at all. `magic-string` edits the source in place so an
	// untouched line comes out byte for byte (design 088). This package only.
	'@aweftjs/build': ['@babel/parser', 'magic-string'],
	// The icon sets an application installs, as one family rather than one entry per set (design
	// 140). They are optional peers, so nothing here installs one, and the check refuses a peer
	// that is not marked optional. `@iconify-json/lucide` is a devDependency as well, because the
	// suite and the recipe read a real set.
	'@aweftjs/icons': ['@iconify-json/*'],
	// The country codes and their subdivisions, which nothing derives: the names come from the
	// host's own `Intl.DisplayNames` and the flags from the code (design 251). An optional peer, so
	// nothing here installs it, and a devDependency as well because the suite and the catalogue read
	// the real list.
	'@aweftjs/ui': ['country-region-data'],
	// The Postgres driver's obligations are transactional, and nothing but a real server enforces a
	// row lock (design 160). Dev only, this package only: the driver takes a pool the application
	// made and imports none of these.
	'@aweftjs/store': ['pg', '@types/pg', 'embedded-postgres'],
});

if (violations.length > 0) {
	for (const line of violations) console.error(line);
	console.error(`\n${violations.length} dependency violation(s).`);
	process.exit(1);
}

console.log(`dependencies: ${manifests.length} manifests inside the allowlist`);
