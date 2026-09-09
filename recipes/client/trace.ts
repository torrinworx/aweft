// What the page did, in order, so a check in `main.ts` can read it back out of the browser.
//
// A real application would not have this. It is here because the thing under test is a
// lifecycle: which module was built, when it was let go of, and what ran its `stop`.

export const trace = (line: string): void => {
	const held = globalThis as { aweftTrace?: string[] };
	(held.aweftTrace ??= []).push(line);
};
