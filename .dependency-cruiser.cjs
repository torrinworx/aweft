// Package boundary rules, enforced on every run of the root gate.
//
// This file catches cycles and deep imports. The tier and plane rules live in
// boundaries.json (the table) and checkGraph in @aweftjs/testing (the check, with its own
// tests), because they are not expressible as dependency-cruiser rules and a rule written
// here that quietly matched nothing would read as a guarantee while delivering none.
//
// A package may import from its own tier or any tier below it. Never upward, and never
// across the client/server plane boundary. Two exceptions, both named here rather than
// left implicit: top-tier integrators may cross planes, and tooling sits outside the
// runtime rule entirely.
//
// The reason this is a machine check and not a convention: an unstated boundary gets
// crossed by whoever needs something at the time, and the crossing is invisible until it
// breaks. A rule the build enforces cannot be crossed by accident.

const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

// Every file a package's `exports` map names, as a path pattern. The deep-import rule below used
// to allow one file per package, `src/index.ts`, so a legitimate subpath entry
// (`@aweftjs/dom/router`, `@aweftjs/build/loader`) read as a reach into another package's
// internals. The rule's own comment always said "through its exports map"; this reads the maps
// rather than restating them, so a file that is not on one is still refused.
const entryFiles = () => {
	const here = join(__dirname, 'packages');
	const found = [];
	for (const name of readdirSync(here)) {
		const manifest = join(here, name, 'package.json');
		if (!existsSync(manifest)) continue;
		const map = JSON.parse(readFileSync(manifest, 'utf8')).exports ?? {};
		// An entry is a conditions object since design 256. The source condition is the one that
		// names a file in this tree; the other two name compiled output that is not committed.
		for (const entry of Object.values(map)) {
			const file = typeof entry === 'string' ? entry : entry['aweft-source'];
			if (typeof file !== 'string') continue;
			found.push(`^packages/${name}/${file.replace(/^\.\//, '').replace(/\./g, '\\.')}$`);
		}
	}
	return found;
};

module.exports = {
	forbidden: [
		{
			name: 'no-circular',
			severity: 'error',
			comment: 'Circular imports between packages hide a tier violation.',
			from: {},
			to: { circular: true },
		},
		{
			name: 'no-orphans',
			// An error, not a warning: a warning passes the gate, and an unwired source file is
			// exactly how untested code hides from a coverage pass that only sees loaded files.
			severity: 'error',
			comment: 'A module nothing imports is either dead or unwired.',
			from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)tests?/', '(^|/)scripts/'] },
			to: {},
		},
		{
			name: 'no-deep-package-import',
			comment:
				'Reach another package through its exports map, never into its files. This is the rule ' +
				'that stops outside code depending on names the minifier is free to rename.',
			severity: 'error',
			from: { path: '^packages/([^/]+)/' },
			to: {
				path: '^packages/([^/]+)/',
				pathNot: ['^packages/$1/', ...entryFiles()],
			},
		},
	],
	options: {
		// Count type-only imports. Without this a module reached only by `import type` reads as
		// an orphan, and a deep import into another package's internals would slip past the rule
		// above by being a type.
		tsPreCompilationDeps: true,
		// `dist/` is the compiled copy a publish carries (design 256). Cruising it would check the
		// same graph twice and read every re-export the compiler split out as an orphan.
		exclude: { path: '(^|/)dist/' },
		doNotFollow: { path: 'node_modules' },
		tsConfig: { fileName: 'tsconfig.base.json' },
		// `aweft-source` first, so a package resolves to the source in this tree rather than to the
		// compiled output a published one carries and a checkout does not (design 256).
		enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['aweft-source', 'import', 'node'] },
		reporterOptions: { text: { highlightFocused: true } },
	},
};
