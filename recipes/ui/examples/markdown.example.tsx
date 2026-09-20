// Markdown: every block and every inline form the renderer knows, a figure and a nested list
// among them, and a task list that writes its source back.
//
// The first specimen is a plain string, so its boxes are read only. The second is a cell, so a
// tick rewrites the markdown it came from and the source shown under it follows. The picture is
// a file beside the page, because a figure's source is a path and a `data:` source is text.

import { mutable } from '@aweftjs/core';
import { Markdown, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Markdown';
export const order = 52;

const SPECIMEN = [
	'# A heading',
	'',
	'A paragraph with `code`, **bold**, *italic*, ***both***, a [link](https://example.com) and',
	'**bold with `code` in it**. An image inside a sentence, a footnote and an HTML tag stay as',
	'written: ![alt](a.png), [^1], <b>tag</b>.',
	'',
	'![A figure: the picture on its own line, its alt text as the caption](/figure.svg =320x180)',
	'',
	'## A list, a nested list, a numbered list, a table',
	'',
	'- one',
	'  - one, nested',
	'    1. and a numbered list under that',
	'- two',
	'',
	'3. three',
	'4. four',
	'',
	'| entry | what it is |',
	'|---|--:|',
	'| `markdown` | the block |',
	'| `markdown_code` | a fence |',
	'',
	'> A quote, in the muted colour with a bar beside it.',
	'',
	'```ts',
	'const doc = createObject({ title: \'plan\' });',
	'```',
	'',
	'---',
	'',
	'### The end',
].join('\n');

const TASKS = '- [ ] write the page\n  - [x] the figure\n  - [ ] the list\n- [x] read the README\n- [ ] run the gate';

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const tasks = mutable(TASKS);

	return (
		<div theme="column">
			<p theme={['text', 'sm', 'muted']}>Every block and inline form</p>
			<Markdown source={SPECIMEN} id={at('markdown')} />

			<p theme={['text', 'sm', 'muted']}>A task list on a cell: a tick writes the source</p>
			<Markdown source={tasks} id={at('markdown-tasks')} />
			<pre theme="markdown_code" id={at('markdown-tasks-source')}>{tasks}</pre>

			<p theme={['text', 'sm', 'muted']}>A code hook of the page's own</p>
			<Markdown
				id={at('markdown-hook')}
				source={'```json\n{ "hooked": true }\n```'}
				code={(text: string, language: string | null) => <code data-language={language ?? ''}>{text.toUpperCase()}</code>}
			/>
		</div>
	);
};
