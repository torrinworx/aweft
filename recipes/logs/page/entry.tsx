// What the browser runs: a recorded client, the board it shares, a sign-in form, and the two
// buttons that make something worth recording. Nothing here names the backend.

import { createAuth } from '@aweftjs/auth/client';
import { createClient } from '@aweftjs/client';
import { mutable, observer } from '@aweftjs/core';
import { createLog } from '@aweftjs/logs/client';
import { Button, TextField, Theme, h, light, mount } from '@aweftjs/ui';

interface Board { title: string; note?: string; _secret?: string }

const page = globalThis as unknown as {
	document: { body: unknown };
	location: { protocol: string; host: string };
	__log: { visit: string; flush(): Promise<void> };
};

const socket = `${page.location.protocol === 'https:' ? 'wss' : 'ws'}://${page.location.host}/ws`;

// The recorder wraps the client the rest of the page uses. The build is a fixed string here so
// the visit reads back with a build; a real page reads it from its own environment.
const log = createLog(createClient({ url: socket }), { build: 'recipe-1', flushMs: 300 });
const client = log.client;
const identity = createAuth(client);

// So the harness can read this visit back and flush on demand.
page.__log = { visit: log.visit, flush: () => log.flush() };

const title = mutable('waiting for the server');
let board: Board | undefined;
client.share<Board>('board').ready.then((shared) => {
	board = shared;
	observer(shared).path('title').effect((now) => { title.set(String(now)); });
});

Theme.define({
	page: { minHeight: '100vh', background: '$background', color: '$foreground', fontFamily: '$font', display: 'flex', flexDirection: 'column', alignItems: 'start', gap: '$space4', padding: '$space4' },
});

const App = (): unknown => {
	const email = mutable('');
	const password = mutable('');

	const signIn = async (): Promise<void> => { await identity.enter(email.get(), password.get()); };
	// A write the server takes, and a slot the recorder must never carry a value for.
	const write = (): void => { if (board !== undefined) { board.note = 'a public note'; board._secret = 'do not record me'; } };
	// A removal the server refuses, so the page hears a refusal.
	const remove = (): void => { if (board !== undefined) delete board.note; };
	const boom = (): void => { void client.ask('board/Boom').catch(() => undefined); };

	return (
		<main id="page" theme="page">
			<h1>Board</h1>
			<p id="board-title">{title}</p>
			<p id="who">{identity.user.map((who) => (typeof who === 'string' ? `signed in as ${who}` : who === null ? 'nobody' : 'asking'))}</p>
			<TextField label="Email" value={email} />
			<TextField label="Password" value={password} password />
			<Button id="sign-in" label="Sign in" onClick={signIn} />
			<Button id="write" label="Write" onClick={write} />
			<Button id="remove" label="Remove" onClick={remove} />
			<Button id="boom" label="Boom" onClick={boom} />
		</main>
	);
};

mount(page.document.body as never, <Theme value={light}><App /></Theme>);
