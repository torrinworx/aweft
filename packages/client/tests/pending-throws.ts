// Run by asking.test.ts in a child process: the `pending` an asking cell is handed throws. The
// watch attaches anyway, the error is raised as the caller's own on a fresh task, and the cell
// goes on following its arguments. Prints what happened as one JSON line.

import { mutable } from '@aweftjs/core';

import { asking, createClient } from '../src/index.ts';

import { dialer, instance, serverOf, settle } from './helpers.ts';

const raised: string[] = [];
process.on('uncaughtException', (error: Error) => { raised.push(error.message); });

const { server, handlers } = await serverOf({ 'app/Echo': instance(() => ({ call: (args: unknown) => args })) });
const client = createClient({ url: 'ws://app.test/', open: dialer(handlers).open });
const query = mutable('a');
const found = asking<string>(client, 'app/Echo', query, { pending: () => { throw new Error('pending blew up'); } });

let threw = false;
const seen: unknown[] = [];
try {
	found.effect((now) => { seen.push(now.data); });
} catch {
	threw = true;
}
await settle(20);
query.set('b');
await settle(20);

console.log(JSON.stringify({ threw, raised, last: found.get() }));
client.close();
await server.stop();
