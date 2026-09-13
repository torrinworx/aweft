// An act that was stored as text and is compiled where it runs (designs 062, 277).
//
// The source names `@aweftjs/ui` the way a file on disk would, so the transform's text pass finds
// its literals like any other file's. A module compiled at run time has no bundler to resolve
// that import, so `compile` rewrites the specifier to a bridge the host provides: the package's
// own URL in Node, and in a browser a module the entry made from what its bundle already holds.

import { createArray, createObject } from '@aweftjs/core';
import { transform } from '@aweftjs/build';

/** What the store holds: one module, its source as text, and the keys the build found in it. */
export const SOURCE = `import { h, text } from '@aweftjs/ui';

export const entries = async () => [{}];

export default () => ({
	title: text('Notes'),
	component: () => h('main', { id: 'notes' },
		h('h1', { id: 'notes-heading' }, 'Notes from the store'),
		h('p', { id: 'stored-line' }, 'This act was stored as text and compiled where it ran.')),
});
`;

/** The keys the transform answers for the stored source, which is what an application keeps beside it. */
export const storedKeys = (): readonly string[] => transform(SOURCE, { filename: 'Notes.tsx', text: true }).text;

/** The module document, as a store would hold it. */
export const stored = createObject({
	'site/Notes': createObject({ source: SOURCE, text: createArray([...storedKeys()]) }),
});

export type Compile = (source: string) => Promise<Record<string, unknown>>;

/**
 * A compile for `fromDocument`: the transform with the text pass on, `@aweftjs/ui` pointed at
 * the bridge, and the result imported as a data URL.
 */
export const compileWith = (bridge: string): Compile => async (source) => {
	const { code } = transform(source, { filename: 'Notes.tsx', text: true });
	const pointed = code.replaceAll("'@aweftjs/ui'", JSON.stringify(bridge));
	return await import(`data:text/javascript,${encodeURIComponent(pointed)}`) as Record<string, unknown>;
};
