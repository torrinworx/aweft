// The inside half of a room on the page (design 277): what the application's room entry
// calls with the port the frame was posted. It runs the far end over the port, builds the one
// loader the host's calls and the stage both reach, makes the router over the route document
// (design 279), and mounts a stage on the act the host named into the frame's body.

import type { Client, ClientStatus } from '@aweftjs/client';
import type { Derived } from '@aweftjs/core';
import { createRouter } from '@aweftjs/dom/router';
import { type Loader, createLoader } from '@aweftjs/modules';
import { type PortLike, fromMessagePort } from '@aweftjs/sync';
import { type Component, Stage, StageContext, h, mount } from '@aweftjs/ui';

import { sandboxError } from './contract.ts';
import { routeEntries } from './entries.ts';
import { type Room, enter } from './inside.ts';

export type { Room } from './inside.ts';

/** What the frame's document offers, named structurally so this file typechecks with no DOM library. */
export interface FrameDocument {
	readonly body: { insertBefore(node: unknown, before: unknown): unknown; removeChild(node: unknown): unknown; replaceChild(node: unknown, old: unknown): unknown };
}

/** What `room` takes. */
export interface RoomOptions {
	/** What wraps the act: where the application puts `Theme` and `Icons`. A pass-through when left off. */
	readonly template?: Component | undefined;
	/** The document the stage mounts into. The frame's own when left off; a test hands in a light one. */
	readonly document?: FrameDocument | undefined;
}

const NOT_IN_ROOM = 'The connection is the page\'s; a module in a room shares and asks through it and does not manage it.';

/**
 * Run a room with a page in it, over the port the frame was posted.
 *
 * Params:
 *   port: the `MessagePort` the host posted into the frame
 *   options.template: what wraps the act, `Theme` and `Icons` among it
 *   options.document: where the stage mounts; the frame's own document when left off
 *
 * Returns: the room, once the host's documents have arrived and the stage is mounted. Its
 * `stop` unmounts the stage, unloads everything and closes the link.
 *
 * The far end forwards uncaught errors, unhandled rejections and the console levels the host
 * named (design 280), each attributed to the act. One loader is built over the far end's
 * sources, with the host's `props` and `client` beside them, and handed to the far end and to
 * the stage both. The stage runs `acts={{ '*': act }}` over a router whose entries are the
 * route document, so the tail under the host act is the room's whole URL and `''` is its index;
 * the bare `*` takes no parameter, so a move inside the room is the act's nested stage's and
 * the act is not built again. Anchors under the body are taken over, resolved against that
 * URL. With `follow`, a reload of
 * the act or of a module it depends on unmounts and mounts the stage again, so the act on screen
 * is built from the new source; the route document carries the URL through.
 *
 * Rejects: with `no-act` when the host runs a compute room, which has no act to show.
 *
 * Example, the application's room entry:
 *   import { room } from '@aweftjs/sandbox/room';
 *   export const insidePort = (port) => room(port, { template: Layout });
 */
export const room = async (port: PortLike, options: RoomOptions = {}): Promise<Room> => {
	const entered = await enter(fromMessagePort(port), { forward: { errors: true, console: true } });
	if (entered.page === null || entered.route === null) {
		throw sandboxError('no-act', 'the host started a compute room, which has no act to show',
			'Mount Room from @aweftjs/sandbox/page on the host, or make the frame with insidePort from @aweftjs/sandbox/inside.');
	}
	const { act } = entered.page;

	// The connection as a module in the room holds it: the page's own shape (design 277), so an
	// act module runs on either side of the wall unchanged.
	const client: Client = {
		share: entered.share,
		ask: entered.ask,
		status: entered.status as unknown as Derived<ClientStatus>,
		reconnect: () => { throw sandboxError('not-in-room', 'reconnect is not a room\'s to call', NOT_IN_ROOM); },
		close: () => { throw sandboxError('not-in-room', 'close is not a room\'s to call', NOT_IN_ROOM); },
	};
	const loader: Loader = createLoader({ sources: entered.sources, props: { ...entered.props, client } });

	const entries = routeEntries(entered.route);
	const router = createRouter({ entries });
	const page = options.document ?? (globalThis as unknown as { document: FrameDocument }).document;
	const body = page.body as never;

	const stage = (): unknown => h(StageContext, {
		router, loader, acts: { '*': act },
		...(options.template === undefined ? {} : { template: options.template }),
	}, h(Stage, {}));
	let unmount = mount(body, stage());
	const stopLinks = router.links(body);

	/** Whether a reload of `name` reached the act: it is the act, or the act depends on it. */
	const reachesAct = (name: string): boolean => {
		const seen = new Set<string>([name]);
		for (const at of seen) {
			if (at === act) return true;
			for (const dependent of loader.dependents(at)) seen.add(dependent);
		}
		return false;
	};

	const served = entered.serve(loader, {
		applied: (name, action) => {
			if (action !== 'reloaded' || !reachesAct(name)) return;
			// The stage was handed the loader, so unmounting drops only the act it showed, and the
			// router keeps the URL, so the act comes back on the screen it was on.
			unmount();
			unmount = mount(body, stage());
		},
	});

	let over = false;
	return {
		stop: async () => {
			if (over) return;
			over = true;
			stopLinks();
			unmount();
			router.stop();
			entries.stop();
			await served.stop();
		},
	};
};
