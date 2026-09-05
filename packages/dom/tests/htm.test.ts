// html: the template tag.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';

import { createDocument, h, htm, html, mount, toHtml } from '../src/index.ts';

const markupOf = (item: unknown): string => {
	const doc = createDocument();
	mount(doc.body, item);
	return toHtml(doc.body.childNodes);
};

test('elements, nesting, attributes in every spelling, and self-closing', () => {
	assert.equal(markupOf(html`<div class="a" id=b hidden data-x='c' n=${3}><p>t</p><br/><input disabled /></div>`),
		'<div class="a" id="b" hidden data-x="c" n="3"><p>t</p><br><input disabled></div>');
	assert.equal(markupOf(html`<a href=/x/>y</a>`), '<a href="/x/">y</a>');
	assert.throws(() => html`<img src=x/>`, /unclosed/, 'an unquoted value swallows the slash; close void elements yourself');
	assert.equal(markupOf(html`<p>${'a'}${'b'}</p>`), '<p>ab</p>');
});

test('the closing shorthand, a tag expression, and a spread', () => {
	const Comp = ({ children, ...rest }: { children: unknown[]; title?: string }) => h('section', { title: rest.title }, ...children);
	const props = { title: 'spread', id: 'x' };
	assert.equal(markupOf(html`<${Comp} title=t>in</>`), '<section title="t">in</section>');
	assert.equal(markupOf(html`<div =${props} ${props}></div>`), '<div title="spread" id="x"></div>');
	assert.equal(markupOf(html`<p>a</${'ignored'}>`), '<p>a</p>');
	assert.throws(() => html`<div =${1}>`, /object/);
	assert.throws(() => html`<div =`, /spread/);
});

test('$ properties and event handlers', () => {
	const doc = createDocument();
	let clicks = 0;
	mount(doc.body, html`<button $onclick=${() => { clicks += 1; }} $value="v">go</button>`);
	const button = doc.body.children[0]!;
	button.dispatchEvent({ type: 'click' });
	assert.equal(clicks, 1);
	assert.equal(button['value'], 'v');
});

test('whitespace: lines trim, blank lines go, and a break inside text is one space', () => {
	assert.equal(markupOf(html`
		<div>
			<p>
				hello
				world
			</p>
			<b>a</b> <i>b</i>
		</div>
	`), '<div><p>hello world</p><b>a</b> <i>b</i></div>');
	assert.equal(markupOf(html`<p>Welcome ${'you'}!</p>`), '<p>Welcome you!</p>');
	assert.equal(html``, null);
	assert.equal(html`
	`, null);
	assert.equal(html`   `, '   ', 'a space on one line is kept');
	assert.equal(html`plain`, 'plain');
});

test('several roots come back as an array, and comments vanish', () => {
	const out = html`<!-- a --><p>1</p><!-- b --><p>2</p>${'three'}`;
	assert.ok(Array.isArray(out));
	assert.equal(markupOf(out), '<p>1</p><p>2</p>three');
	assert.throws(() => html`<!-- open`, /comment/);
});

test('a quoted attribute with expressions joins, and follows a cell when one is inside', () => {
	const doc = createDocument();
	const tone = mutable('warm');
	mount(doc.body, html`<p class="note ${tone} big" title="${'only'}" alt="a${1}b"></p>`);
	const p = doc.body.children[0]!;
	assert.equal(p.getAttribute('class'), 'note warm big');
	assert.equal(p.getAttribute('title'), 'only');
	assert.equal(p.getAttribute('alt'), 'a1b');
	tone.set('cold');
	assert.equal(p.getAttribute('class'), 'note cold big');

	const joined = htm(h, { join: (parts) => parts.map(String).join('+') });
	assert.equal(markupOf(joined`<p id="a${1}"></p>`), '<p id="a+1"></p>');
});

test('malformed templates are refused with a reason', () => {
	assert.throws(() => html`<div>`, /unclosed/);
	assert.throws(() => html`</div>`, /nothing open/);
	assert.throws(() => html`<div></span>`, /closes/);
	assert.throws(() => html`<div title=>`, /value/);
	assert.throws(() => html`<div "x">`, /unexpected/);
	assert.throws(() => html`<div title="open>`, /unterminated attribute/);
	assert.throws(() => html`<div `, /unterminated </);
	assert.throws(() => html`<`, /name/);
	assert.throws(() => html`<p></p `, /unterminated closing/);
});
