// What a write costs before anything derived from it runs.
//
// `bench/derived.ts` measures a graph of derived values on its own. In this stack a derived
// value sits on top of state that produces a delta, closes a commit and tells its watchers, so
// the number that decides how much the propagation design matters is which of the two
// dominates.
//
// Run: node bench/write.ts
//
// CI does not gate on this. A performance claim cites this script and its recorded output.

import { atomic, createObject, observer } from '@aweftjs/core';

const measure = (label: string, runs: number, step: (iteration: number) => void): void => {
	for (let i = 0; i < Math.max(10, runs / 5); i++) step(i);

	let best = Infinity;
	for (let attempt = 0; attempt < 3; attempt++) {
		const started = process.hrtime.bigint();
		for (let i = 0; i < runs; i++) step(i);
		const took = Number(process.hrtime.bigint() - started) / 1e6;
		if (took < best) best = took;
	}

	console.log(`  ${label.padEnd(44)} ${((best / runs) * 1000).toFixed(3).padStart(8)} us`);
};

interface Doc extends Record<string, unknown> {
	a?: number;
	other?: number;
	child?: Doc;
}

console.log('\n## a write nobody is watching');
{
	const doc = createObject<Doc>();
	measure('one slot', 20000, (i) => { doc.a = i; });
}

console.log('\n## a write with a watcher, which is what an application has');
{
	const doc = createObject<Doc>();
	let seen = 0;
	observer(doc).watch((change) => { seen += change.deltas.length; });

	measure('one slot, one watcher at the root', 20000, (i) => { doc.a = i; });
}

console.log('\n## the same write, missed by the scope watching');
{
	const doc = createObject<Doc>({ other: 1 });
	let seen = 0;
	observer(doc).path('other').watch(() => { seen += 1; });

	measure('one slot, one scope elsewhere', 20000, (i) => { doc.a = i; });
}

console.log('\n## ten slots in one commit, so the per delta cost shows');
{
	const doc = createObject<Doc>();
	let seen = 0;
	observer(doc).watch((change) => { seen += change.deltas.length; });

	measure('ten slots, one commit, one watcher', 5000, (i) => {
		atomic(() => {
			for (let k = 0; k < 10; k++) doc[`s${k}`] = i + k;
		});
	});
}

console.log('\n## a write a hundred watchers care about');
{
	const doc = createObject<Doc>();
	let seen = 0;
	for (let i = 0; i < 100; i++) observer(doc).path('a').watch(() => { seen += 1; });

	measure('one slot, a hundred watchers', 5000, (i) => { doc.a = i; });
}

console.log('\n## a write twenty levels down, watched at the root');
{
	const root = createObject<Doc>();
	let at = root;
	for (let i = 0; i < 20; i++) {
		const child = createObject<Doc>();
		at.child = child;
		at = child;
	}

	let seen = 0;
	observer(root).watch((change) => { seen += change.deltas.length; });

	measure('twenty deep, one watcher at the root', 20000, (i) => { at.a = i; });
}
