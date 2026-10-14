export { createClient } from './client.ts';
export type { Client, ClientOptions, ClientStatus, Handle } from './client.ts';
export { asking } from './asking.ts';
export type { Asked, AskingOptions } from './asking.ts';

// The types a caller of the functions above has to be able to name, so a page types its own
// code without reaching below this package.
export type { AskOptions, ShareHandlers, SocketLike } from '@aweftjs/sync';
export type { Cell, Derived } from '@aweftjs/core';
