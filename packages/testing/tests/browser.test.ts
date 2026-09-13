// `audit` and `walk` over real pages in Chromium (design 267).
//
// Each page is written here with one fault planted, and the expectation names the fault, so a
// check that stopped seeing it would let that fault through to an application's drive.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { type Browser, type Page, chromium } from 'playwright';

import { audit, walk } from '../src/browser.ts';

let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

const shell = (body: string, head = ''): string =>
	`<!doctype html><html lang="en"><head><title>page</title>${head}</head><body>${body}</body></html>`;

const open = async (html: string): Promise<Page> => {
	const page = await browser.newPage();
	await page.setContent(html);
	return page;
};

// --- audit ---------------------------------------------------------------------------------------

test('audit reports a planted violation with the rule, its WCAG tags and the node', async () => {
	const page = await open(shell('<main><h1>Gallery</h1><img src="data:," id="cat"></main>'));
	try {
		const { violations, passes } = await audit(page);
		const found = violations.find((violation) => violation.rule === 'image-alt');
		assert.ok(found !== undefined, `image-alt is among ${violations.map((v) => v.rule).join(', ')}`);
		assert.ok(found.wcag.includes('wcag111'), `the tags name 1.1.1: ${found.wcag.join(', ')}`);
		assert.ok(found.wcag.includes('wcag2a'), 'and the level');
		assert.match(found.help, /alternat/i, 'axe says what to do');
		assert.match(found.helpUrl, /^https:\/\//);
		assert.equal(found.nodes.length, 1);
		assert.equal(found.nodes[0]!.target, '#cat');
		assert.match(found.nodes[0]!.html, /^<img/);
		assert.ok(passes > 0, 'rules that passed are counted');
	} finally {
		await page.close();
	}
});

test('audit reports nothing on a clean page, and twice on one page is fine', async () => {
	const page = await open(shell('<main><h1>Hello</h1><p>text</p><button type="button">Go</button></main>'));
	try {
		const first = await audit(page);
		assert.deepEqual(first.violations, []);
		const second = await audit(page);
		assert.deepEqual(second.violations, []);
		assert.equal(second.passes, first.passes);
	} finally {
		await page.close();
	}
});

test('audit over a root looks at that part of the page only', async () => {
	const page = await open(shell('<main><section id="clean"><p>fine</p></section><img src="data:,"></main>'));
	try {
		const scoped = await audit(page, { root: '#clean' });
		assert.deepEqual(scoped.violations, []);
		const whole = await audit(page);
		assert.ok(whole.violations.some((violation) => violation.rule === 'image-alt'));
		await assert.rejects(() => audit(page, { root: '#nothing' }), /nothing on the page matches #nothing/);
	} finally {
		await page.close();
	}
});

test('audit takes the tags it is given', async () => {
	// A page with an image and no alt: a run over a tag set with no image rule in it sees nothing.
	const page = await open(shell('<main><img src="data:,"></main>'));
	try {
		const none = await audit(page, { tags: ['cat.keyboard'] });
		assert.ok(!none.violations.some((violation) => violation.rule === 'image-alt'));
	} finally {
		await page.close();
	}
});

test('audit refuses when axe-core cannot be found, and says how to install it', async () => {
	const page = await open(shell('<p>x</p>'));
	try {
		await assert.rejects(
			() => audit(page, { locate: () => { throw new Error('not here'); } }),
			(error: { reason?: string; fix?: string; message: string }) => {
				assert.equal(error.reason, 'axe-not-installed');
				assert.match(error.fix ?? '', /Install axe-core/);
				assert.match(error.message, /not here/);
				return true;
			},
		);
		// A path that leads nowhere is the same refusal, not a raw file error.
		await assert.rejects(
			() => audit(page, { locate: () => '/nowhere/axe.min.js' }),
			(error: { reason?: string }) => error.reason === 'axe-not-installed',
		);
	} finally {
		await page.close();
	}
});

// --- walk ---------------------------------------------------------------------------------------

const RING = '<style>:focus-visible { outline: 2px solid blue; }</style>';

test('walk stops on every control in order and finds nothing wrong on a page that rings', async () => {
	const page = await open(shell(
		'<a href="/a" id="one">one</a><button type="button" id="two">two</button><input id="three" aria-label="three">',
		RING,
	));
	try {
		const { stops, problems } = await walk(page);
		assert.deepEqual(problems, []);
		assert.deepEqual(stops.map((stop) => stop.id), ['one', 'two', 'three']);
		assert.deepEqual(stops.map((stop) => stop.tag), ['a', 'button', 'input']);
		assert.equal(stops[0]!.name, 'one');
		assert.equal(stops[2]!.name, 'three', 'an aria-label is the name');
		assert.ok(stops.every((stop) => stop.ring));
	} finally {
		await page.close();
	}
});

test('walk starts from the top, whatever the page had focused', async () => {
	const page = await open(shell(
		'<button type="button" id="first">first</button><button type="button" id="second">second</button>',
		RING,
	));
	try {
		await page.evaluate('document.getElementById("first").focus()');
		assert.equal(await page.evaluate('document.activeElement.id'), 'first', 'the page focused a control on its own');
		const { stops, problems } = await walk(page);
		assert.deepEqual(stops.map((stop) => stop.id), ['first', 'second']);
		assert.deepEqual(problems, []);
	} finally {
		await page.close();
	}
});

test('walk starts from the top after a click on plain text moved the browser\'s starting point', async () => {
	const page = await open(shell(
		'<button type="button" id="a">a</button><button type="button" id="b">b</button><p id="text">text</p><button type="button" id="c">c</button>',
		RING,
	));
	try {
		await page.click('#text');
		const { stops, problems } = await walk(page);
		assert.deepEqual(stops.map((stop) => stop.id), ['a', 'b', 'c']);
		assert.deepEqual(problems, []);
	} finally {
		await page.close();
	}
});

test('a ring an ancestor draws for the control inside it counts, a shadow it always has does not', async () => {
	const page = await open(shell(
		'<div class="box"><input id="boxed" aria-label="boxed" style="outline: none"></div>'
		+ '<div class="card"><button type="button" id="carded" style="outline: none">carded</button></div>',
		'<style>.box:has(:focus-visible) { box-shadow: 0 0 0 2px blue; } .card { box-shadow: 0 1px 4px gray; }</style>',
	));
	try {
		const { stops, problems } = await walk(page);
		assert.deepEqual(stops.map((stop) => [stop.id, stop.ring]), [['boxed', true], ['carded', false]]);
		assert.deepEqual(problems.map((problem) => problem.target), ['button#carded']);
	} finally {
		await page.close();
	}
});

test('a radio group is one stop, and nothing inside a closed or hidden parent is expected', async () => {
	const page = await open(shell(
		'<input type="radio" name="size" id="s" aria-label="small"><input type="radio" name="size" id="m" aria-label="medium" checked><input type="radio" name="size" id="l" aria-label="large">'
		+ '<details><summary id="more">more</summary><button type="button" id="inside">inside</button></details>'
		+ '<div hidden><button type="button" id="under-hidden">x</button></div>'
		+ '<div style="display: none"><button type="button" id="under-none">x</button></div>'
		+ '<dialog><button type="button" id="in-dialog">x</button></dialog>'
		+ '<button type="button" id="after">after</button>',
		RING,
	));
	try {
		const { stops, problems } = await walk(page);
		assert.deepEqual(stops.map((stop) => stop.id), ['m', 'more', 'after'], 'the ticked radio, the summary, the last button');
		assert.deepEqual(problems, []);
	} finally {
		await page.close();
	}
});

test('walk keeps going through a frame, a shadow host and a media element\'s controls', async () => {
	const page = await open(shell(
		'<button type="button" id="a">a</button>'
		+ '<iframe id="f" title="frame" srcdoc="<button id=one>one</button><button id=two>two</button>"></iframe>'
		+ '<div id="host"></div>'
		+ '<audio id="sound" controls src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="></audio>'
		+ '<button type="button" id="b">b</button>'
		+ '<script>const root = document.getElementById("host").attachShadow({ mode: "open" }); root.innerHTML = "<button id=in>in</button><button id=in2>in2</button>";</script>',
		RING,
	));
	try {
		const { stops, problems } = await walk(page);
		assert.deepEqual(stops.map((stop) => stop.id), ['a', 'f', 'host', 'sound', 'b']);
		assert.deepEqual(problems, [], 'nothing inside them is stuck, ringless or unreachable');
	} finally {
		await page.close();
	}
});

test('walk names a control by its label, and leaves nothing of its own on the page', async () => {
	const page = await open(shell(
		'<label for="who">Your name</label><input id="who"><button type="button" id="go">go</button>',
		RING,
	));
	try {
		const { stops } = await walk(page);
		assert.equal(stops[0]!.name, 'Your name');
		assert.equal(await page.evaluate('typeof globalThis.__aweft_walk'), 'undefined');
	} finally {
		await page.close();
	}
});

test('walk reports a stop that draws no ring (2.4.7)', async () => {
	const page = await open(shell(
		'<button type="button" id="ok">ok</button><button type="button" id="bare" style="outline: none">bare</button>',
		RING,
	));
	try {
		const { stops, problems } = await walk(page);
		assert.equal(stops.length, 2);
		assert.deepEqual(problems.map((problem) => [problem.reason, problem.target]), [['focus-not-visible', 'button#bare']]);
		assert.match(problems[0]!.fix, /focus-visible/);
	} finally {
		await page.close();
	}
});

test('walk reports focus that Tab cannot leave (2.1.2)', async () => {
	const page = await open(shell(
		'<button type="button" id="free">free</button><div id="trap" tabindex="0">trap</div><button type="button" id="after">after</button>'
		+ '<script>document.getElementById("trap").addEventListener("keydown", (event) => { if (event.key === "Tab") event.preventDefault(); });</script>',
		RING,
	));
	try {
		const { stops, problems } = await walk(page);
		assert.deepEqual(stops.map((stop) => stop.id), ['free', 'trap']);
		const stuck = problems.find((problem) => problem.reason === 'focus-stuck');
		assert.ok(stuck !== undefined, `focus-stuck is among ${problems.map((p) => p.reason).join(', ')}`);
		assert.equal(stuck.target, 'div#trap');
		assert.match(stuck.fix, /Tab/);
		// The button after the trap was never reached, and that is reported as well.
		assert.ok(problems.some((problem) => problem.reason === 'unreachable' && problem.target === 'button#after'));
		assert.ok(!problems.some((problem) => problem.reason === 'never-cycles'), 'a trap is the finding, not the limit');
	} finally {
		await page.close();
	}
});

test('walk reports a page that sends the focus back round without letting it leave (2.1.2)', async () => {
	// The last button's handler sends Tab to the first, so the focus goes round the page and never
	// reaches the browser.
	const page = await open(shell(
		'<button type="button" id="a">a</button><button type="button" id="b">b</button><button type="button" id="c">c</button>'
		+ '<script>document.getElementById("c").addEventListener("keydown", (event) => { if (event.key === "Tab" && !event.shiftKey) { event.preventDefault(); document.getElementById("a").focus(); } });</script>',
		RING,
	));
	try {
		const { stops, problems } = await walk(page);
		assert.deepEqual(stops.map((stop) => stop.id), ['a', 'b', 'c'], 'every control was still reached');
		assert.deepEqual(problems.map((problem) => [problem.reason, problem.target]), [['focus-loops', 'button#a']]);
		assert.match(problems[0]!.fix, /leave the page/);
	} finally {
		await page.close();
	}
});

test('walk reports a control the keyboard skips over (2.1.1)', async () => {
	// A handler on the first button sends Tab straight to the third, so the second is in the tab
	// order and never gets the focus.
	const page = await open(shell(
		'<button type="button" id="a">a</button><button type="button" id="b">b</button><button type="button" id="c">c</button>'
		+ '<script>document.getElementById("a").addEventListener("keydown", (event) => { if (event.key === "Tab" && !event.shiftKey) { event.preventDefault(); document.getElementById("c").focus(); } });</script>',
		RING,
	));
	try {
		const { stops, problems } = await walk(page);
		assert.deepEqual(stops.map((stop) => stop.id), ['a', 'c']);
		assert.deepEqual(problems.map((problem) => [problem.reason, problem.target]), [['unreachable', 'button#b']]);
	} finally {
		await page.close();
	}
});

test('walk leaves out what the page itself took out of the tab order', async () => {
	const page = await open(shell(
		'<button type="button" id="on">on</button>'
		+ '<button type="button" id="minus" tabindex="-1">minus</button>'
		+ '<button type="button" id="off" disabled>off</button>'
		+ '<button type="button" id="gone" hidden>gone</button>'
		+ '<div inert><button type="button" id="inert">inert</button></div>'
		+ '<input type="hidden" id="secret">',
		RING,
	));
	try {
		const { stops, problems } = await walk(page);
		assert.deepEqual(stops.map((stop) => stop.id), ['on']);
		assert.deepEqual(problems, []);
	} finally {
		await page.close();
	}
});

test('walk gives up at the limit and says so, and a page with no controls is fine', async () => {
	const many = await open(shell(Array.from({ length: 6 }, (_, at) => `<button type="button" id="b${String(at)}">b</button>`).join(''), RING));
	const none = await open(shell('<p>nothing to press</p>'));
	try {
		const capped = await walk(many, { limit: 3 });
		assert.equal(capped.stops.length, 3);
		assert.ok(capped.problems.some((problem) => problem.reason === 'never-cycles'));
		assert.match(capped.problems.find((problem) => problem.reason === 'never-cycles')!.fix, /limit/);

		const empty = await walk(none);
		assert.deepEqual(empty.stops, []);
		assert.deepEqual(empty.problems, []);
	} finally {
		await many.close();
		await none.close();
	}
});
