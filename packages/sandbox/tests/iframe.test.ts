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

test('a hostile inside URL cannot end the policy or the attribute: its origin is cut like every other', async () => {
	const { frame, runner } = setup('https://page.test"><script>alert(1)</script><meta x="');
	await runner.start();
	const srcdoc = frame.attrs.srcdoc!;
	assert.ok(!srcdoc.includes('<script>alert(1)'), 'no script from the inside string reached the markup');
	assert.ok(!srcdoc.includes('<meta x='), 'nor a second element');
	assert.match(policyOf(frame)['script-src']!, /^'unsafe-inline' data: https:\/\/page\.test[A-Za-z0-9]*$/, 'the origin, with the rest stripped');
	assert.equal(Object.keys(policyOf(frame)).length, 2, 'and no directive beyond the two');
	await runner.stop();
});

test('a title given to the runner is the frame\'s, and a runner given none writes none', async () => {
	const frame = fakeFrame();
	const runner = iframe({ inside: 'https://rooms.example/inside.js', into: { appendChild: () => {} }, document: { createElement: () => frame }, MessageChannel: fakeChannel(), title: 'The board' });
	await runner.start();
	assert.equal(frame.attrs.title, 'The board', 'the name a screen reader reads for the frame');
	await runner.stop();
	const { frame: bare, runner: plain } = setup('https://rooms.example/inside.js');
	await plain.start();
	assert.equal(bare.attrs.title, undefined);
	await plain.stop();
});

test('a bare inside URL with no path still yields a usable script-src origin', async () => {
	const { frame } = setup('https://rooms.example');
	// originOf returns the whole string when there is no path after the host.
	const runner = iframe({ inside: 'https://rooms.example', into: { appendChild: () => {} }, document: { createElement: () => frame }, MessageChannel: fakeChannel() });
	await runner.start();
	assert.match(frame.attrs.srcdoc!, /script-src 'unsafe-inline' data: https:\/\/rooms\.example"/);
	await runner.stop();
});

/** The policy the frame was given, as directive name to its sources. */
const policyOf = (frame: { attrs: Record<string, string> }): Record<string, string> => {
	const content = /Content-Security-Policy" content="([^"]*)"/.exec(frame.attrs.srcdoc!)![1]!;
	return Object.fromEntries(content.split('; ').map((directive) => {
		const at = directive.indexOf(' ');
		return [directive.slice(0, at), directive.slice(at + 1)];
	}));
};

test('allow opens styles, images, fonts and media and nothing else (design 284)', async () => {
	const inside = 'https://rooms.example:8443/room/inside.js';
	const bare = setup(inside);
	await bare.runner.start();
	assert.deepEqual(policyOf(bare.frame), {
		'default-src': "'none'",
		'script-src': "'unsafe-inline' data: https://rooms.example:8443",
	}, 'with no allow the policy is what it always was');

	const opened = fakeFrame();
	const runner = iframe({
		inside, into: { appendChild: () => {} }, document: { createElement: () => opened }, MessageChannel: fakeChannel(),
		allow: { styles: true, images: ['https://cdn.example/avatars/'], fonts: [], media: ['https://media.example:9000/x', 'https://cdn.example'] },
	});
	await runner.start();
	assert.deepEqual(policyOf(opened), {
		'default-src': "'none'",
		'script-src': "'unsafe-inline' data: https://rooms.example:8443",
		'style-src': "'unsafe-inline'",
		'img-src': 'https://rooms.example:8443 data: blob: https://cdn.example',
		'font-src': 'https://rooms.example:8443 data: blob:',
		'media-src': 'https://rooms.example:8443 data: blob: https://media.example:9000 https://cdn.example',
	});
	assert.ok(!opened.attrs.srcdoc!.includes('connect-src'), 'connect-src is never written, so it stays under default-src none');
	assert.equal(opened.attrs.sandbox, 'allow-scripts', 'the sandbox attribute does not widen');
	await runner.stop();

	// An origin that tries to end the directive or the attribute is cut to the characters an
	// origin may hold, and a list with no styles adds no style-src.
	const hostile = fakeFrame();
	const r2 = iframe({
		inside, into: { appendChild: () => {} }, document: { createElement: () => hostile }, MessageChannel: fakeChannel(),
		allow: { images: ['https://x.example; connect-src *', 'https://y.example"><script>'] },
	});
	await r2.start();
	const policy = policyOf(hostile);
	assert.equal(policy['img-src'], 'https://rooms.example:8443 data: blob: https://x.exampleconnect-src* https://y.examplescript');
	assert.equal(policy['connect-src'], undefined, 'no origin can smuggle a directive in');
	assert.equal(policy['style-src'], undefined, 'no styles were asked for');
	assert.ok(!hostile.attrs.srcdoc!.includes('"><script>'), 'nor end the attribute');
	await r2.stop();
});
