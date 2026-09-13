// A page everyone can use: an image that says what it shows, a form whose fields have names, a
// button that is only an icon and still has a name, a menu and a dialog the keyboard drives, and
// a status message a screen reader hears when it changes.
//
// Nothing here is written for the checks. It is the ordinary way to write these things with the
// stack, and the checks are what say so: the build reads the markup, the mount reads the page,
// and `main.ts` drives it with `audit` and `walk`.

import { mutable } from '@aweftjs/core';
import {
	Button, Checkbox, Default, Icon, Menu, Modal, Stage, StageContext, TextField, Theme, h,
} from '@aweftjs/ui';
import type { StageValue } from '@aweftjs/ui';

Theme.define({
	// A page's own sizes are named where they are given, the way the theme names its own.
	main: { $measure: '40rem', display: 'flex', flexDirection: 'column', alignItems: 'start', gap: '$space4', maxWidth: '$measure' },
	mark: { $markSize: '4rem', width: '$markSize', height: '$markSize' },
	fields: { display: 'flex', flexDirection: 'column', gap: '$space3', width: '100%' },
	actions: { display: 'flex', gap: '$space2', alignItems: 'center' },
});

// One drawing, inline, so the recipe carries no image file. The `alt` beside it is the point.
const MARK = 'data:image/svg+xml,' + encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#4a7" /></svg>',
);

const Note = (): unknown => (
	<div theme="column">
		<p theme="text" id="dialog-body">The note goes out the moment you close this.</p>
	</div>
);

export const Page = (): unknown => {
	const name = mutable('');
	const note = mutable('');
	const copy = mutable(false);
	// A live region announces what changes inside it, so the message lands in an element that is
	// already on the page, and the cell fills it in (WCAG 4.1.3).
	const status = mutable('');
	const picked = mutable('');

	const send = (): void => {
		status.set(`Sent to ${name.get() === '' ? 'nobody' : name.get()}${copy.get() ? ', with a copy to you' : ''}.`);
	};
	const clear = (): void => {
		name.set('');
		note.set('');
		copy.set(false);
		status.set('Cleared.');
	};

	const Opener = StageContext.use((stage: StageValue | null) => (): unknown => (
		<Button
			label="Preview"
			type="quiet"
			id="preview"
			onClick={() => { stage?.open({ name: 'preview', template: Modal, label: 'Your note' }); }}
		/>
	));

	return (
		<main theme="main" id="page">
			<h1>Send a note</h1>

			{/* WCAG 1.1.1: what the image shows, in words. Decoration would be alt="". */}
			<img src={MARK} alt="A green circle, the mark of this recipe" theme="mark" />

			{/* WCAG 1.3.1, 3.3.2: each field has a label the component pairs to it. */}
			<div theme="fields">
				<TextField label="To" value={name} id="to" />
				<TextField label="Note" value={note} id="note" onEnter={send} />
				<Checkbox label="Send me a copy" value={copy} id="copy" />
			</div>

			<div theme="actions">
				<Button label="Send" id="send" onClick={send} />
				{/* WCAG 4.1.2: an icon on its own is not a name, so the button carries one. */}
				<Button size="icon" type="quiet" aria-label="Clear the form" id="clear" icon={<Icon name="lucide:x" />} onClick={clear} />
				<Menu
					id="more"
					label="More"
					items={[
						{ label: 'Save as draft', onSelect: () => { picked.set('draft'); } },
						{ label: 'Schedule', onSelect: () => { picked.set('schedule'); } },
					]}
				/>
				<StageContext acts={{ '': () => null, preview: Note }} initial="" template={Default}>
					<Opener />
					<Stage />
				</StageContext>
			</div>

			{/* WCAG 4.1.3: a status message, in the page before it has anything to say. */}
			<p theme={['text', 'sm']} role="status" id="status">{status}</p>
			<p theme={['text', 'sm', 'muted']} id="picked">{picked}</p>
		</main>
	);
};
