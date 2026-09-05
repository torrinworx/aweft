// The light tree: a document with no browser, its markup out and its markup back in.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDocument, parseHtml, toHtml } from '../src/index.ts';

test('a document starts with html, head and body', () => {
	const doc = createDocument();
	assert.equal(toHtml(doc.documentElement), '<html><head></head><body></body></html>');
	assert.equal(doc.body.parentNode, doc.documentElement);
	assert.equal(doc.body.ownerDocument, doc);
	assert.equal(doc.body.isConnected, true);
	assert.equal(doc.createElement('DIV').localName, 'div');
	assert.equal(doc.createElement('div').tagName, 'DIV');
});

test('children link both ways through insert, remove and replace', () => {
	const doc = createDocument();
	const ul = doc.createElement('ul');
	const a = doc.createElement('li');
	const b = doc.createElement('li');
	const c = doc.createElement('li');
	ul.appendChild(a);
	ul.appendChild(c);
	ul.insertBefore(b, c);
	assert.deepEqual(ul.childNodes, [a, b, c]);
	assert.equal(b.previousSibling, a);
	assert.equal(b.nextSibling, c);
	assert.equal(ul.firstChild, a);
	assert.equal(ul.lastChild, c);

	// Inserting a child it already holds moves it.
	ul.insertBefore(c, a);
	assert.deepEqual(ul.childNodes, [c, a, b]);
	assert.equal(ul.insertBefore(a, a), a, 'a node before itself is a no-op');

	ul.removeChild(a);
	assert.deepEqual(ul.childNodes, [c, b]);
	assert.equal(a.parentNode, null);
	assert.equal(a.nextSibling, null);

	const d = doc.createElement('li');
	assert.equal(ul.replaceChild(d, c), c);
	assert.deepEqual(ul.childNodes, [d, b]);
	assert.deepEqual(ul.children.map((e) => e.localName), ['li', 'li']);
	assert.ok(ul.contains(d));
	assert.ok(!ul.contains(c));

	assert.throws(() => ul.removeChild(c), /not a child/);
	assert.throws(() => ul.insertBefore(a, c), /reference node/);
	d.remove();
	assert.deepEqual(ul.childNodes, [b]);
	assert.equal(d.isConnected, false);
});

test('textContent reads through and writing it replaces the children', () => {
	const doc = createDocument();
	const p = doc.createElement('p');
	p.appendChild(doc.createTextNode('a'));
	p.appendChild(doc.createComment('x'));
	const b = doc.createElement('b');
	b.appendChild(doc.createTextNode('c'));
	p.appendChild(b);
	assert.equal(p.textContent, 'ac');

	p.textContent = 'plain';
	assert.equal(toHtml(p), '<p>plain</p>');
	p.textContent = '';
	assert.equal(p.firstChild, null);
	p.textContent = null;
	assert.equal(p.firstChild, null);

	const text = doc.createTextNode('hello world');
	text.textContent = 'x';
	assert.equal(text.data, 'x');
	assert.equal(text.length, 1);
	const comment = doc.createComment('c');
	comment.textContent = 'd';
	assert.equal(comment.textContent, 'd');
});

test('splitText leaves the rest as the next sibling', () => {
	const doc = createDocument();
	const p = doc.createElement('p');
	const text = doc.createTextNode('hello world');
	p.appendChild(text);
	const rest = text.splitText(5);
	assert.equal(text.data, 'hello');
	assert.equal(rest.data, ' world');
	assert.equal(text.nextSibling, rest);
	assert.equal(toHtml(p), '<p>hello world</p>');
});

test('attributes, id, class, classList and style', () => {
	const doc = createDocument();
	const div = doc.createElement('div');
	div.setAttribute('data-x', '1');
	assert.equal(div.getAttribute('data-x'), '1');
	assert.equal(div.hasAttribute('data-x'), true);
	assert.equal(div.getAttribute('missing'), null);
	div.removeAttribute('data-x');
	assert.equal(div.hasAttribute('data-x'), false);
	assert.equal(div.toggleAttribute('hidden'), true);
	assert.equal(div.toggleAttribute('hidden'), false);
	assert.equal(div.toggleAttribute('hidden', true), true);
	assert.deepEqual(div.getAttributeNames(), ['hidden']);

	div.id = 'main';
	div.className = 'a b';
	assert.equal(div.id, 'main');
	assert.equal(div.className, 'a b');
	div.classList.add('c', 'a');
	div.classList.remove('b');
	assert.equal(div.classList.toggle('d'), true);
	assert.equal(div.classList.toggle('d'), false);
	assert.equal(div.classList.toggle('e', false), false);
	assert.ok(div.classList.contains('c'));
	assert.equal(div.classList.length, 2);
	assert.deepEqual([...div.classList], ['a', 'c']);
	div.classList.remove('a', 'c');
	assert.equal(div.hasAttribute('class'), false);
	assert.equal(div.className, '');

	div.style['backgroundColor'] = 'red';
	div.style['opacity'] = 0.5;
	assert.equal(div.style['backgroundColor'], 'red');
	assert.equal(div.style.getPropertyValue('background-color'), 'red');
	assert.equal(div.style.cssText, 'background-color: red; opacity: 0.5;');
	div.style['opacity'] = null;
	div.style.removeProperty('background-color');
	assert.equal(div.style.cssText, '');
	div.style.cssText = 'color: blue; margin:0; bad';
	assert.equal(div.style['color'], 'blue');
	assert.equal(div.style['margin'], '0');
	assert.equal(div.style['unset'], '');
});

