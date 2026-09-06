// The markup dialect at build time: every refusal the runtime parser makes, made here instead.
//
// The expectations are written from the dialect `dom`'s README states, and each one names the
// fault a page would have hit at render time. A refusal that stopped happening would let a broken
// page through to a browser, which is the whole point of moving them (design 096).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDocument, h, html, mount, toHtml } from '@aweftjs/dom';

import { TransformError, transform } from '../src/index.ts';

const dom = "import { h, html } from '@aweftjs/dom';\n";
const compile = (markup: string): string => transform(`${dom}export const a = ${markup};`, { filename: 'm.ts' }).code;

const refuses = (markup: string, message: RegExp): void => {
	assert.throws(() => compile(markup), (error: unknown) => {
		assert.ok(error instanceof TransformError, 'a fault in the source is a TransformError');
		assert.match((error as TransformError).message, message);
		assert.equal(typeof (error as TransformError).at, 'number');
		// Every refusal in the stack carries a token to branch on and a remedy to act on
		// (design 101), and a build-time one is read by whoever is fixing the page.
		assert.match((error as TransformError).reason, /^[a-z][a-z-]*$/, 'a stable reason token');
		assert.match((error as TransformError).fix, /^[A-Z].*\.$/, 'a remedy, written as a sentence');
		return true;
	});
};

test('a closing tag that names a different element is refused', () => {
	refuses('html`<p></div>`', /<\/div> closes <p>/);
});

test('a closing tag with nothing open is refused', () => {
	refuses('html`</p>`', /a closing tag with nothing open/);
});

test('an element left open is refused', () => {
	refuses('html`<p>text`', /unclosed <p>/);
});

test('a tag left unterminated is refused', () => {
	refuses('html`<p class="x"`', /unterminated <p>/);
});

test('a tag with no name is refused', () => {
	refuses('html`< >`', /a tag needs a name/);
});

test('a spread written without its equals sign is refused', () => {
	refuses('html`<p = "x"></p>`', /a spread is written/);
});

test('an unterminated quoted attribute is refused', () => {
	refuses('html`<p class="x></p>`', /unterminated attribute class/);
});

test('a comment that does not end in its own piece is refused', () => {
	refuses('html`<p><!-- open </p>`', /a comment must end in the same template piece/);
});

test('a closing tag left unterminated is refused', () => {
	refuses('html`<p></p`', /unterminated closing tag/);
});

test('an attribute name that cannot be read is refused', () => {
	refuses('html`<p "x"></p>`', /unexpected .* in <p>/);
});

test('a fault reports where it is in the file', () => {
	const source = `${dom}export const a = html\`\n\t<p></div>\n\`;`;
	assert.throws(() => transform(source, { filename: 'm.ts' }), (error: unknown) => {
		const at = (error as TransformError).at;
		assert.ok(at > source.indexOf('<p>'), 'the position is inside the template');
		assert.ok(at < source.length);
		return true;
	});
});

test('the empty and multi-root shapes are what the runtime parser answers', () => {
	assert.match(compile('html``'), /export const a = null;/);
	assert.match(compile('html`<p></p><i></i>`'), /export const a = \[_t0\(\[\]\), _t1\(\[\]\)\];/);
	refuses('html`</>`', /a closing tag with nothing open/);
});

test('a closing tag with no name closes whatever is open', () => {
	assert.match(compile('html`<p>x</>`'), /_template\(\["p",null,"x"\], \[\]\)/);
});

test('markup is left alone when html is not dom\'s', () => {
	const source = "const html = (s) => s;\nexport const a = html`<p></div>`;";
	assert.equal(transform(source, { filename: 'm.ts' }).code, source);
});

test('a spread of a non-object is compiled rather than refused, and renders what it spreads', () => {
	// The one refusal that does not move to build time (design 096), pinned so the gap that note
	// and the README name is the gap that actually exists. The parser refuses a non-object; the
	// compiled call spreads it, and a string spreads as one attribute per character.
	assert.match(compile('html`<div =${rest}>x</div>`'), /h\("div", \{ \.\.\.rest \}, "x"\)/);

	const compiled = createDocument();
	mount(compiled.body, h('div', { ...('ab' as unknown as object) }, 'x'));
	assert.equal(toHtml(compiled.body), '<body><div 0="a" 1="b">x</div></body>');

	assert.throws(() => mount(createDocument().body, html`<div =${'ab'}>x</div>`),
		/a spread in a tag must be an object/);
});
