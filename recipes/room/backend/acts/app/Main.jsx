// app/Main: the act the room shows. Written as an agent or a user would write it, against the
// same `client` a page module gets: `share` for the board, `ask` for the granted call. Two
// screens on a stage of its own, so the room's tail is a real URL on the page.
//
// This file is not part of the recipe's program: `app/Rooms` reads it, turns the JSX into `h`
// calls, and puts the result in the module document the room loads it from.

import { mutable, observer } from '@aweftjs/core';
import { Button, Stage, StageContext, h } from '@aweftjs/ui';

export default ({ client }) => {
	const board = client.share('board');
	const asked = mutable('nobody yet');
	const refusal = mutable('');
	const fetched = mutable('');

	const First = () => {
		const title = mutable('waiting for the board');
		board.ready.then((doc) => { observer(doc).path('title').effect((now) => { title.set(String(now)); }); });
		return (
			<main id="first">
				<h1 id="board-title">{title}</h1>
				<p id="asked">{asked}</p>
				<p id="refusal">{refusal}</p>
				<p id="fetched">{fetched}</p>
				<Button id="write" label="Write" onClick={() => { board.document.note = 'written in the room'; }} />
				<Button id="ask" label="Ask" onClick={async () => { const said = await client.ask('app/Rooms'); asked.set(`${said.user} wrote ${said.note}`); }} />
				<Button id="ask-secret" label="Ask secret" onClick={() => { client.ask('app/Secret').catch((e) => { refusal.set(e.reason); }); }} />
				<Button id="fetch" label="Fetch" onClick={() => { fetch('/api/logs').then(() => fetched.set('allowed'), (e) => fetched.set(e.name)); }} />
				<Button id="boom" label="Boom" onClick={() => { throw new Error('the act blew up'); }} />
				<Button id="warn" label="Warn" onClick={() => { console.warn('a warning from the room'); console.log('a quiet line'); }} />
				<p id="styled" style="padding-left: 7px">styled</p>
				<img id="picture" src="http://other.test/pixel.png" alt="" />
				<a id="go-second" href="/second">second</a>
			</main>
		);
	};

	const Second = () => (
		<main id="second">
			<h1>the second screen</h1>
			<a id="go-first" href="/">first</a>
		</main>
	);

	return {
		title: 'the app',
		component: () => (
			<StageContext acts={{ '': First, second: Second }}>
				<Stage />
			</StageContext>
		),
	};
};
