// What the browser runs: sign-in, then the user's inbox live, an unread badge, a button that
// asks the application's own module to send, one that marks everything read, and one that
// registers this browser as a device. Nothing here names the backend.

import { createAuth } from '@aweftjs/auth/client';
import { createClient } from '@aweftjs/client';
import { mutable, observer } from '@aweftjs/core';
import { createInbox } from '@aweftjs/notify/client';
import type { InboxView, Item } from '@aweftjs/notify/client';
import { Button, TextField, Theme, h, light, mount } from '@aweftjs/ui';

const page = globalThis as unknown as {
	document: { body: unknown };
	location: { protocol: string; host: string };
	__probe(): Promise<string>;
	__inbox(): InboxView | undefined;
	__forge(): void;
};

const socket = `${page.location.protocol === 'https:' ? 'wss' : 'ws'}://${page.location.host}/ws`;
const client = createClient({ url: socket });
const identity = createAuth(client);

// The view is made once the connection is somebody's: on an anonymous one its `ready` refuses,
// which is what the harness's probe reads before signing in.
let inbox: InboxView | undefined;
const items = mutable<readonly Item[]>([]);
const unread = mutable(0);
const opened = (): void => {
	if (inbox !== undefined) return;
	inbox = createInbox(client);
	inbox.unread.effect((n) => { unread.set(n); });
	void inbox.ready.then((list) => { items.set(list); }, () => undefined);
};
identity.user.effect((who) => { if (typeof who === 'string') opened(); });

page.__probe = () => createInbox(client).ready.then(() => 'ready', (error: { reason?: string }) => String(error.reason));
page.__inbox = () => inbox;
page.__forge = () => {
	const list = inbox?.items as { title: string }[] | undefined;
	if (list?.[0] !== undefined) list[0].title = 'forged by the page';
};

Theme.define({
	page: { minHeight: '100vh', background: '$background', color: '$foreground', fontFamily: '$font', display: 'flex', flexDirection: 'column', alignItems: 'start', gap: '$space4', padding: '$space4' },
	item: { display: 'flex', gap: '$space2' },
	item_read: { opacity: 0.5 },
});

// One shape per row: the read state is a theme segment that changes, never a tag that appears.
const Row = (props: { each?: unknown }): unknown => {
	const item = props.each as Item;
	const read = observer(item).path('readAt').map((at) => at !== null);
	return (
		<li theme={read.map((seen) => (seen ? ['item', 'read'] : ['item']))} class="item">
			<span class="title">{item.title}</span>
			<span class="state">{read.map((seen) => (seen ? 'read' : 'new'))}</span>
		</li>
	);
};

const App = (): unknown => {
	const email = mutable('');
	const password = mutable('');
	const signIn = async (): Promise<void> => { await identity.enter(email.get(), password.get()); };
	const ship = (level: 'info' | 'error', isPrivate?: boolean) => (): void => {
		void client.ask('orders/Ship', { level, private: isPrivate }).catch(() => undefined);
	};
	const readAll = (): void => { void inbox?.read(); };
	const register = (): void => {
		void inbox?.register({ device: 'this-browser', platform: 'web', transport: 'fcm', endpoint: 'browser-token' });
	};

	return (
		<main id="page" theme="page">
			<h1>Inbox</h1>
			<p id="who">{identity.user.map((who) => (typeof who === 'string' ? `signed in as ${who}` : who === null ? 'nobody' : 'asking'))}</p>
			<p id="unread">{unread.map((n) => `${String(n)} unread`)}</p>
			<TextField label="Email" value={email} />
			<TextField label="Password" value={password} password />
			<Button id="sign-in" label="Sign in" onClick={signIn} />
			<Button id="ship" label="Ship" onClick={ship('info')} />
			<Button id="ship-loud" label="Ship loud" onClick={ship('error')} />
			<Button id="ship-open" label="Ship loud, in the open" onClick={ship('error', false)} />
			<Button id="read-all" label="Mark all read" onClick={readAll} />
			<Button id="register" label="Register this browser" onClick={register} />
			<ul id="items">{items.map((list) => <Row each={list} />)}</ul>
		</main>
	);
};

mount(page.document.body as never, <Theme value={light}><App /></Theme>);
