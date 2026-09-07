// The generator behind the virtual modules (design 141), and the refusal for a set nobody
// installed (design 140).
//
// Every expectation here comes from the set format rather than from what the generator produced:
// a Lucide icon is drawn in the set's own 24 by 24 box because the set says so at its root, and
// the standard selection is `ui`'s list, not a list this file keeps.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { standardIcons } from '@aweftjs/ui/icon-names';
import type { IconData, IconPack } from '@aweftjs/ui';

import { moduleFor } from '@aweftjs/icons/node';
// Type-only, so nothing here loads a generated module at run time. What these two names are for
// is the test at the bottom of this file.
import type generatedIcon from '@aweftjs/icons/lucide/check';
import type generatedStandard from '@aweftjs/icons/lucide/+standard';

const here = import.meta.dirname;

/** What a call refused with. `assert.throws` answers nothing, and the fields are the contract. */
const refusalOf = (fn: () => unknown): { reason: string; fix: string; message: string } => {
	try {
		fn();
	} catch (error) {
		return error as { reason: string; fix: string; message: string };
	}
	throw new Error('nothing was refused');
};

/** What a generated module evaluates to, read the way a bundler's output would be read. */
const valueOf = async (source: string): Promise<unknown> => {
	const module = await import(`data:text/javascript,${encodeURIComponent(source)}`) as { default: unknown };
	return module.default;
};

test('one icon is one icon, with the set\'s own box on it', async () => {
	const source = moduleFor('lucide/check', here);
	assert.ok(source !== null);
	assert.match(source, /^export default \{.*\};\n$/s);

	const icon = await valueOf(source) as IconData;
	assert.equal(icon.width, 24, 'the set states 24 at its root and the icon states nothing');
	assert.equal(icon.height, 24);
	assert.match(icon.body, /^<path /, 'and the drawing is the set\'s own body');
	assert.ok(source.length < 300, `one icon is ${String(source.length)} bytes of module`);
});

test('the module source carries no literal < , so it survives being inlined into a page', () => {
	const source = moduleFor('lucide/check', here)!;
	assert.ok(!source.includes('<'), 'every < in a body is escaped');
	assert.match(source, /\\u003cpath/);
});

test('an alias resolves to its parent', async () => {
	// `alarm-check` is the older name Lucide publishes for `alarm-clock-check`, as an alias.
	const alias = await valueOf(moduleFor('lucide/alarm-check', here)!) as IconData;
	const parent = await valueOf(moduleFor('lucide/alarm-clock-check', here)!) as IconData;
	assert.equal(alias.body, parent.body);
});

test('a whole set is a pack with its root size, and it is large', async () => {
	const source = moduleFor('lucide', here)!;
	const pack = await valueOf(source) as IconPack;
	assert.equal(pack.prefix, 'lucide');
	assert.equal(pack.width, 24, 'the root size stays on the pack rather than on 1800 icons');
	assert.equal(pack.height, 24);
	assert.ok(Object.keys(pack.icons).length > 1000);
	assert.ok(source.length > 400_000, `the whole set is ${String(source.length)} bytes, which is the reason for the other two`);
});

test('the standard selection is ui\'s list, and only what the set has', async () => {
	const source = moduleFor('lucide/+standard', here)!;
	const pack = await valueOf(source) as IconPack;
	const names = Object.keys(pack.icons);

	assert.deepEqual(names, standardIcons.filter((name) => names.includes(name)),
		'the names are ui\'s, in ui\'s order');
	assert.ok(names.length > 0 && names.length <= standardIcons.length);
	for (const name of standardIcons) {
		assert.ok(names.includes(name), `lucide publishes ${name}`);
	}
	assert.equal((pack.icons['check'] as IconData).width, 24, 'each one carries the set\'s box already');
	assert.equal(pack.width, undefined, 'so the selection needs no root size');
	assert.ok(source.length < 3000, `the selection is ${String(source.length)} bytes`);
});

test('a set that is not installed refuses, and the message carries the install command', () => {
	const empty = mkdtempSync(`${tmpdir()}/aweft-icons-`);
	try {
		const thrown = refusalOf(() => moduleFor('tabler/home', empty));
		assert.equal(thrown.reason, 'set-not-installed');
		assert.match(thrown.message, /run: npm install @iconify-json\/tabler/);
		assert.equal(thrown.fix, 'Install the icon set the message names, or hand a pack of your own to Icons.');
	} finally {
		rmSync(empty, { recursive: true, force: true });
	}
});

test('a set that is installed but lacks the icon refuses by name', () => {
	const thrown = refusalOf(() => moduleFor('lucide/not-an-icon-anyone-drew', here));
	assert.equal(thrown.reason, 'icon-not-in-set');
	assert.match(thrown.message, /the set "lucide" has no icon named "not-an-icon-anyone-drew"/);
});

