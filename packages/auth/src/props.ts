// What every module here reads off the loader's props: the application's store.

import { codecError } from '@aweftjs/codec';
import type { Store } from '@aweftjs/store';

/**
 * The store the loader was made with. Loud when it was not, rather than undefined at the first write.
 *
 * Throws: `no-store` when the loader's props carry no store.
 */
export const storeOf = (props: Readonly<Record<string, unknown>>): Store => {
	const store = props.store as Store | undefined;
	if (store === undefined || typeof store.open !== 'function') {
		throw codecError(
			'no-store', 'the loader needs a store in its props',
			'Pass store to createServer, or props: { store } to a loader you build yourself.',
		);
	}
	return store;
};

export const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** The JSON body of a request, or undefined when there is none worth the name. */
export const bodyOf = async (request: Request): Promise<Record<string, unknown> | undefined> => {
	try {
		const body: unknown = await request.json();
		return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
};
