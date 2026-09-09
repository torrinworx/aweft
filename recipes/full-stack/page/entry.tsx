// What the browser runs: one connection, the document it shares, and a form that signs in.
//
// Nothing here names the backend. The connection is this page's own origin, which is what makes
// the cookie the sign-in sets the cookie the next socket carries. In development that origin is
// the dev server, and `vite.config.ts` is what puts the backend behind it.

import { createAuth } from '@aweftjs/auth/client';
import { createClient } from '@aweftjs/client';
import { mutable, observer } from '@aweftjs/core';
import { Button, TextField, Theme, h, light, mount } from '@aweftjs/ui';

interface Board {
	title: string;
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

const title = mutable('waiting for the server');
client.share<Board>('board').ready.then((board) => {
	observer(board).path('title').effect((now) => { title.set(String(now)); });
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

Theme.define({
	page: {
		// As tall as the viewport, so a short page is painted to the bottom. The host's body margin
		// is `index.html`'s to take off: a theme entry cannot reach `body`.
		minHeight: '100vh',
		background: '$background',
		color: '$foreground',
		fontFamily: '$font',
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'start',
		gap: '$space4',
		padding: '$space4',
	},
});

const App = (): unknown => {
	const email = mutable('');
	const password = mutable('');
	const problem = mutable<string | null>(null);

	const signIn = async (): Promise<void> => {
		const outcome = await identity.enter(email.get(), password.get());
		problem.set('refused' in outcome ? outcome.refused.map((reason) => reason.message).join(', ') : null);
	};

	return (
		<main id="page" theme="page">
			<h1>The board</h1>
			<p id="board-title">{title}</p>
			<p id="notice">{notice}</p>
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

mount(page.document.body as never, <Theme value={light}><App /></Theme>);
