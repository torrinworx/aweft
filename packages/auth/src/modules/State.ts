// auth/State: the user's own state document, shared on every connection of theirs. Private,
// so the gate never lets an anonymous connection this far (design 074).

import type { ModuleProps } from '@aweftjs/modules';
import { type Connection, open } from '@aweftjs/server';

import { type AuthContext, userOf } from '../context.ts';
import { storeOf } from '../props.ts';

export interface State {
	connection(connection: Connection<AuthContext>): Promise<() => Promise<void>>;
}

export default (props: ModuleProps): State => {
	const store = storeOf(props);
	return {
		connection: async ({ link, context }) => {
			const user = userOf(context);
			if (user === null) {
				// Only a gate that is not the auth gate lets an anonymous connection reach a private
				// module. Loud, because sharing nothing in silence would look like an empty state.
				throw new Error('auth/State: an anonymous connection reached a private module; the gate in front is not auth/Gate');
			}
			const handle = await store.open(`state:${user}`);
			// The user's own document: whatever they write is theirs to write.
			link.share('state', handle.root, open);
			return async () => { await store.close(handle); };
		},
	};
};
