export { createStore } from './store.ts';
export type { Handle, Held } from './store.ts';

export { memoryDriver } from './memory.ts';

export type { Driver, Entry, Found, Lookup, Patch, Row, Write } from './driver.ts';

export { compare, holds } from './query.ts';
export type { Declaration, Indexable, Query, Where } from './query.ts';

// The commit type a caller hands to `receive` and gets back from `since`, re-exported the way
// core re-exports the codec types its own signatures hand out.
export type { Commit } from '@aweftjs/codec';
