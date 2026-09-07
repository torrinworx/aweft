// The resolver for a name known only when the page runs (design 143).
//
// A real HTTP server, not a stubbed `fetch`: the URL it builds and the answer it reads are the
// contract with a service nobody here runs, so the test has to see the request that went out.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';

import type { IconData } from '@aweftjs/ui';
import { Icon, Icons, context, h, render } from '@aweftjs/ui';

import { type IconSet, fromUrl } from '@aweftjs/icons';

// Drawn for this test out of two straight lines and a close. No set publishes it, and this package
// ships no drawings, so a real icon's path data has no business being here.
const WEDGE = '<path d="M6 3 18 12 6 21z"/>';

const SET: IconSet = {
	prefix: 'lucide',
	icons: {
		check: { body: WEDGE },
		big: { body: '<rect/>', width: 48, height: 48 },
	},
	aliases: { done: { parent: 'check', hFlip: true } },
	width: 24,
	height: 24,
};

/** A service in the shape the icon APIs answer in, and the requests it was asked for. */
const service = async (
	answer: (set: string, wanted: string) => { status: number; body: string },
): Promise<{ base: string; asked: string[]; close(): Promise<void> }> => {
	const asked: string[] = [];
	const server: Server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		asked.push(`${url.pathname}?${url.searchParams.toString()}`);
		const set = url.pathname.replace(/^\//, '').replace(/\.json$/, '');
		const said = answer(set, url.searchParams.get('icons') ?? '');
		response.writeHead(said.status, { 'content-type': 'application/json' });
		response.end(said.body);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as { port: number }).port;
	return {
		base: `http://127.0.0.1:${port}`,
		asked,
		close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
	};
};

const answering = (set: string, wanted: string): { status: number; body: string } => {
	if (set !== 'lucide') return { status: 404, body: '' };
	const found = SET.icons?.[wanted];
	const alias = SET.aliases?.[wanted];
	return {
		status: 200,
		body: JSON.stringify({
			prefix: 'lucide',
			icons: {
				...(found === undefined ? {} : { [wanted]: found }),
				...(alias === undefined ? {} : { [alias.parent]: SET.icons?.[alias.parent] }),
			},
			...(alias === undefined ? {} : { aliases: { [wanted]: alias } }),
			width: SET.width,
			height: SET.height,
			...(found === undefined && alias === undefined ? { not_found: [wanted] } : {}),
		}),
	};
};

test('a prefixed name is fetched as the API spells it, and the root size is applied', async () => {
	const api = await service(answering);
	try {
		const resolve = fromUrl(api.base);
		const icon = await resolve('lucide:check') as IconData;
		assert.deepEqual(api.asked, ['/lucide.json?icons=check'], 'one request, in the API\'s URL shape');
		assert.match(icon.body, /^<path /);
		assert.equal(icon.width, 24, 'the answer\'s root size is the icon\'s box');
		assert.equal(icon.height, 24);
	} finally {
		await api.close();
	}
});

test('an icon with its own box keeps it, and an alias is followed once', async () => {
	const api = await service(answering);
	try {
		const resolve = fromUrl(api.base);
		assert.equal((await resolve('lucide:big') as IconData).width, 48);

		const alias = await resolve('lucide:done') as IconData;
		assert.equal(alias.hFlip, true, 'the alias\'s own flip is on top');
		assert.match(alias.body, /^<path /, 'over its parent\'s drawing');
		assert.equal(alias.width, 24);
	} finally {
		await api.close();
	}
});

test('a name with no set in it is not fetched at all', async () => {
	const api = await service(answering);
	try {
		assert.equal(await fromUrl(api.base)('check'), null, 'there is nowhere to send it');
		assert.equal(await fromUrl(api.base)('lucide:'), null);
		assert.equal(await fromUrl(api.base)(':check'), null);
		assert.deepEqual(api.asked, [], 'and nothing went out');
	} finally {
		await api.close();
	}
});

test('a set the service does not have, and a name it does not have, answer null', async () => {
	const api = await service(answering);
	try {
		const resolve = fromUrl(api.base);
		assert.equal(await resolve('nosuchset:check'), null, 'a non-200 is a lookup that failed');
		assert.equal(await resolve('lucide:no-such-icon'), null, 'and so is an answer without the icon');
		assert.equal(api.asked.length, 2, 'both were asked for');
	} finally {
		await api.close();
	}
});

test('an answer that is not the shape the API promises answers null', async () => {
	const api = await service(() => ({ status: 200, body: JSON.stringify({ prefix: 'lucide' }) }));
	try {
		assert.equal(await fromUrl(api.base)('lucide:check'), null);
	} finally {
		await api.close();
	}
});

test('a 200 that is not the JSON promised answers null rather than throwing', async () => {
	// A proxy, a captive portal and a truncated answer all arrive as a 200 with a body that does
	// not parse. The stack was asking this source, so a failed parse is a failed lookup.
	const html = await service(() => ({ status: 200, body: '<!doctype html><title>signed out</title>' }));
	try {
		assert.equal(await fromUrl(html.base)('lucide:check'), null, 'HTML under a 200 is not an answer');
	} finally {
		await html.close();
	}

	const empty = await service(() => ({ status: 200, body: '' }));
	try {
		assert.equal(await fromUrl(empty.base)('lucide:check'), null, 'and neither is nothing at all');
	} finally {
		await empty.close();
	}
});

test('a resolver in front that answers nothing hands the name to the pack behind it', async () => {
	const api = await service(() => ({ status: 200, body: '<!doctype html><title>signed out</title>' }));
	try {
		const pack = { prefix: 'lucide', icons: { check: { body: WEDGE } }, width: 24, height: 24 };
		const markup = await render(
			h(Icons as never, { value: [fromUrl(api.base), pack] },
				h(Icon as never, { name: 'lucide:check' })),
			{ context: context() },
		);
		assert.match(markup, /M6 3 18 12 6 21z/, 'the pack answered after the resolver did not');
		assert.match(markup, /viewBox="0 0 24 24"/, 'with the pack\'s own box on it');
	} finally {
		await api.close();
	}
});

test('a request that cannot reach the far end is left to reject', async () => {
	// `Icon` reports this one, naming the icon and the reason (design 131). Answering null here
	// would tell the stack the set does not have the icon, which is a different thing.
	await assert.rejects(fromUrl('http://127.0.0.1:1')('lucide:check'));
});
