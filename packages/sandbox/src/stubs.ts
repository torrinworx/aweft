// A stub is a plain object with the functions the instance had (design 067). Never a
// Proxy: `await imports.Thing` must not find a `then` that is not there, and a module must
// be able to see what it was handed.

import type { Stub } from './contract.ts';

/** The function names of an instance, own and inherited, without `constructor`. Sorted, so two ends agree. */
export const methodsOf = (instance: unknown): string[] => {
	if (instance === null || (typeof instance !== 'object' && typeof instance !== 'function')) return [];
	const names = new Set<string>();
	let at: object | null = instance as object;
	while (at !== null && at !== Object.prototype && at !== Function.prototype) {
		for (const key of Object.getOwnPropertyNames(at)) {
			if (key === 'constructor') continue;
			const described = Object.getOwnPropertyDescriptor(at, key);
			if (described !== undefined && typeof described.value === 'function') names.add(key);
		}
		at = Object.getPrototypeOf(at) as object | null;
	}
	return [...names].sort();
};

/** One function per name, each a call across the boundary. */
export const stubFor = (methods: readonly string[], call: (method: string, args: readonly unknown[]) => Promise<unknown>): Stub => {
	const stub: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
	for (const method of methods) stub[method] = (...args) => call(method, args);
	return stub;
};
