// What the browser runs: one connection, the documents it shares, a search that follows its field,
// a form that signs in, and the visitor's own light or dark.
//
// Nothing here names the backend. The connection is this page's own origin, which is what makes
// the cookie the sign-in sets the cookie the next socket carries. In development that origin is
// the dev server, and `vite.config.ts` is what puts the backend behind it.

import { createAuth } from '@aweftjs/auth/client';
import { asking, createClient } from '@aweftjs/client';
import { mutable, observer } from '@aweftjs/core';
import { Button, Markdown, TextField, Theme, Typography, dark, fontFaces, h, light, mount, savedMode } from '@aweftjs/ui';
import type { Block } from '@aweftjs/ui';

interface Board {
	title: string;
}

interface Note {
	text: string;
}

interface Item {
	readonly title: string;
}

// A page of your own has `lib: ["dom"]` and writes `document` and `location` plainly. This file
// is typechecked beside the packages, which have no DOM, so it names what it reaches for.
const page = globalThis as unknown as {
	document: { body: unknown };
	location: { protocol: string; host: string };
};

// The client's own default is this origin with path `/`, and a proxy entry for that path takes
// the dev server's hot-reload socket with it, so the socket is asked for by name instead.
const socket = `${page.location.protocol === 'https:' ? 'wss' : 'ws'}://${page.location.host}/ws`;

const client = createClient({ url: socket });
const identity = createAuth(client);

// The visitor's light or dark, saved in their browser when they pick one. This page mounts rather
// than hydrating server markup, so it moves to their mode before the first paint.
const mode = savedMode({ fallback: 'system' });
mode.restore();

const title = mutable('waiting for the server');
client.share<Board>('board').ready.then((board) => {
	observer(board).path('title').effect((now) => { title.set(String(now)); });
});

// No call opens the note: sharing its name is the ask, and `notes/Note` offers it. A drop or a
// sign-in opens a new socket, the client shares the note again on it, and the module offers it
// again, onto the same document this page holds.
const note = client.share<Note>('note:pinned');
const noteText = mutable('');
note.ready.then((held) => {
	observer(held).path('text').effect((now) => { noteText.set(String(now ?? '')); });
});
noteText.watch((text) => {
	const held = note.document;
	if (held !== undefined && held.text !== text) held.text = text;
});

const notice = mutable('asking');
client.ask('board/Notice').then((said) => { notice.set(String(said)); });

// The gated module answers only a signed-in connection, so this follows `user` rather than the
// form: after `enter` the client reconnects, and it is the socket after that one which is
// somebody.
const mine = mutable('');
identity.user.effect((who) => {
	if (typeof who !== 'string') {
		mine.set('');
		return;
	}
	client.ask('board/Mine').then((said) => { mine.set(String(said)); }, () => { mine.set('refused'); });
});

const ABOUT = [
	'A page and a server in one directory. The **board** is a document the server holds, and the',
	'note under it is one the server opens when this page asks for it by name.',
	'',
	'```tip',
	'Type in the search field: the list follows what you type, and an old answer never lands over a new one.',
	'```',
].join('\n');

Theme.define({
	page: {
		// The face this page is set in, served from `public/fonts`. The engine writes it once per
		// render however many elements wear the entry. `face` below is what sets the page in it.
		...fontFaces('IBM Plex Sans', [{ src: '/fonts/IBMPlexSans-Medium.woff2', weight: 500 }]),
		// As tall as the viewport, so a short page is painted to the bottom. The host's body margin
		// is `index.html`'s to take off: a theme entry cannot reach `body`.
		minHeight: '100vh',
		background: '$background',
		color: '$foreground',
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'start',
		gap: '$space4',
		padding: '$space4',
	},
	tip: {
		background: '$muted',
		color: '$mutedForeground',
		borderRadius: '$radius',
		padding: '$space3',
	},
});

// A fenced block marked `tip` is drawn as an aside of its own rather than as code in a `<pre>`.
// Every other block is drawn the way Markdown draws it.
const block = (held: Block): unknown => (held.kind === 'code' && held.language === 'tip'
	? <aside id="tip" theme="tip"><Typography type="p1" label={held.text} /></aside>
	: undefined);

const App = (): unknown => {
	const email = mutable('');
	const password = mutable('');
	const problem = mutable<string | null>(null);
	const query = mutable('');
	// Asks again on every change of the field, keeps the last list while it waits, and drops an
	// answer a newer question has replaced.
	const found = asking<Item[]>(client, 'board/Search', query.map((text) => ({ text })));

	const signIn = async (): Promise<void> => {
		const outcome = await identity.enter(email.get(), password.get());
		problem.set('refused' in outcome ? outcome.refused.map((reason) => reason.message).join(', ') : null);
	};

	return (
		<main id="page" theme="page">
			<h1>The board</h1>
			<Button
				id="mode"
				label={mode.map((now) => (now === dark ? 'Light mode' : 'Dark mode'))}
				onClick={() => { mode.set(mode.get() === dark ? light : dark); }}
			/>
			<Markdown source={ABOUT} block={block} />
			<p id="board-title">{title}</p>
			<p id="notice">{notice}</p>
			<TextField label="Search the board" value={query} />
			<ul id="found" aria-busy={found.map((now) => now.state === 'waiting')}>
				{found.map((now) => (now.data ?? []).map((item) => <li>{item.title}</li>))}
			</ul>
			<TextField label="Pinned note" value={noteText} />
			<p id="who">
				{identity.user.map((who) =>
					(typeof who === 'string' ? `signed in as ${who}` : who === null ? 'nobody' : 'asking'))}
			</p>
			<p id="mine">{mine}</p>
			<TextField label="Email" value={email} />
			<TextField label="Password" value={password} password error={problem} />
			<Button label="Sign in" onClick={signIn} />
		</main>
	);
};

// Every component of ui sets its own font to `$font`, so the page's face goes there, in a provider
// below the mode's, and reaches the fields and buttons as well as the page's own text.
const face = { '*': { $font: '"IBM Plex Sans", system-ui, sans-serif' } };

mount(page.document.body as never, <Theme value={mode}><Theme value={face}><App /></Theme></Theme>);
