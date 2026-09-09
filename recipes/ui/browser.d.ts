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
	setAttribute(name: string, value: string): void;
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
	/** The border box, which a transform does not move: `getBoundingClientRect` is the turned one. */
	readonly offsetWidth: number;
	readonly offsetHeight: number;
	readonly childNodes: ArrayLike<unknown>;
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

declare const location: { readonly href: string; readonly pathname: string; readonly search: string };

declare const history: { back(): void; readonly length: number };

declare function getComputedStyle(element: RecipeElement, pseudo?: string): Record<string, string>;

declare function requestAnimationFrame(callback: () => void): number;

/**
 * The bundler's directory read, which `catalogue.tsx` uses to collect its examples (design 197).
 * Declared here rather than by pulling in the bundler's own client types, because those bring the
 * whole DOM library with them and this project deliberately compiles without it.
 *
 * It runs at build time and answers one module per matching file, so what a caller gets back is a
 * map from the path to the module's exports.
 */
interface ImportMeta {
	glob(pattern: string, options: { eager: true }): Readonly<Record<string, unknown>>;
}
