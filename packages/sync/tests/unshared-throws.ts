// Run by unshared.test.ts in a child process: `unshared` throws. The frame that carried the open
// is delivered without a throw, the error is raised as the application's own on a fresh task, and
// the open is still held, so a share made later pairs. Prints what happened as one JSON line.

import { createObject } from '@aweftjs/core';
import { connect } from '@aweftjs/sync';
import type { Channel, Frame } from '@aweftjs/sync';
import { settle } from '@aweftjs/testing';

const raised: string[] = [];
process.on('uncaughtException', (error: Error) => { raised.push(error.message); });

// A channel of the test's own, so the delivery of one frame is a call this program makes.
let deliver: (frame: Frame) => void = () => {};
const sent: Frame[] = [];
const channel: Channel = {
	send: (frame) => { sent.push(frame); },
	receive: (fn) => { deliver = fn; return () => {}; },
	closed: () => () => {},
	close: () => {},
};
const link = connect(channel, { unshared: () => { throw new Error('the hook broke'); } });

let synchronous = false;
try {
	deliver({ kind: 'open', topic: 1, name: 'board', root: null, want: true });
} catch {
	synchronous = true;
}
await settle();
link.share('board', createObject({ title: 'kept' }));
await settle();

console.log(JSON.stringify({ synchronous, raised, paired: sent.some((frame) => frame.kind === 'state' && frame.topic === 1) }));
link.close();
