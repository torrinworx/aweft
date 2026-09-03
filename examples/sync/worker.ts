// The other end of a link, in a worker thread.
//
// It is handed a port and nothing else. Nothing in it knows it is in a worker: it is
// `connect` over the port adapter, the same two lines the other end runs.

import { parentPort, workerData } from 'node:worker_threads';

import { createObject, textIdOf } from '@aweftjs/core';
import { connect, fromMessagePort } from '@aweftjs/sync';

const { port } = workerData as { port: { postMessage(value: unknown): void } };
const home = parentPort!;

const link = connect(fromMessagePort(port as unknown as Parameters<typeof fromMessagePort>[0]));
const shared = link.share<Record<string, unknown>>('board');
const board = await shared.ready;

// Do the work: add a task, then say which id it went in under so the other end can look.
const task = createObject({ title: 'written in a worker', done: false });
(board.tasks as { add(o: object): void }).add(task);
home.postMessage({ added: textIdOf(task) });
