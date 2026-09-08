export { createStore } from './store.ts';
export type { Handle, Held, Store } from './store.ts';

export { memoryDriver } from './memory.ts';

export type { Driver, Entry, Found, Lookup, Patch, Row, Write } from './driver.ts';

export { projectionOf } from './projection.ts';

export { compare, holds } from './query.ts';
export type { Declaration, Indexable, Query, Where } from './query.ts';

// A commit crosses this boundary in both directions, so the pair that turns one into bytes and
// back rides along with the type. Without them a caller holding a commit from the wire has no
// way to hand it to `receive`, which the README's own example does.
export { decodeCommit, encodeCommit } from '@aweftjs/codec';
export type { Commit } from '@aweftjs/codec';
