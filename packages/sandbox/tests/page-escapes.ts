// Run by page.test.ts in a child process: a Room whose sandbox cannot be made raises the
// refusal as the page's own, from a microtask, and a page with a location resolves `inside`
// against it. Prints what happened as one JSON line.

import { createArray, createObject } from '@aweftjs/core';
import { type LightElement, createDocument } from '@aweftjs/dom';
import { Room } from '@aweftjs/sandbox/page';
import { h, mount } from '@aweftjs/ui';

const raised: string[] = [];
process.on('uncaughtException', (error: Error & { reason?: string }) => { raised.push(String(error.reason)); });

(globalThis as { location?: unknown }).location = { href: 'http://page.test/app/3' };

const doc = createDocument();
const frames: LightElement[] = [];
const original = doc.createElement.bind(doc);
doc.createElement = (tag: string): LightElement => {
	const made = original(tag);
	if (tag === 'iframe') frames.push(made);
	return made;
};

const modules = createObject<Record<string, unknown>>({});
// A document under a reserved name: the sandbox is refused before the frame is made.
const refused = mount(doc.body as never, h(Room, {
	inside: '/room/room.js', modules, grants: createArray<string>([]), act: 'app/Main', label: 'The app',
	documents: { calls: createObject() },
}));
await new Promise((done) => setTimeout(done, 50));
refused();
// A sound one, whose frame never loads here: `inside` was resolved against the page.
const sound = mount(doc.body as never, h(Room, { inside: '/room/room.js', modules, grants: createArray<string>([]), act: 'app/Main', label: 'The app' }));
await new Promise((done) => setTimeout(done, 50));
const policy = /content="([^"]*)"/.exec(frames[0]?.getAttribute('srcdoc') ?? '')?.[1] ?? '';
sound();
await new Promise((done) => setTimeout(done, 50));

console.log(JSON.stringify({ raised, policy, frames: frames.length }));
