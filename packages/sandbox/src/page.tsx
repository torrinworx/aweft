// The host half of a room on the page (design 280): a component for an act that puts the
// frame runner in one element, makes the sandbox over it with the documents the application
// names, and runs the tail of the URL across the wall (design 282).
//
// The route is one document written from both ends. The host writes `url` and `key` after the
// page's router has settled, in a microtask, because the router writes its key and then its
// URL and an effect between the two would send the room the old path under the new key. The
// room writes `url`, `move` and `seq`, and `seq` is what tells a room write from an echo of the
// host's own.

import { all, atomic, createObject, observer } from '@aweftjs/core';
import { type ElementLike, type Mounter, createElement, mount } from '@aweftjs/dom';
import { Theme, claimTail, h } from '@aweftjs/ui';

import { type ClientLike, type Sandbox, type SandboxHandlers, type SandboxLimits, sandboxError } from './contract.ts';
import { createSandbox } from './host.ts';
import { type DocumentLike, type FrameAllow, type FrameLike, iframe } from './iframe.ts';
import type { RouteDocument } from './route.ts';

export type { FrameAllow } from './iframe.ts';
export type { ClientLike, Report, SandboxHandlers, SandboxLimits } from './contract.ts';

/** What `Room` takes. Everything not named here goes to the element. */
export interface RoomProps {
	/**
	 * The URL of the application's room bundle, whose module exports `insidePort`. Resolved
	 * against the page's own URL, so `/room/room.js` is that path on this origin, which is the
	 * one origin the frame may load scripts from.
	 */
	readonly inside: string;
	/** The module document, an observable object keyed by module name (design 066). */
	readonly modules: object;
	/** The names the room may ask for, as an observable array from `createArray`. */
	readonly grants: string[];
	/** Documents shared into the room under their keys, writable both ways (design 281). */
	readonly documents?: Readonly<Record<string, object>> | undefined;
	/** The page's connection, which answers the room's asks on granted names. */
	readonly client?: ClientLike | undefined;
	/** The act module the room shows, by name. */
	readonly act: string;
	/**
	 * What the frame holds, in a few words: the frame's `title`, which is the name a screen
	 * reader reads for it. A room with none is refused, as the build refuses an `<iframe>`
	 * without a title (design 295).
	 */
	readonly label: string;
	/** What the frame may load beyond scripts. Inline styles are always allowed (design 284). */
	readonly allow?: FrameAllow | undefined;
	/** The console levels that cross. `['error', 'warn']` unless given (design 283). */
	readonly console?: readonly string[] | undefined;
	/** Where errors, console lines and reloads report. */
	readonly handlers?: SandboxHandlers | undefined;
	/** Put focus in the frame once the room is up. */
	readonly focus?: boolean | undefined;
	/** Spread into every factory's props inside the room, beside `client`. Plain data only. */
	readonly props?: Readonly<Record<string, unknown>> | undefined;
	/** A module specifier the room imports for a library bundle map. */
	readonly bundle?: string | undefined;
	/** Rebuild the act when its source changes in the module document. */
	readonly follow?: boolean | undefined;
	/** Limits the host keeps. None ship. */
	readonly limits?: SandboxLimits | undefined;
	/** The frame's import map: where the bare names the modules import are served from. */
	readonly importMap?: Readonly<Record<string, string>> | undefined;
	/** Decorate this element instead of building a `<div>`. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	/** Written on the element beside the theme's own class list. */
	readonly class?: unknown;
	readonly [prop: string]: unknown;
}

Theme.define({
	'*': { $roomHeight: '480px' },
	// The element is the room's size and the frame fills it, so an application sizes a room the
	// way it sizes anything: a modifier segment, a provider, or the parent's layout.
	room: {
		display: 'block',
		width: '100%',
		height: '$roomHeight',
		_children_iframe: { display: 'block', width: '100%', height: '100%', border: 0 },
	},
});

