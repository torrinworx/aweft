// Hydration state: which server nodes are still unclaimed under each parent, and the marker
// regions the dynamic mounts will take in order (design 078).
//
// A scope is one run of server children: the whole of a parent, or the inside of one marker
// pair. It has a cursor, the next unclaimed node, and the regions found at its level, taken by
// dynamic mounts first come first served. Claims of static nodes skip over regions; a region
// is entered by the mount that owns it, whenever its deferred body gets to run.

import { assert, isRelease } from './assert.ts';
import type { ElementLike, NodeLike, ParentLike, TextLike } from './types.ts';
import { COMMENT, ELEMENT, TEXT } from './types.ts';
import { isMade, isReactiveAttribute, isRecordedProperty, propertiesOf } from './props.ts';

export interface Scope {
	readonly parent: ParentLike;
	/** The next unclaimed server node, or null at the end of the run. */
	cursor: NodeLike | null;
	/** The node the run stops at: a region's closing marker, or null for the whole parent. */
	readonly end: NodeLike | null;
	/** Marker pairs at this level, in order, found on first need. */
	regions: Region[] | null;
	nextRegion: number;
	/** Nodes this scope paired. Anything else left at the end is the server's surplus. */
	readonly claimed: Set<NodeLike>;
	failed: boolean;
}

export interface Region {
	readonly start: NodeLike;
	readonly end: NodeLike;
	readonly scope: Scope;
}

const OPEN = '[';
const CLOSE = ']';

const isMarker = (node: NodeLike | null, data: string): boolean =>
	node !== null && node.nodeType === COMMENT && (node as { data?: string }).data === data;

const detach = (node: NodeLike): void => {
	node.parentNode?.removeChild(node);
};

export class Hydration {
	private readonly scopes: Scope[] = [];
	private readonly byElement = new Map<ParentLike, Scope>();
	/** Fresh node to the server node that stands for it, for re-targeting signals. */
	readonly paired = new Map<NodeLike, NodeLike>();

	/** The scope for a whole parent: the hydrate target, or an element that was claimed. */
	top(parent: ParentLike): Scope {
		const known = this.byElement.get(parent);
		if (known !== undefined) return known;
		const scope = this.open(parent, parent.firstChild ?? null, null);
		this.byElement.set(parent, scope);
		return scope;
	}

	scopeOf(parent: ParentLike): Scope | null {
		return this.byElement.get(parent) ?? null;
	}

	private open(parent: ParentLike, cursor: NodeLike | null, end: NodeLike | null): Scope {
		const scope: Scope = { parent, cursor, end, regions: null, nextRegion: 0, claimed: new Set(), failed: false };
		this.scopes.push(scope);
		return scope;
	}

	/** The marker pairs at this scope's level, in document order. */
	private regionsOf(scope: Scope): Region[] {
		if (scope.regions !== null) return scope.regions;
		const regions: Region[] = [];
		let depth = 0;
		let start: NodeLike | null = null;
		for (let n = scope.cursor; n !== null && n !== scope.end; n = n.nextSibling) {
			if (isMarker(n, OPEN)) {
				if (depth === 0) start = n;
				depth += 1;
			} else if (isMarker(n, CLOSE) && depth > 0) {
				depth -= 1;
				if (depth === 0 && start !== null) {
					regions.push({ start, end: n, scope: this.open(scope.parent, start.nextSibling, n) });
					start = null;
				}
			}
		}
		scope.regions = regions;
		return regions;
	}

	/** Move the cursor past any region that begins at it. Regions are taken by dynamic mounts. */
	private skipRegions(scope: Scope): void {
		const regions = this.regionsOf(scope);
		for (;;) {
			const region = regions.find((r) => r.start === scope.cursor);
			if (region === undefined) return;
			scope.cursor = region.end.nextSibling;
		}
	}

	/** Enter the next region at this level, for the dynamic mount that owns it. */
	region(scope: Scope): Region | null {
		if (scope.failed) return null;
		const regions = this.regionsOf(scope);
		const region = regions[scope.nextRegion];
		if (region === undefined) {
			this.fail(scope, 'a dynamic mount found no marker region left in the server markup');
			return null;
		}
		scope.nextRegion += 1;
		scope.claimed.add(region.start);
		scope.claimed.add(region.end);
		return region;
	}

	/**
	 * The server node that stands for `fresh`, or null when it must be inserted instead.
	 * Pairing an element pairs its static subtree and sets the properties `h` gave the fresh
	 * one; pairing text may split a longer server text node.
	 */
	claim(scope: Scope, fresh: NodeLike): NodeLike | null {
		if (scope.failed) return null;
		this.skipRegions(scope);
		const cursor = scope.cursor;

		if (!isMade(fresh)) {
			// The application's own node goes in as it is. What the server rendered for it, if
			// anything of the same shape sits here, was its stand-in and goes.
			if (cursor !== null && cursor !== scope.end && cursor.nodeType === fresh.nodeType
				&& (fresh.nodeType !== ELEMENT || sameTag(fresh as ElementLike, cursor as ElementLike))) {
				scope.cursor = cursor.nextSibling;
				detach(cursor);
			}
			return null;
		}

		if (cursor === null || cursor === scope.end) {
			this.fail(scope, `the server markup ran out where a ${describe(fresh)} was expected`);
			return null;
		}

		if (fresh.nodeType === ELEMENT) {
			if (cursor.nodeType !== ELEMENT || !sameTag(fresh as ElementLike, cursor as ElementLike)) {
				this.fail(scope, `expected a ${describe(fresh)} and found a ${describe(cursor)}`);
				return null;
			}
			this.pairElement(fresh as ElementLike, cursor as ElementLike);
		} else if (fresh.nodeType === TEXT) {
			if (cursor.nodeType !== TEXT) {
				this.fail(scope, `expected text and found a ${describe(cursor)}`);
				return null;
			}
			this.pairText(fresh as TextLike, cursor as TextLike);
		} else if (cursor.nodeType !== fresh.nodeType) {
			this.fail(scope, `expected a ${describe(fresh)} and found a ${describe(cursor)}`);
			return null;
		}

		scope.claimed.add(cursor);
		scope.cursor = cursor.nextSibling;
		this.paired.set(fresh, cursor);
		return cursor;
	}