test('a request that is not one of the three is left to ordinary resolution', () => {
	// A set name and an icon name are the sets' own grammar and nothing else, so a segment that
	// is a path step, a capital or a file extension is not a request at all. `..` is the one that
	// matters: `@iconify-json/../icons.json` resolves to a file in the asking directory's own
	// `node_modules`, which is not in any set.
	const notRequests = [
		'', 'lucide/check/deep', 'lucide/', '/check', 'lucide//check',
		'..', '../x', 'a/..', 'lucide/Check', 'Lucide/check', 'lucide/check.svg', 'lucide/my icon',
	];
	for (const request of notRequests) {
		assert.equal(moduleFor(request, here), null, `${request} is not a request this answers`);
	}
});

test('a set is never read from outside a set, however the request is spelled', () => {
	// The file a traversal would reach, planted where it would be found: `@iconify-json/../icons.json`
	// resolves to `<from>/node_modules/icons.json`. Nothing may read it.
	const root = fileURLToPath(new URL('../../../.scratch/', import.meta.url));
	mkdirSync(root, { recursive: true });
	const app = mkdtempSync(join(root, 'icons-traversal-'));
	mkdirSync(join(app, 'node_modules'), { recursive: true });
	writeFileSync(join(app, 'node_modules', 'icons.json'),
		JSON.stringify({ icons: { planted: { body: '<circle r="7"/>' } } }));

	try {
		for (const request of ['..', '../x', '../icons.json', 'a/..']) {
			assert.equal(moduleFor(request, app), null, `${request} reads nothing`);
		}
	} finally {
		rmSync(app, { recursive: true, force: true });
	}
});

test('the standard segment cannot be an icon name', async () => {
	// `+standard` is the whole point: no set can publish a name with a `+` in it, so the
	// selection can never take a name an application wanted (design 142).
	const selection = await valueOf(moduleFor('lucide/+standard', here)!) as IconPack;
	assert.ok(selection.icons['+standard'] === undefined);
	assert.equal(moduleFor('lucide/+notastandard', here), null,
		'and anything else with a + in it is not a name a set could publish either');
});

test('the set comes from the directory that asked, and a set that states nothing states nothing', async () => {
	// Two things at once. A set installed beside a page is the set that page gets, which is what
	// lets one machine hold several applications on different sets. And a set with no prefix, no
	// aliases and no root size produces a pack with none of the three rather than empty ones.
	const root = fileURLToPath(new URL('../../../.scratch/', import.meta.url));
	mkdirSync(root, { recursive: true });
	const app = mkdtempSync(join(root, 'icons-'));
	const set = join(app, 'node_modules', '@iconify-json', 'tiny');
	mkdirSync(set, { recursive: true });
	writeFileSync(join(set, 'package.json'), JSON.stringify({ name: '@iconify-json/tiny', version: '1.0.0' }));
	writeFileSync(join(set, 'icons.json'), JSON.stringify({ icons: { dot: { body: '<circle r="1"/>' } } }));

	try {
		assert.equal(moduleFor('tiny/dot', here), null, 'this directory has no such set');
	} catch (error) {
		assert.match(String(error), /set-not-installed/, 'this directory has no such set');
	}

	const pack = await valueOf(moduleFor('tiny', app)!) as IconPack & { aliases?: unknown };
	assert.deepEqual(Object.keys(pack), ['icons'], 'nothing the set did not state');
	assert.deepEqual(Object.keys(pack.icons), ['dot']);

	const one = await valueOf(moduleFor('tiny/dot', app)!) as IconData;
	assert.equal(one.width, undefined, 'no root size means no size, not a guess');
	assert.equal(one.body, '<circle r="1"/>');

	const standard = await valueOf(moduleFor('tiny/+standard', app)!) as IconPack;
	assert.deepEqual(standard.icons, {}, 'a set with none of the standard names contributes none');

	rmSync(app, { recursive: true, force: true });
});

test('the generated modules carry the types the ambient declaration gives them', () => {
	// A type-level check, compiled by the gate's typecheck and erased before it runs. TypeScript
	// allows one `*` in a module pattern, so the specific pattern is declared first and has to
	// win: the standard selection is a pack, where a per-icon path is the union of the two shapes
	// a one-star pattern cannot tell apart (design 141).
	const pack: IconPack | undefined = undefined as typeof generatedStandard | undefined;
	const icon: IconData | IconPack | undefined = undefined as typeof generatedIcon | undefined;

	assert.equal(pack, undefined);
	assert.equal(icon, undefined);
});
