// An application assembled from three places, then extended while it runs by an operator who
// writes modules into a document that a second node receives over a link.
//
// The job: a greeting service. Its own modules are files under ./app. A library it uses arrives
// as a bundle map. Its operator adds plugins by writing source into a document; a second node
// mirrors that document and runs the same plugins, and when the operator edits one, the second
// node reloads it together with everything that depends on it. Nothing in the module system
// knows there is a link, a document store, or an operator.
//
// Run: node recipes/modules/main.ts

import { fileURLToPath } from 'node:url';

import { createObject } from '@aweftjs/core';
import { compile, createLoader, follow, fromBundle, fromDocument } from '@aweftjs/modules';
import type { ModuleExports, ModuleProps } from '@aweftjs/modules';
import { fromDirectory } from '@aweftjs/modules/node';
import { mirror } from '@aweftjs/sync';

const check = (ok: boolean, what: string): void => {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
	if (!ok) process.exitCode = 1;
};

/** Wait for something another node's work will bring about, or fail saying what did not come. */
const until = async (what: string, ok: () => boolean): Promise<void> => {
	for (let i = 0; i < 400; i++) {
		if (ok()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	check(false, `timed out waiting for ${what}`);
};

type Announcer = { announce(name: string): string };
type Entry = { source: string; author?: string };

const app = fileURLToPath(new URL('./app/', import.meta.url));

// --- the library, in the shape a bundler hands over ------------------------------------------

const library = fromBundle({
	'./lib/Log.ts': {
		defaults: { prefix: '[lib]' },
		default: ({ config }: ModuleProps) => {
			const lines: string[] = [];
			return { lines, log: (line: string): void => { lines.push(`${String(config.prefix)} ${line}`); } };
		},
	} satisfies ModuleExports,
	// The library's own greeting format. The application ships one too, and the application's
	// source comes first, so the application's wins.
	'./greet/Format.ts': {
		defaults: { punctuation: '!' },
		default: ({ config }: ModuleProps) => ({ format: (text: string): string => `${text}${String(config.punctuation)}` }),
	} satisfies ModuleExports,
}, { prefix: './' });

// --- the operator's plugins, written as text into a document ----------------------------------

const shout = (suffix: string): string => `
export const deps = ['greet/Say', 'lib/Log'];
export default ({ imports, trace }) => ({
	shout: (name) => {
		const line = imports.Say.say(name).toUpperCase() + '${suffix}';
		imports.Log.log(line);
		return line;
	},
	stop: () => trace.push('stop Shout'),
});`;

const announce = `
export const deps = ['plugin/Shout'];
export default ({ imports, trace }) => ({
	announce: (name) => 'announcing: ' + imports.Shout.shout(name),
	stop: () => trace.push('stop Announce'),
});`;

const plugins = createObject<Record<string, unknown>>({
	'plugin/Shout': createObject<Entry>({ source: shout('!'), author: 'the operator' }),
	'plugin/Announce': createObject<Entry>({ source: announce }),
});

// --- node one: the application itself ----------------------------------------------------------

console.log('node one: the application');
const trace: string[] = [];
// `props` is the seam for what the platform hands every factory, and this recipe is the
// platform. An application on `createServer` has no `props` at all: the server hands in `store`
// and nothing else, and anything else shared is a module others name in `deps` (design 240).
const near = createLoader({ sources: [fromDirectory(app), library, fromDocument(plugins)], props: { trace } });

const announcer = (await near.load(['plugin/Announce']))['plugin/Announce'] as Announcer;
check(
	near.loaded().join(',') === 'greet/Format,greet/Say,lib/Log,plugin/Shout,plugin/Announce',
	'modules from a directory, a bundle and a document load in one dependency order',
);
check(announcer.announce('ada') === 'announcing: HELLO ADA.!', 'and each one was handed the instances it depends on');
check(
	(near.get('lib/Log') as { lines: string[] }).lines[0] === '[app] HELLO ADA.!',
	'the application configured the library module with a same-named file that exports only config',
);
check(
	(near.get('greet/Format') as { format(t: string): string }).format('x') === 'x.',
	'the application\'s own implementation won over the library\'s of the same name',
);

const tick = (await near.load(['clock/Tick']))['clock/Tick'] as { ticks(): number; stopped: boolean };
await new Promise((resolve) => setTimeout(resolve, 20));
check(tick.ticks() > 0, 'a module holding a timer is running');
check(await near.unload('clock/Tick') && tick.stopped && near.get('clock/Tick') === undefined,
	'unload called its stop and dropped it, and touched nothing else');
check(near.loaded().length === 5, 'the rest is still loaded');

// --- node two: the same plugins, received over a link ------------------------------------------

console.log('node two: a second node over a link');
const shared = mirror(plugins);
const farDoc = shared.document as Record<string, unknown>;
await until('the plugins to arrive', () => Object.keys(farDoc).length === 2);

const far = createLoader({ sources: [fromDirectory(app), library, fromDocument(farDoc)], props: { trace } });
const farAnnouncer = (await far.load(['plugin/Announce']))['plugin/Announce'] as Announcer;
check(farAnnouncer.announce('bob') === 'announcing: HELLO BOB.!', 'a module document shared over a link loads on the far end');

// --- the operator edits a plugin, and the far end follows --------------------------------------

console.log('the operator edits a plugin');
const applied: string[] = [];
let caughtUp: () => void = () => {};
const stopFollow = follow(far, farDoc, {
	applied: (name, action) => { applied.push(`${name} ${action}`); caughtUp(); },
	failed: (name, error) => check(false, `reload of ${name} failed: ${String(error)}`),
});
trace.length = 0;
const reloaded = new Promise<void>((resolve) => { caughtUp = resolve; });
(plugins['plugin/Shout'] as Entry).source = shout('!!!');
await reloaded;

check(far.get('plugin/Announce') !== farAnnouncer, 'the far end followed the edit without anyone reloading by hand');
check((far.get('plugin/Announce') as Announcer).announce('bob') === 'announcing: HELLO BOB.!!!',
	'the far end runs the edited plugin, and the plugin that depends on it was rebuilt against it');
check(trace.join(',') === 'stop Announce,stop Shout', 'the dependent was stopped before the module it depends on');
check(applied.join(',') === 'plugin/Shout reloaded', 'and applied said so once, naming the module that changed');
check(near.get('plugin/Announce') === announcer, 'the near end, which follows nothing, kept what it had');

const unloaded = new Promise<void>((resolve) => { caughtUp = resolve; });
delete plugins['plugin/Announce'];
await unloaded;
check(far.get('plugin/Announce') === undefined && applied.at(-1) === 'plugin/Announce unloaded',
	'removing a plugin from the document unloaded it on the far end');
check(far.get('plugin/Shout') !== undefined, 'and took nothing else with it');

// --- what an application does before it stores a plugin -----------------------------------------

let refused = false;
try { await compile('export default ({'); } catch { refused = true; }
check(refused, 'compile refuses a broken source, so an application can check one before it stores it');

stopFollow();
shared.stop();
for (const name of [...far.loaded()].reverse()) await far.unload(name);
for (const name of [...near.loaded()].reverse()) await near.unload(name);

console.log(process.exitCode ? 'FAILED' : 'all of it holds');
