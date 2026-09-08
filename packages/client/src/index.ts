export { createClient } from './client.ts';
export type { Client, ClientOptions, ClientStatus, Handle } from './client.ts';

// The types a caller of the four functions above has to be able to name, so a page types its
// own code without reaching below this package.
export type { AskOptions, ShareHandlers, SocketLike } from '@aweftjs/sync';
export type { Derived } from '@aweftjs/core';