	private pairText(fresh: TextLike, server: TextLike): void {
		if (server.data === fresh.data) return;
		if (server.data.startsWith(fresh.data)) {
			// Two adjacent client text nodes serialize as one; the rest stays for the next claim.
			server.splitText(fresh.data.length);
			return;
		}
		assert(false, `hydration text mismatch: server ${JSON.stringify(server.data)}, client ${JSON.stringify(fresh.data)}`);
		server.data = fresh.data;
	}

	private pairElement(fresh: ElementLike, server: ElementLike): void {
		for (const name of fresh.getAttributeNames()) {
			const value = fresh.getAttribute(name) ?? '';
			if (server.getAttribute(name) !== value) {
				assert(false, `hydration attribute mismatch on <${fresh.localName} ${name}>`);
				server.setAttribute(name, value);
			}
		}
		for (const name of server.getAttributeNames()) {
			// `$style` is a property on the client and an attribute in the markup; the property
			// replay below sets it on the claimed node.
			if (!fresh.hasAttribute(name) && !isReactiveAttribute(fresh, name) && !isRecordedProperty(fresh, name)) {
				assert(false, `hydration attribute mismatch: the server has <${fresh.localName} ${name}> and the client does not`);
				server.removeAttribute(name);
			}
		}
		for (const [name, value] of propertiesOf(fresh)) setProperty(server, name, value);

		const scope = this.open(server, server.firstChild, null);
		this.byElement.set(server, scope);
		const children: NodeLike[] = [];
		for (let n = fresh.firstChild; n !== null; n = n.nextSibling) children.push(n);
		for (const child of children) {
			// A child nothing stands for moves into the server element where the cursor is.
			if (this.claim(scope, child) === null) server.insertBefore(child, scope.cursor);
		}
	}

	private fail(scope: Scope, message: string): void {
		assert(false, `hydration mismatch: ${message}`);
		scope.failed = true;
		// Production: what the client builds replaces what the server sent, from here to the
		// end of this run. Claimed nodes before it stay.
		this.dropUnclaimed(scope);
	}

	/**
	 * What the server sent at this level that nothing took: unclaimed nodes, and whole regions
	 * no dynamic mount entered. A region that was entered belongs to its own scope and is
	 * skipped here whatever is inside it.
	 */
	private surplusOf(scope: Scope): { nodes: NodeLike[]; regions: number } {
		const regions = this.regionsOf(scope);
		const nodes: NodeLike[] = [];
		let untaken = 0;
		for (let n = scope.cursor; n !== null && n !== scope.end;) {
			const at = regions.findIndex((r) => r.start === n);
			if (at >= 0) {
				const region = regions[at]!;
				if (at >= scope.nextRegion) {
					untaken += 1;
					for (let m: NodeLike | null = region.start; m !== null; m = m.nextSibling) {
						nodes.push(m);
						if (m === region.end) break;
					}
				}
				n = region.end.nextSibling;
				continue;
			}
			if (!scope.claimed.has(n)) nodes.push(n);
			n = n.nextSibling;
		}
		return { nodes, regions: untaken };
	}

	private dropUnclaimed(scope: Scope): void {
		for (const n of this.surplusOf(scope).nodes) detach(n);
		scope.cursor = scope.end;
	}

	/** After the mount: remove what the server sent and nothing claimed. */
	finish(): void {
		for (const scope of this.scopes) {
			if (scope.failed) continue;
			const surplus = this.surplusOf(scope);
			if (surplus.nodes.length > 0) {
				assert(false, `hydration mismatch: the server sent ${surplus.nodes.length} node(s), ${surplus.regions} region(s) among them, that the client did not render`);
				this.dropUnclaimed(scope);
			}
		}
	}
}

const sameTag = (a: ElementLike, b: ElementLike): boolean =>
	a.localName.toLowerCase() === b.localName.toLowerCase();

const describe = (node: NodeLike): string =>
	(node.nodeType === ELEMENT ? `<${(node as ElementLike).localName}>` : node.nodeType === TEXT ? 'text' : node.nodeName);

/** A property as `h` sets it: a nested object sets its keys on the property's value. */
export const setProperty = (target: object, name: string, value: unknown): void => {
	if (value !== null && typeof value === 'object' && !Array.isArray(value) && !('nodeType' in value)) {
		const inner = (target as Record<string, unknown>)[name];
		if (inner !== null && typeof inner === 'object') {
			for (const [k, v] of Object.entries(value)) (inner as Record<string, unknown>)[k] = v;
			return;
		}
	}
	(target as Record<string, unknown>)[name] = value;
};

export const releaseMode = isRelease;