test('listeners are kept and dispatchEvent reaches them and the on-property', () => {
	const doc = createDocument();
	const button = doc.createElement('button');
	const seen: string[] = [];
	const listener = () => seen.push('listener');
	button.addEventListener('click', listener);
	button['onclick'] = () => seen.push('property');
	button.dispatchEvent({ type: 'click' });
	button.removeEventListener('click', listener);
	button.dispatchEvent({ type: 'click' });
	button.dispatchEvent({ type: 'other' });
	assert.deepEqual(seen, ['property', 'listener', 'property']);
});

test('toHtml escapes, leaves void elements open and script raw, and prints style', () => {
	const doc = createDocument();
	const div = doc.createElement('div');
	div.setAttribute('title', 'a "quoted" & <thing>');
	div.setAttribute('hidden', '');
	div.style['color'] = 'red';
	div.appendChild(doc.createTextNode('1 < 2 & 3 > 2'));
	div.appendChild(doc.createElement('br'));
	const script = doc.createElement('script');
	script.appendChild(doc.createTextNode('if (a < b && c) {}'));
	div.appendChild(script);
	div.appendChild(doc.createComment(' note '));
	const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.appendChild(doc.createElementNS('http://www.w3.org/2000/svg', 'circle'));
	div.appendChild(svg);

	assert.equal(
		toHtml(div),
		'<div title="a &quot;quoted&quot; &amp; <thing>" hidden style="color: red;">1 &lt; 2 &amp; 3 &gt; 2<br>'
		+ '<script>if (a < b && c) {}</script><!-- note --><svg><circle></circle></svg></div>',
	);
	assert.equal(svg.nodeName, 'svg', 'a namespaced element keeps its case');

	const styled = doc.createElement('p');
	styled.setAttribute('style', 'margin: 0');
	styled.style['color'] = 'red';
	assert.equal(toHtml(styled), '<p style="margin: 0"></p>', 'a style attribute wins over the map');

	assert.equal(toHtml([doc.createTextNode('a'), doc.createElement('i')]), 'a<i></i>');
	assert.equal(toHtml(doc), '<html><head></head><body></body></html>');
	assert.equal(div.outerHTML, toHtml(div));
	assert.equal(div.innerHTML, toHtml(div.childNodes));
});

test('parseHtml reads what toHtml wrote, and the shapes a page writes by hand', () => {
	const doc = createDocument();
	const [div] = parseHtml(
		'<div title="a &quot;quoted&quot; &amp; &lt;thing&gt;" hidden data-n=\'1\' data-m=2>1 &lt; 2 &#38; &#x33; &nbsp;<br/><BR>'
		+ '<script>if (a < b && c) {}</script><!-- note --><svg><circle/></svg><p>unclosed<p>second</p></div>tail',
		doc,
	);
	const element = div as ReturnType<typeof doc.createElement>;
	assert.equal(element.getAttribute('title'), 'a "quoted" & <thing>');
	assert.equal(element.getAttribute('hidden'), '');
	assert.equal(element.getAttribute('data-n'), '1');
	assert.equal(element.getAttribute('data-m'), '2');
	assert.equal(element.childNodes[0]!.textContent, '1 < 2 & 3  ');
	assert.equal(element.children[0]!.localName, 'br');
	assert.equal(element.children[1]!.localName, 'br');
	assert.equal(element.children[2]!.textContent, 'if (a < b && c) {}');
	assert.equal(element.childNodes[4]!.nodeName, '#comment');
	assert.equal(element.childNodes[4]!.textContent, ' note ');
	assert.equal(element.children[3]!.children[0]!.localName, 'circle');
	// Auto-closing is not applied: the second p nests in the first, as written.
	assert.equal(element.children[4]!.children[0]!.localName, 'p');
	assert.equal(element.children[4]!.textContent, 'unclosedsecond');

	const roots = parseHtml('<!doctype html><a href=x>y</a>z<i>');
	assert.equal(roots.length, 3);
	assert.equal(toHtml(roots), '<a href="x">y</a>z<i></i>');

	const odd = parseHtml('<p =bad "x">t</p><b', doc);
	assert.equal(odd[0]!.textContent, 't', 'garbage in a tag does not lose the content');
	assert.equal(toHtml(odd[1]!), '<b></b>');
	assert.equal(toHtml(parseHtml('<style>a { b: c }</style>x')), '<style>a { b: c }</style>x');
	assert.equal(toHtml(parseHtml('<script>never closed')), '<script>never closed</script>');
	assert.equal(toHtml(parseHtml('</p>a</')), 'a');
	assert.equal(toHtml(parseHtml('<!-- open comment')), '<!-- open comment-->');
	assert.equal(toHtml(parseHtml('&unknown; &#xZZ;')), '&amp;unknown; &amp;#xZZ;');

	const body = doc.createElement('body');
	body.innerHTML = '<p>one</p><p>two</p>';
	assert.equal(body.children.length, 2);
	body.innerHTML = '';
	assert.equal(body.firstChild, null);
});
