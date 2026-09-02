// The other side of a link, in a worker thread.
//
// It is handed a port and a document id, builds a replica, and works the board from there.
// Nothing in it knows it is in a worker: it is `connect` over the port adapter, the same as
// a browser tab over a socket.

import { parentPort, workerData } from 'node:worker_threads';

import { bytesFromHex, type ObservableKind } from '@aweftjs/codec';
import { createObject, textIdOf } from '@aweftjs/core';
import { connect, fromMessagePort, rootFrom } from '@aweftjs/sync';

const { root, kind, port } = workerData as {
	root: string; kind: ObservableKind; port: { postMessage(v: unknown): void };
};
const home = parentPort!;

const board = rootFrom(bytesFromHex(root), kind) as Record<string, unknown>;
const session = connect(
	() => fromMessagePort(port as unknown as Parameters<typeof fromMessagePort>[0]),
	{ retry: () => false },
);

const replica = session.join('board', {
	document: board,
	refused: (group) => home.postMessage({ refused: group.length }),
});
await replica.ready;

// Do the work: add a task, then say which id it went in under so the other side can look.
const task = createObject({ title: 'written in a worker', done: false });
(board.tasks as { add(o: object): void }).add(task);
replica.flush();

home.postMessage({ added: textIdOf(task) });
