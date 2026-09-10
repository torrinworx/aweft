// The browser globals this recipe's Chromium callbacks name, declared loosely.
//
// `main.ts` runs in Node and its `addInitScript` and `evaluate` callbacks run in Chromium, so
// the file has to typecheck without the DOM library while the browser supplies the real
// objects. Narrow shapes, so a typo is still caught.

interface WatchedNode {
	readonly nodeType: number;
	readonly nodeName: string;
	contains(node: unknown): boolean;
}

declare const document: {
	readonly readyState: string;
	readonly body: WatchedNode | null;
};

interface WatchedMutation {
	readonly target: WatchedNode;
	readonly addedNodes: ArrayLike<WatchedNode> & Iterable<WatchedNode>;
	readonly removedNodes: ArrayLike<WatchedNode> & Iterable<WatchedNode>;
}

declare const MutationObserver: {
	new(callback: (records: readonly WatchedMutation[]) => void): {
		// The document itself, because an init script runs before the parser has made <html>.
		observe(target: unknown, options: { childList?: boolean; subtree?: boolean }): void;
	};
};
