// What the browser runs: a recorded client, the module document and the board it shares with
// the server, a sign-in form, and a host act that runs the act module in a room. Nothing here
// names the backend.

import { createAuth } from '@aweftjs/auth/client';
import { createClient } from '@aweftjs/client';
import { createArray, mutable } from '@aweftjs/core';
import { createRouter } from '@aweftjs/dom/router';
import { createLog } from '@aweftjs/logs/client';
import { type Report, Room } from '@aweftjs/sandbox/page';
import { Button, Stage, StageContext, TextField, Theme, h, light, mount } from '@aweftjs/ui';

interface Board { title: string; note?: string }

const page = globalThis as unknown as {
	document: { body: unknown };
	location: { protocol: string; host: string };
	__room: { errors: Report[]; lines: [string, string][]; visit: string; flush(): Promise<void> };
};

const socket = `${page.location.protocol === 'https:' ? 'wss' : 'ws'}://${page.location.host}/ws`;

const log = createLog(createClient({ url: socket }), { build: 'recipe-room', flushMs: 300 });
const client = log.client;
const identity = createAuth(client);

// The module document and the board arrive from the server; the same objects go into the room.
const modules = client.share<Record<string, unknown>>('modules');
const board = client.share<Board>('board');
const grants = createArray<string>(['app/Rooms']);

const errors: Report[] = [];
const lines: [string, string][] = [];
page.__room = { errors, lines, visit: log.visit, flush: () => log.flush() };

Theme.define({
	page: { minHeight: '100vh', background: '$background', color: '$foreground', fontFamily: '$font', display: 'flex', flexDirection: 'column', alignItems: 'start', gap: '$space4', padding: '$space4' },
	room_app: { height: '$appHeight' },
	'*': { $appHeight: '360px' },
});

const Home = (): unknown => {
	const email = mutable('');
	const password = mutable('');
	const signIn = async (): Promise<void> => { await identity.enter(email.get(), password.get()); };
	return (
		<main id="home">
			<p id="who">{identity.user.map((who) => (typeof who === 'string' ? `signed in as ${who}` : who === null ? 'nobody' : 'asking'))}</p>
			<TextField label="Email" value={email} />
			<TextField label="Password" value={password} password />
			<Button id="sign-in" label="Sign in" onClick={signIn} />
			<a id="open-app" href="/app/7">open the app</a>
		</main>
	);
};

/** The host act: one room, on the documents the page already holds, answered by the page's client. */
const App = (): unknown => (
	<div id="app">
		<a id="leave" href="/">leave</a>
		<Room
			inside="/room/room.js"
			importMap={{ '@aweftjs/ui': '/room/ui.js', '@aweftjs/core': '/room/core.js' }}
			modules={modules.document!}
			grants={grants}
			documents={{ board: board.document! }}
			client={client}
			act="app/Main"
			allow={{ images: [] }}
			theme="app"
			focus
			handlers={{
				error: (entry) => { errors.push(entry); log.write({ kind: entry.kind, message: entry.message, stack: entry.stack, module: entry.module ?? null }); },
				console: (level, text) => { lines.push([level, text]); },
			}}
		/>
	</div>
);

const router = createRouter();
// The page mounts once both documents are here: the room shares them, and a share needs the object.
Promise.all([modules.ready, board.ready]).then(() => {
	mount(page.document.body as never, (
		<Theme value={light}>
			<div theme="page">
				<StageContext router={router} acts={{ '': Home, 'app/:id': App }}>
					<Stage />
				</StageContext>
			</div>
		</Theme>
	));
	router.links(page.document.body as never);
});
