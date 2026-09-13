// The browser globals this recipe's page and its Chromium callbacks name, declared loosely.
//
// `main.ts` runs in Node and its `addInitScript` and `evaluate` callbacks run in Chromium, so the
// file has to typecheck without the DOM library while the browser supplies the real objects.
// `entry.tsx` runs in the browser outright. Narrow shapes, so a typo is still caught.

interface RecipeNode {
	readonly nodeType: number;
	readonly nodeName: string;
	contains(node: unknown): boolean;
}

declare const document: {
	readonly readyState: string;
	readonly body: RecipeNode | null;
	createElement(tag: string): RecipeNode;
};

interface RecipeMutation {
	readonly target: RecipeNode;
	readonly addedNodes: ArrayLike<RecipeNode> & Iterable<RecipeNode>;
	readonly removedNodes: ArrayLike<RecipeNode> & Iterable<RecipeNode>;
}

declare const MutationObserver: {
	new(callback: (records: readonly RecipeMutation[]) => void): {
		// The document itself, because an init script runs before the parser has made <html>.
		observe(target: unknown, options: { childList?: boolean; subtree?: boolean }): void;
	};
};
