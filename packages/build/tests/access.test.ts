// The access rules (design 265): an element the source says no one could read is refused at the
// line that wrote it, in every notation, and an element the source cannot judge is left alone.
//
// Each expectation is written from the criterion the rule stands for, so a rule that stopped
// refusing would let that fault through to a page.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { TransformError, transform } from '../src/index.ts';

import { scratch } from './fixtures.ts';

const space = scratch();
after(() => space.done());

const dom = "import { h, html } from '@aweftjs/dom';\nconst Card = () => null;\n";
const compile = (expression: string): string => transform(`${dom}export const a = ${expression};`, { filename: 'a.tsx' }).code;

const refused = (expression: string): TransformError => {
	let caught: unknown = null;
	try {
		compile(expression);
	} catch (error) {
		caught = error;
	}
	assert.ok(caught instanceof TransformError, `${expression} is refused`);
	return caught;
};

const refuses = (expression: string, reason: string, fix: RegExp): void => {
	const error = refused(expression);
	assert.equal(error.reason, reason);
	assert.match(error.fix, fix);
	assert.match(error.fix, /^[A-Z].*\.$/, 'a remedy, written as a sentence');
	// The offset points at the element, which is the first `<` or `h(` after the prefix.
	const source = `${dom}export const a = ${expression};`;
	assert.equal(source.slice(error.at, error.at + 1), expression.startsWith('h(') ? 'h' : '<', 'the offset is the element');
};

const passes = (expression: string): void => {
	assert.doesNotThrow(() => compile(expression), `${expression} passes`);
};

// --- each rule, on its fault and on its fix ---------------------------------------------------

test('an image with no alt is refused, and one with an alt is not (1.1.1)', () => {
	refuses('<img src="a.png" />', 'image-needs-alt', /alt/);
	passes('<img src="a.png" alt="a cat" />');
	passes('<img src="a.png" alt="" />');
});

test('a control with no way to be labelled is refused (1.3.1, 3.3.2, 4.1.2)', () => {
	refuses('<input type="text" />', 'control-needs-label', /id and a <label for>/);
	refuses('<textarea />', 'control-needs-label', /aria-label/);
	refuses('<select><option>a</option></select>', 'control-needs-label', /label/);
	passes('<input id="name" />');
	passes('<input aria-label="name" />');
	passes('<input aria-labelledby="name-label" />');
});

test('an input that names itself or reaches nobody is exempt', () => {
	passes('<input type="hidden" name="token" />');
	passes('<input type="HIDDEN" name="token" />');
	passes('<input type="submit" value="Send" />');
	passes('<input type="button" value="Go" />');
	passes('<input type="reset" />');
	passes('<input type="image" src="go.png" alt="go" />');
});

test('a control inside a label in the same tree is labelled by it', () => {
	passes('<label>Name <input /></label>');
	passes('<label><span>Name</span><span><input /></span></label>');
	// A label beside the control, not around it: an `id` is what pairs them.
	refuses('<div><label>Name</label><input /></div>', 'control-needs-label', /label/);
});

test('a label the hoister cannot take whole still labels the control inside it', () => {
	// A spread keeps the label out of a template, so its children are emitted on their own; the
	// rules ran over the whole tree first and do not run again over the child without its parent.
	passes('<label {...rest}>Name <input /></label>');
	passes('<label class={tone}><span {...rest}>Name</span><input /></label>');
});

test('a click on an element the keyboard cannot reach is refused (2.1.1, 4.1.2)', () => {
	refuses('<div $onclick={() => 1}>go</div>', 'click-needs-role', /<button>/);
	refuses('<span onClick={() => 1}>go</span>', 'click-needs-role', /role and a tabindex/);
	passes('<div role="button" tabindex="0" $onclick={() => 1}>go</div>');
	passes('<button $onclick={() => 1}>go</button>');
	passes('<a href="/x" $onclick={() => 1}>go</a>');
	passes('<summary onClick={() => 1}>more</summary>');
	passes('<label onClick={() => 1}>on</label>');
});

test('a positive tabindex is refused, and zero and minus one are not (2.4.3)', () => {
	refuses('<div tabindex="1">x</div>', 'tabindex-positive', /0 to join|-1/);
	refuses('<div tabIndex={3}>x</div>', 'tabindex-positive', /reach it from code/);
	passes('<div tabindex="0">x</div>');
	passes('<div tabindex="-1">x</div>');
	passes('<div tabindex={0}>x</div>');
});

test('a link with no href is refused (2.1.1, 4.1.2)', () => {
	refuses('<a>docs</a>', 'link-needs-href', /href/);
	refuses('<a $onclick={() => 1}>docs</a>', 'link-needs-href', /<button>/);
	passes('<a href="/docs">docs</a>');
	passes('<a href={target}>docs</a>');
});

