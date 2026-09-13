// What the browser runs: a sign-in form, a drop zone, and the upload of every picture it takes.
// Each entry goes `loading` while its bytes leave and `ready` when the record is back, the
// picture paints from `/files/<id>`, and a refusal shows its reason. Nothing here names the
// backend.

/// <reference path="../../../node_modules/@aweftjs/icons/src/virtual.d.ts" />

import { createAuth } from '@aweftjs/auth/client';
import { createClient } from '@aweftjs/client';
import { mutable, mutableArray } from '@aweftjs/core';
import standard from '@aweftjs/icons/lucide/+standard';
import { Button, FileDrop, Icons, TextField, Theme, h, light, mount } from '@aweftjs/ui';
import type { FileDropEntry } from '@aweftjs/ui';
import { createUploads } from '@aweftjs/uploads/client';
import type { UploadRecord } from '@aweftjs/uploads';

const page = globalThis as unknown as {
	document: { body: unknown };
	location: { protocol: string; host: string };
	__uploaded: UploadRecord[];
};

const socket = `${page.location.protocol === 'https:' ? 'wss' : 'ws'}://${page.location.host}/ws`;
const client = createClient({ url: socket });
const identity = createAuth(client);
const uploads = createUploads();

// So the harness can read what came back.
page.__uploaded = [];

Theme.define({
	page: { minHeight: '100vh', background: '$background', color: '$foreground', fontFamily: '$font', display: 'flex', flexDirection: 'column', alignItems: 'start', gap: '$space4', padding: '$space4' },
});

const App = (): unknown => {
	const email = mutable('');
	const password = mutable('');
	const files = mutableArray<FileDropEntry>();
	const progress = mutable('');
	const shown = mutable('');
	const refused = mutable('');
	const exported = mutable('');

	const signIn = async (): Promise<void> => { await identity.enter(email.get(), password.get()); };

	// One file at a time: the entry goes `loading` while it uploads and back to `ready` or to
	// `error` with the route's reason, which is the edit the listing follows.
	const send = async (dropped: unknown[]): Promise<void> => {
		for (const file of dropped as File[]) {
			const at = files.findIndex((entry) => entry.file === file);
			if (at < 0) continue;
			files[at] = { ...files[at]!, status: 'loading' };
			try {
				const record = await uploads.upload(file, { progress: (fraction) => { progress.set(`${file.name} ${String(Math.round(fraction * 100))}%`); } });
				page.__uploaded.push(record);
				files[at] = { ...files[at]!, status: 'ready' };
				if (record.type.startsWith('image/')) shown.set(record.url);
			} catch (error) {
				const { status, reasons } = error as { status?: number; reasons?: { code: string; message: string }[] };
				const why = reasons?.[0]?.message ?? 'the upload failed';
				refused.set(`${file.name}: ${String(status ?? '')} ${why}`);
				files[at] = { ...files[at]!, status: 'error', error: why };
			}
		}
	};

	const exportCsv = async (): Promise<void> => {
		const record = await client.ask('gallery/Export', { ids: page.__uploaded.map((r) => r.id) }) as UploadRecord;
		exported.set(record.url);
	};

	return (
		<main id="page" theme="page">
			<h1>Pictures</h1>
			<p id="who">{identity.user.map((who) => (typeof who === 'string' ? `signed in as ${who}` : who === null ? 'nobody' : 'asking'))}</p>
			<TextField label="Email" value={email} />
			<TextField label="Password" value={password} password />
			<Button id="sign-in" label="Sign in" onClick={signIn} />
			<FileDrop files={files} extensions={['image/png', 'image/jpeg', '.csv', '.html']} onDrop={send} />
			<p id="progress">{progress}</p>
			<p id="refused">{refused}</p>
			<img id="picture" src={shown} alt="" />
			<Button id="export" label="Export" onClick={exportCsv} />
			<p id="exported">{exported}</p>
		</main>
	);
};

mount(page.document.body as never, <Theme value={light}><Icons value={standard}><App /></Icons></Theme>);
