// Typography and TextModifiers: the whole type family, and the list a run of text is passed
// through on its way to the page.
//
// Every specimen wears its look on a `<p>`. The page's outline is the section list down the left,
// and a specimen that was a real `<h3>` would join it and say something about this page that is
// not true. That the first segment picks the element is what the preview page shows and asserts.

import { mutable } from '@aweftjs/core';
import { TextField, TextModifiers, Typography, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Typography';
export const order = 50;

const LEVELS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const note = mutable('nothing to do yet');

	return (
		<div theme="column">
			<p theme={['text', 'sm', 'muted']}>The scale</p>
			{LEVELS.map((level) => (
				<Typography type={level} element={<p />} id={at(`typography-${level}`)} label={`Heading ${level}`} />
			))}
			<Typography type="p1" id={at('typography-p1')} label="Body copy at one rem, with the line height that belongs to it." />
			<Typography type="p2" id={at('typography-p2')} label="The smaller body size." />

			<p theme={['text', 'sm', 'muted']}>The modifiers, on the same size</p>
			<Typography type="p1_bold" label="Bold" />
			<Typography type="p1_italic" label="Italic" />
			<Typography type="p1_center" label="Centred" />
			<Typography type="p1_muted" label="Quiet" />
			<Typography type="p1_mono" label="monospace 0123456789" />
			<Typography type="p2">
				An <Typography type="sm_inline_bold" id={at('typography-inline')} label="inline run" /> inside a line of text.
			</Typography>

			<p theme={['text', 'sm', 'muted']}>A run passed through the modifier list</p>
			<TextField label="A note" value={note} id={at('typography-note-field')} />
			<TextModifiers
				value={[
					{ check: 'TODO', return: (word: string) => <b theme={['text', 'bold']}>{word}</b> },
					{ check: /@\w+/g, return: (who: string) => <i theme={['text', 'muted']}>{who}</i> },
				]}
			>
				<Typography type="p1" id={at('typography-note')} label={note} />
			</TextModifiers>
		</div>
	);
};
