// Run with --expose-gc by behavior.derived.test.ts: whether a stopped watcher's closure can be
// collected after a delivery has drained. A queue that kept a reference to a delivered job
// would keep everything the job closed over.

import { createObject, mutable, observer } from '../src/index.ts';

// A deref keeps its target alive to the end of the job it ran in, so the collector runs in a
// job of its own and the check in the next.
const collected = async (ref: WeakRef<object>): Promise<boolean> => {
	for (let i = 0; i < 5; i++) {
		(globalThis as { gc?: () => void }).gc?.();
		await new Promise((resolve) => setTimeout(resolve, 0));
		if (ref.deref() === undefined) return true;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	return false;
};

const cell = mutable(0);
const doc = createObject<Record<string, unknown>>();

const cellRef = ((): WeakRef<object> => {
	const held = { what: 'cell watcher' };
	const stop = cell.watch(() => { void held; });
	cell.set(1);
	stop();
	return new WeakRef(held);
})();

const docRef = ((): WeakRef<object> => {
	const held = { what: 'document listener' };
	const stop = observer(doc).watch(() => { void held; });
	doc['a'] = 1;
	stop();
	return new WeakRef(held);
})();

// Another drain of each, so a queue that kept the old job would be holding it now.
cell.set(2);
doc['a'] = 2;

console.log(`cell watcher: ${(await collected(cellRef)) ? 'released' : 'held'}`);
console.log(`document listener: ${(await collected(docRef)) ? 'released' : 'held'}`);