/** The query and hash of a URL, `?` and `#` included, or `''`. */
const suffixOf = (url: string): string => {
	const at = url.search(/[?#]/);
	return at < 0 ? '' : url.slice(at);
};

/** `inside` as an absolute URL, when there is a page to resolve it against. */
const resolved = (inside: string): string => {
	const at = (globalThis as { location?: { href?: string } }).location?.href;
	return typeof at === 'string' ? new URL(inside, at).href : inside;
};

/** Report something nobody is waiting on where the page already looks. */
const escaped = (error: unknown): void => {
	queueMicrotask(() => { throw error; });
};

const reasonOf = (error: unknown): unknown => (error as { reason?: unknown } | null)?.reason;

/**
 * An act that runs a module in a frame on the page.
 *
 * Params:
 *   props: `inside`, `modules`, `grants`, `act`, `label`, and the rest named on `RoomProps`;
 *          anything else goes to the element
 *
 * Returns: one element on the `room` entry, with the frame inside it once mounted. The runner
 * and the sandbox are made in `mounted` and stopped in `cleanup`, so leaving the act ends the
 * room (designs 069 and 242). One frame per act instance.
 *
 * Under a stage, the tail the act did not take is the room's URL: the host claims it with
 * `claimTail`, writes it into the route document as `/` plus the tail with the page's query and
 * hash, and applies a room `push` or `replace` as the same move on the page's router at the
 * act's own prefix. A room `back` is honoured only while the entry showing is one the host
 * pushed on the room's behalf (design 282). With no stage above, or no router in the tree, the
 * room runs on `act` alone: its URL is `/` and its moves change nothing on the page.
 *
 * A `createSandbox` that rejects is raised where the page already looks, from a microtask,
 * unless the act had left first, in which case the `closed` it rejects with is the leaving. A
 * room with no `label` is refused as the mounter runs, before anything is claimed or made, so
 * the throw reaches whoever mounted it (under a stage, the move that opened the act).
 *
 * Throws: `malformed` when `label` is missing, blank, or not text.
 *
 * Example:
 *   const AppAct = (props) => (
 *     <Room inside="/room/room.js" modules={modules} grants={grants} documents={{ board }}
 *       client={client} act="app/Main" label="The board" allow={{ images: [] }}
 *       handlers={{ error: (entry) => log.write(entry) }} focus />
 *   );
 */
export const Room = (
	props: RoomProps,
	cleanup: (...fns: (() => void)[]) => void,
	mounted: (...fns: (() => void)[]) => void,
): Mounter => {
	// `mounted` is only taken while the body runs, and the context arrives one step later, in the
	// mounter, so the callback is registered here and filled in there.
	let start = (): void => undefined;
	mounted(() => { start(); });
	return (elem, _item, before, context) => {
		const {
			inside, modules, grants, documents, client, act, label, allow, console: levels, handlers, focus,
			props: given, bundle, follow, limits, importMap, element, theme, class: className, ...rest
		} = props;
		// Before the tail is claimed or a watch is registered: a refusal here leaves nothing to give back.
		if (typeof label !== 'string' || label.trim() === '') {
			throw sandboxError('malformed', label === undefined || typeof label === 'string' ? 'Room has no label' : 'Room\'s label is not text', 'Give the room a label saying what the frame holds; it is the frame\'s title, the name a screen reader reads.');
		}

		const node = (element as ElementLike | undefined) ?? createElement('div');
		const claim = claimTail(context);
		const router = claim?.router ?? null;

		const url = (): string => `/${claim === null ? '' : String(claim.tail.get())}${router === null ? '' : suffixOf(String(router.url.get()))}`;
		const key = (): string => (router === null ? '' : String(router.key.get()));
		const route = createObject<RouteDocument>({ url: url(), key: key(), move: 'push', seq: 0 });

		const stops: (() => void)[] = [];
		/** The page keys of the entries this host pushed for the room: the only ones its `back` may pop. */
		const pushed = new Set<string>();
		/**
		 * The key a honoured back is leaving, until the router's key has moved off it. In a browser
		 * the key moves on `popstate`, a later task, so a second back in the same burst would still
		 * see the entry the first one is leaving and pop the page off the act; it is dropped instead.
		 */
		let leaving: string | null = null;
		let stopped = false;

		if (router !== null) {
			// After the router settles rather than on each of its writes: see the top of the file.
			let queued = false;
			const mirror = (): void => {
				queued = false;
				if (stopped) return;
				const next = url();
				const now = key();
				if (route.url === next && route.key === now) return;
				atomic(() => { route.url = next; route.key = now; });
			};
			stops.push(all([router.url, router.key]).effect(() => {
				if (leaving !== null && key() !== leaving) leaving = null;
				if (queued) return;
				queued = true;
				queueMicrotask(mirror);
			}));

			// The guard on the host's share of the document refuses a `url` that is not a tail path
			// before it lands, so what arrives here is a path under the act's prefix.
			const base = (): string => (claim!.base === '' ? '' : `/${claim!.base}`);
			const apply = (move: string, target: string): void => {
				if (stopped) return;
				if (move === 'back') {
					const now = key();
					if (leaving === null && pushed.has(now)) {
						leaving = now;
						router.back();
					}
					return;
				}
				const cut = target.search(/[?#]/);
				const path = cut < 0 ? target : target.slice(0, cut);
				const to = `${base()}${path === '/' ? '' : path}${cut < 0 ? '' : target.slice(cut)}` || '/';
				if (move === 'replace') {
					router.replace(to);
					return;
				}
				router.push(to);
				pushed.add(key());
			};
			// Only the room writes `seq` (design 282), so this scope hears room moves and nothing else.
			// The move is applied from a microtask rather than inside the delivery: a cell written
			// during a delivery reads as it was until the delivery settles, so the key recorded after
			// a push made here would be the key of the entry the push left.
			stops.push(observer(route).path('seq').watch(() => {
				const move = route.move;
				const target = route.url;
				queueMicrotask(() => { apply(move, target); });
			}));
		}

		const runner = iframe({
			inside: resolved(inside),
			into: node as unknown as { appendChild(node: FrameLike): unknown },
			title: label,
			allow: { styles: true, ...allow },
			...(importMap === undefined ? {} : { importMap }),
			// The element's own document, so a frame goes where the element is: a light document
			// in a test, the page's in a browser.
			...(node.ownerDocument === undefined || node.ownerDocument === null ? {} : { document: node.ownerDocument as unknown as DocumentLike }),
		});

		let sandbox: Promise<Sandbox> | null = null;
		start = () => {
			if (stopped) return;
			sandbox = createSandbox({
				runner, modules, grants, page: { act, route },
				...(documents === undefined ? {} : { documents }),
				...(client === undefined ? {} : { client }),
				...(levels === undefined ? {} : { console: levels }),
				...(given === undefined ? {} : { props: given }),
				...(bundle === undefined ? {} : { bundle }),
				...(follow === undefined ? {} : { follow }),
				...(limits === undefined ? {} : { limits }),
				...(handlers === undefined ? {} : { handlers }),
			});
			sandbox.then((made) => {
				// A room that came up after the act left is stopped by the cleanup below.
				if (stopped) return;
				const frame = runner.element as (FrameLike & { focus?: () => void }) | undefined;
				if (focus === true && typeof frame?.focus === 'function') frame.focus();
			}, (error: unknown) => {
				if (stopped && reasonOf(error) === 'closed') return;
				escaped(error);
			});
		};

		cleanup(() => {
			stopped = true;
			for (const stop of stops) stop();
			claim?.release();
			// The frame goes now, whether or not the sandbox has finished starting: a start still
			// waiting on the frame's load rejects with `closed`, which the branch above lets pass.
			runner.stop().catch(escaped);
			sandbox?.then((made) => { made.stop().catch(escaped); }, () => undefined);
		});

		return mount(elem, h(node, { ...rest, class: className, theme: ['room', theme] }), before, context);
	};
};
