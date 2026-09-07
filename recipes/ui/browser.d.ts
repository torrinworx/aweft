// The browser globals a page driven from Node names, declared loosely. `recipes/ui/main.ts` and
// `packages/ui/tests/browser.test.ts` both write callbacks that run in Chromium and both compile
// without the DOM library, so both read this file.
//
// `main.ts` runs in Node and its `page.evaluate` callbacks run in Chromium, so the file has to
// typecheck without the DOM library while the browser supplies the real objects. `entry.tsx` runs
// in the browser outright. Narrow shapes, so a typo is still caught.

interface RecipeElement {
	readonly parentElement: RecipeElement | null;
	readonly tagName: string;
	querySelector(selector: string): RecipeElement | null;
	readonly outerHTML: string;
	getAttribute(name: string): string | null;
	hasAttribute(name: string): boolean;
	readonly id: string;
	/** On a `<dialog>`: whether it is showing. */
	readonly open: boolean;
	getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number };
	querySelectorAll(selector: string): ArrayLike<RecipeElement>;
	matches(selector: string): boolean;
	contains(node: unknown): boolean;
	blur(): void;
	focus(): void;
	scrollIntoView(options?: { block?: string }): void;
	readonly offsetTop: number;
	readonly value: string;
	readonly textContent: string | null;
}

declare const document: {
	title: string;
	readonly head: RecipeElement & { querySelector(selector: string): RecipeElement | null };
	readonly body: RecipeElement;
	readonly activeElement: RecipeElement | null;
	querySelector(selector: string): RecipeElement | null;
	querySelectorAll(selector: string): ArrayLike<RecipeElement>;
	elementFromPoint(x: number, y: number): RecipeElement | null;
};

/** axe-core, as the preview page reaches it once the script tag is in. */
interface AxeViolation {
	readonly id: string;
	readonly help: string;
	readonly nodes: readonly { readonly html: string }[];
}

declare const axe: {
	run(target: unknown, options: { runOnly: { type: string; values: string[] } }): Promise<{
		readonly violations: readonly AxeViolation[];
		readonly passes: readonly unknown[];
	}>;
};

declare const window: { scrollTo(x: number, y: number): void; readonly scrollY: number };

declare function getComputedStyle(element: RecipeElement, pseudo?: string): Record<string, string>;
