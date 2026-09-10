// Run by the corpus in a child process: a watcher on the receiving document throws while a
// commit lands. The commit is in, the rest of the frame applies, and the error is raised as
// the application's own, once, after the frame. Prints what happened as one JSON line.

import { createObject, idOf, observer } from '@aweftjs/core';
import { connect, inProcess } from '@aweftjs/sync';
import { settle as settleRounds } from '@aweftjs/testing';

/** Twenty rounds, which is what this program waited for before the harness shipped a default. */
const settle = (): Promise<void> => settleRounds(20);

type Doc = Record<string, unknown>;
const raised: string[] = [];
process.on('uncaughtException', (error: Error) => { raised.push(error.message); });


const [a, b] = inProcess();
const source = createObject<Doc>({ n: 0 });
const copy = createObject<Doc>(undefined, idOf(source));
const left = connect(a);
const right = connect(b);
left.share('doc', source);
right.share('doc', copy);
await settle();
observer(copy).path('boom').watch(() => { throw new Error('a watcher broke'); });

source.first = 1;
source.boom = 2;
source.last = 3;
await settle();

console.log(JSON.stringify({ first: copy.first, boom: copy.boom, last: copy.last, raised }));
left.close();
right.close();
