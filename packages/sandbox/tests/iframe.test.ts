// The iframe runner, in process, over fakes for the browser globals it needs. A real browser
// runs a whole room through it in escape.iframe.test.ts; this pins its wiring and its shape
// without one: the frame gets `allow-scripts` and no allow-same-origin, and its CSP is
// default-src none with scripts only inline, from data: and from the inside module's origin.

import test from 'node:test';
import assert from 'node:assert/strict';

import { iframe } from '@aweftjs/sandbox';
import type { DocumentLike, FrameLike, MessageChannelLike, SandboxError } from '@aweftjs/sandbox';

/** A frame that captures its attributes and fires load once its srcdoc is set. */
const fakeFrame = () => {
	const attrs: Record<string, string> = {};
	const posted: unknown[] = [];
	let onLoad: (() => void) | undefined;
	const frame = {
		attrs, posted,
		setAttribute: (name: string, value: string) => { attrs[name] = value; if (name === 'srcdoc') queueMicrotask(() => onLoad?.()); },
		addEventListener: (_type: 'load', fn: () => void) => { onLoad = fn; },
		remove: () => { attrs.removed = 'yes'; },
		contentWindow: { postMessage: (message: unknown, _origin: string, transfer: unknown[]) => { posted.push({ message, transfer }); } },
	};
	return frame as FrameLike & { attrs: Record<string, string>; posted: unknown[] };
};

/** A MessageChannel whose ports do nothing: this test drives the runner's wiring, not a room. */
const fakeChannel = (): new () => MessageChannelLike => {
	const port = { postMessage: () => {}, addEventListener: () => {}, start: () => {}, close: () => {} };
	return class { port1 = port as unknown as MessageChannelLike['port1']; port2 = port; };
};

const setup = (inside: string, importMap?: Record<string, string>) => {
	const frame = fakeFrame();
	const document: DocumentLike = { createElement: () => frame };
	const runner = iframe({ inside, into: { appendChild: () => {} }, document, MessageChannel: fakeChannel(), ...(importMap === undefined ? {} : { importMap }) });
	return { frame, runner };
};

test('start makes an opaque-origin, script-locked frame and posts the room its port', async () => {
	const { frame, runner } = setup('https://rooms.example:8443/room/inside.js', { '@aweftjs/core': 'https://rooms.example:8443/core.js' });
	const channel = await runner.start();
	assert.equal(runner.element, frame, 'the runner exposes the frame it made');
	assert.equal(frame.attrs.sandbox, 'allow-scripts', 'scripts only, and no allow-same-origin');
	assert.match(frame.attrs.srcdoc!, /default-src 'none'/);
	assert.match(frame.attrs.srcdoc!, /script-src 'unsafe-inline' data: https:\/\/rooms\.example:8443/);
	assert.ok(!frame.attrs.srcdoc!.includes('allow-same-origin'), 'the frame is never same-origin');
	assert.match(frame.attrs.srcdoc!, /type="importmap"/, 'the import map the caller gave is in the frame');
	assert.match(frame.attrs.srcdoc!, /rooms\.example:8443\/room\/inside\.js/, 'the frame imports the inside module');
	assert.equal((frame.posted[0] as { transfer: unknown[] }).transfer.length, 1, 'the room got exactly one port');
	// A value injected into the frame is escaped so a closing tag inside it cannot end the script.
	const { frame: f2 } = setup('https://x/inside.js', { evil: '</script><script>alert(1)</script>' });
	const r2 = iframe({ inside: 'https://x/inside.js', into: { appendChild: () => {} }, document: { createElement: () => f2 }, MessageChannel: fakeChannel(), importMap: { evil: '</script>x' } });
	await r2.start();
	assert.ok(!f2.attrs.srcdoc!.includes('</script>x'), 'the injected value did not survive as raw markup');
	assert.ok(f2.attrs.srcdoc!.includes('\\u003c/script>x'), 'it was escaped instead');
	void channel;
	await runner.stop();
	await r2.stop();
	assert.equal(frame.attrs.removed, 'yes', 'stop removes the frame');
});

test('the iframe runner refuses to run without a document and a MessageChannel', () => {
	assert.throws(() => iframe({ inside: 'x', into: { appendChild: () => {} } }), (e: SandboxError) => e.reason === 'no-page');
});

test('a bare inside URL with no path still yields a usable script-src origin', async () => {
	const { frame } = setup('https://rooms.example');
	// originOf returns the whole string when there is no path after the host.
	const runner = iframe({ inside: 'https://rooms.example', into: { appendChild: () => {} }, document: { createElement: () => frame }, MessageChannel: fakeChannel() });
	await runner.start();
	assert.match(frame.attrs.srcdoc!, /script-src 'unsafe-inline' data: https:\/\/rooms\.example"/);
	await runner.stop();
});
