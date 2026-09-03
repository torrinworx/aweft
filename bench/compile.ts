// What the default compile costs per distinct source, and whether the same source is one module.
//
// The default imports module text through a data URL, and the runtime keeps every distinct URL
// in its module cache for the life of the process. This measures that: time per import, heap
// per distinct source, and whether importing one text twice evaluates it twice. The numbers
// are in the README of `@aweftjs/modules`.
//
// Run: node --expose-gc bench/compile.ts [count]

import { compile } from '@aweftjs/modules';

const count = Number(process.argv[2] ?? 10_000);
const source = (i: number): string =>
	`export const deps = ['a/b']; export const defaults = { n: ${i} }; export default ({ config }) => ({ n: config.n });`;

const gc = (globalThis as { gc?: () => void }).gc;
if (gc === undefined) console.log('run with --expose-gc for a heap number that means something');

gc?.();
const before = process.memoryUsage().heapUsed;
const started = performance.now();
for (let i = 0; i < count; i++) {
	const exports = await compile(source(i));
	const made = exports.default!({ imports: {}, config: exports.defaults ?? {}, extensions: {} }) as { n: number };
	if (made.n !== i) throw new Error(`module ${i} did not run`);
}
const elapsed = performance.now() - started;
gc?.();
const after = process.memoryUsage().heapUsed;

const first = await compile(source(0));
const again = await compile(source(0));

console.log(`distinct sources         ${count}`);
console.log(`per import               ${(elapsed / count * 1000).toFixed(1)} us`);
console.log(`heap per distinct source ${Math.round((after - before) / count)} B`);
console.log(`heap in all              ${((after - before) / 1048576).toFixed(2)} MB`);
console.log(`same text, same module   ${first === again}`);
