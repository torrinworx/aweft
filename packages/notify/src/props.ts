// What the server modules here read off the loader's props and off a context.

import { codecError } from '@aweftjs/codec';
import type { Store } from '@aweftjs/store';

/**
 * The store the loader was made with, or undefined when there is none. A server with no store
 * still sends email, so the modules here load without one and say so at the first write.
 */
export const storeOf = (props: Readonly<Record<string, unknown>>): Store | undefined => {
	const store = props.store as Store | undefined;
	return store !== undefined && typeof store.open === 'function' ? store : undefined;
};

export const noStore = (what: string): Error =>
	codecError('no-store', `${what} needs a store and the server has none`, 'Pass store to createServer, or send with channels that need none.');

/** The user on a context, when the gate put one there. */
export const userOf = (context: unknown): string | null => {
	const user: unknown = (context as { user?: unknown } | null)?.user;
	return typeof user === 'string' ? user : null;
};

export const anonymous = (what: string): Error =>
	codecError('anonymous', `${what} needs a signed-in user and this connection has none`, 'Sign in first; an anonymous connection has no inbox and no devices.');

/** A value from a config or a call, refused when it is not one of the words allowed. */
export const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
	typeof value === 'string' && (allowed as readonly string[]).includes(value);