test('a button with nothing in it and no name is refused (4.1.2)', () => {
	refuses('<button />', 'button-needs-name', /text inside|aria-label/);
	passes('<button>Save</button>');
	passes('<button>{label}</button>');
	passes('<button aria-label="Save" />');
	passes('<button aria-labelledby="save-label" />');
	passes('<button title="Save" />');
});

test('an empty heading is refused (2.4.6)', () => {
	refuses('<h1 />', 'heading-needs-text', /text inside|drop the heading/);
	refuses('<h3></h3>', 'heading-needs-text', /heading/);
	passes('<h1>Title</h1>');
	passes('<h2>{title}</h2>');
	passes('<h2 aria-label="Title" />');
});

test('a frame with no title is refused (4.1.2)', () => {
	refuses('<iframe src="/map" />', 'frame-needs-title', /title/);
	passes('<iframe src="/map" title="The map" />');
});

// --- the same fault in every notation ---------------------------------------------------------

test('the same fault is refused as JSX, as markup and as an h call', () => {
	refuses('<img src="a.png" />', 'image-needs-alt', /alt/);
	refuses('html`<img src="a.png" />`', 'image-needs-alt', /alt/);
	refuses("h('img', { src: 'a.png' })", 'image-needs-alt', /alt/);
});

test('markup is refused at the element inside the template, not at the template', () => {
	const error = refused('html`<div>\n<img src="a.png" />\n</div>`');
	const source = `${dom}export const a = html\`<div>\n<img src="a.png" />\n</div>\`;`;
	assert.equal(source.slice(error.at, error.at + 4), '<img');
});

test('a fault deep in a tree is found, whatever its parent is', () => {
	refuses('<main><section><p>text</p><img src="a.png" /></section></main>', 'image-needs-alt', /alt/);
	refuses('<ul>{items}<li><a>x</a></li></ul>', 'link-needs-href', /href/);
	// A component or a spread is not read itself, and what is inside it still is.
	refuses('<Card><img src="a.png" /></Card>', 'image-needs-alt', /alt/);
	refuses('<main><Card><img src="a.png" /></Card></main>', 'image-needs-alt', /alt/);
	refuses('<div {...rest}><div><a>docs</a></div></div>', 'link-needs-href', /href/);
	refuses('html`<${Card}><img src="a.png" /></${Card}>`', 'image-needs-alt', /alt/);
	refuses("h(Card, null, h('img', { src: 'a.png' }))", 'image-needs-alt', /alt/);
});

// --- what the source cannot judge is left alone -----------------------------------------------

test('an attribute given as an expression is present, whatever it holds', () => {
	passes('<img src="a.png" alt={caption} />');
	passes('<input id={id} />');
	passes('<div tabindex={order} $onclick={go}>x</div>');
	passes('<iframe title={name} />');
});

test('a spread makes the element unknowable, so it passes', () => {
	passes('<img {...props} />');
	passes('<input {...field} />');
	passes('<div {...rest} $onclick={go}>x</div>');
	passes("h('img', { ...props })");
});

test('a tag that is not a literal name is not an element the rules see', () => {
	passes("h(tag, { src: 'a.png' })");
	passes('<Image src="a.png" />');
});

test('a null child is nothing inside, and a text child is something', () => {
	passes('<button>{null}</button>');
	passes('<h1>{null}</h1>');
	refuses('<button></button>', 'button-needs-name', /aria-label/);
	refuses('<button> </button>', 'button-needs-name', /aria-label/);
	refuses('<h1> </h1>', 'heading-needs-text', /heading/);
});

// --- the loader ------------------------------------------------------------------------------------

test('a .tsx imported through the loader is refused with the reason and the file', async () => {
	const file = join(space.dir, 'gallery.tsx');
	writeFileSync(file, `import { h } from '@aweftjs/dom';\n\nexport const Gallery = () => (\n\t<section>\n\t\t<img src="one.png" />\n\t</section>\n);\n`);

	await assert.rejects(
		() => import(pathToFileURL(file).href),
		(error: Error) => {
			assert.match(error.message, /gallery\.tsx:5:2: /, 'the file and the line the element is on');
			assert.match(error.message, /image-needs-alt/);
			// The hooks run on their own thread, so the cause arrives as a plain Error carrying the
			// message, the way the parser's own fault does.
			assert.ok(error.cause instanceof Error, 'the refusal is kept as the cause');
			assert.match(error.cause.message, /^image-needs-alt: /);
			return true;
		},
	);
});
