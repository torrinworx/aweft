// A browser frame as the room (designs 069 and 284).
//
// The frame has `sandbox="allow-scripts"` and not `allow-same-origin`, so it has an opaque
// origin: no cookie, no storage, no reach into the page that made it. Its content security
// policy allows scripts only inline, from `data:` (the default compile imports module text
// that way), and from the origin the `inside` module is served from. That is the browser's
// boundary, and this runner claims exactly that. `allow` opens what a page in the room needs
// to paint, styles, images, fonts and media, and never a script or a connection.
//
// The DOM is described structurally, so this file typechecks with no DOM library and the
// package stays isomorphic; a test hands in a fake, a page hands in `document`.

import { type Channel, fromMessagePort } from '@aweftjs/sync';

import { type Runner, sandboxError } from './contract.ts';

/** What this runner needs from an iframe element. */
export interface FrameLike {
	setAttribute(name: string, value: string): void;
	addEventListener(type: 'load', fn: () => void): void;
	remove(): void;
	readonly contentWindow: { postMessage(message: unknown, origin: string, transfer: unknown[]): void } | null;
}

/** What this runner needs from a document. */
export interface DocumentLike {
	createElement(tag: 'iframe'): FrameLike;
}

/** What this runner needs from a `MessageChannel`. */
export interface MessageChannelLike {
	readonly port1: Parameters<typeof fromMessagePort>[0];
	readonly port2: unknown;
}

/** What a page in the room may load beyond scripts (design 284). Each list is origins. */
export interface FrameAllow {
	/** Inline styles: what a themed page writes. */
	readonly styles?: boolean | undefined;
	/** Images from the inside origin, `data:`, `blob:` and these origins. */
	readonly images?: readonly string[] | undefined;
	/** Fonts from the inside origin, `data:`, `blob:` and these origins. */
	readonly fonts?: readonly string[] | undefined;
	/** Audio and video from the inside origin, `data:`, `blob:` and these origins. */
	readonly media?: readonly string[] | undefined;
}

export interface FrameOptions {
	/** The URL of the room's `@aweftjs/sandbox/inside` module, as the frame can import it. */
	readonly inside: string;
	/** What the frame may load beyond scripts. Nothing when left off. */
	readonly allow?: FrameAllow | undefined;
	/** Where the frame goes. A frame runs only once it is in a document. */
	readonly into: { appendChild(node: FrameLike): unknown };
	/** What the frame holds, as its `title`: the name a screen reader gives it. */
	readonly title?: string | undefined;
	/** An import map for the frame, when `inside` is served unbundled. */
	readonly importMap?: Readonly<Record<string, string>> | undefined;
	/** Defaults to the page's own. */
	readonly document?: DocumentLike | undefined;
	/** Defaults to the page's own. */
	readonly MessageChannel?: (new () => MessageChannelLike) | undefined;
}

/**
 * A URL cut to its origin and to the characters a directive may hold, so a value cannot end
 * the directive or the attribute. The same rule for `inside` as for every origin in `allow`.
 */
const originOf = (url: string): string => {
	const at = url.indexOf('/', url.indexOf('//') + 2);
	return (at < 0 ? url : url.slice(0, at)).replace(/[^A-Za-z0-9.:/\-\[\]*]/g, '');
};

/** JSON that is safe inside a `<script>`: a closing tag in it cannot end the script early. */
const inScript = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c');

/**
 * The frame's policy. `default-src 'none'` refuses everything not named; scripts are named
 * as they always were, and `allow` names the rest. `connect-src` is never written, so it
 * stays refused whatever `allow` says. Every origin, `inside` included, goes in as `originOf`
 * cuts it.
 */
const policyOf = (inside: string, allow: FrameAllow): string => {
	const origin = originOf(inside);
	const directives = [`default-src 'none'`, `script-src 'unsafe-inline' data: ${origin}`];
	if (allow.styles === true) directives.push(`style-src 'unsafe-inline'`);
	const sources = (named: readonly string[]): string => [origin, 'data:', 'blob:', ...named.map(originOf)].join(' ');
	if (allow.images !== undefined) directives.push(`img-src ${sources(allow.images)}`);
	if (allow.fonts !== undefined) directives.push(`font-src ${sources(allow.fonts)}`);
	if (allow.media !== undefined) directives.push(`media-src ${sources(allow.media)}`);
	return directives.join('; ');
};

/**
 * A runner whose room is a sandboxed iframe.
 *
 * Params:
 *   options.inside: the URL of the room's inside module; its origin is the one origin the
 *     frame may load scripts from
 *   options.into: where the frame is appended
 *   options.importMap: the frame's import map, when the inside module is not bundled
 *   options.allow: inline styles, and the origins images, fonts and media may come from
 *     beyond the inside origin, `data:` and `blob:`; scripts and connections never widen
 *
 * Returns: a runner. The frame it makes is `element` once started, so a page can size it.
 *
 * Throws: a SandboxError with reason `no-page` when there is no document and no MessageChannel
 * to be found, which is every runtime that is not a page.
 *
 * Example:
 *   const runner = iframe({ inside: '/room/inside.js', into: document.body });
 *   const sandbox = await createSandbox({ runner, modules, grants });
 */
export const iframe = (options: FrameOptions): Runner & { readonly element: FrameLike | undefined } => {
	const doc = options.document ?? (globalThis as { document?: DocumentLike }).document;
	const Channel = options.MessageChannel ?? (globalThis as unknown as { MessageChannel?: new () => MessageChannelLike }).MessageChannel;
	if (doc === undefined || Channel === undefined) {
		throw sandboxError(
			'no-page', 'the iframe runner found no document and no MessageChannel',
			'Pass document and MessageChannel to iframe when there is no page.',
		);
	}

	let frame: FrameLike | undefined;
	let channel: Channel | undefined;
	/** Ends a `start` still waiting on the frame's load, so a room stopped first does not wait forever. */
	let abandon: ((error: Error) => void) | undefined;

	const html = [
		'<!doctype html><html><head>',
		`<meta http-equiv="Content-Security-Policy" content="${policyOf(options.inside, options.allow ?? {})}">`,
		options.importMap === undefined ? '' : `<script type="importmap">${inScript({ imports: options.importMap })}</script>`,
		'</head><body><script type="module">',
		'const take = (event) => {',
		// An opaque origin has no origin string to check; the source is the identity.
		'	if (event.source !== parent || event.data !== "aweft:room" || event.ports.length !== 1) return;',
		'	removeEventListener("message", take);',
		`	import(${inScript(options.inside)}).then((m) => m.insidePort(event.ports[0]));`,
		'};',
		'addEventListener("message", take);',
		'</script></body></html>',
	].join('\n');

	return {
		get element() {
			return frame;
		},
		start: () => new Promise<Channel>((resolve, reject) => {
			const made = doc.createElement('iframe');
			frame = made;
			abandon = reject;
			made.setAttribute('sandbox', 'allow-scripts');
			if (options.title !== undefined) made.setAttribute('title', options.title);
			made.addEventListener('load', () => {
				abandon = undefined;
				const ports = new Channel();
				channel = fromMessagePort(ports.port1);
				made.contentWindow?.postMessage('aweft:room', '*', [ports.port2]);
				resolve(channel);
			});
			made.setAttribute('srcdoc', html);
			options.into.appendChild(made);
		}),
		stop: async () => {
			channel?.close();
			frame?.remove();
			frame = undefined;
			abandon?.(sandboxError('closed', 'the frame was removed before it loaded', 'Stop the room once createSandbox has answered, or take closed from it as the frame leaving first.'));
			abandon = undefined;
		},
	};
};
