// site/Gate: the one rule this application has about who may see a page.
//
// The battery ships none, because "allowed" means something different in every application. A
// page that needs a signed-in user names this in `deps` and calls `require()` in its factory;
// the throw reaches the stage, which shows the act `refused` names (designs 244, 245).

import type { Auth } from '@aweftjs/auth/client';
import { codecError } from '@aweftjs/codec';

export const deps = ['auth/Session'];

export interface Gate {
	/** Who this is, once the server has said. Throws `anonymous` when the answer is nobody. */
	require(): Promise<string>;
}

export default ({ imports }: { imports: Readonly<Record<string, unknown>> }): Gate => {
	const session = imports['Session'] as Auth;

	// `user` reads undefined until the first socket answers, and undefined is not an answer: a
	// page that gated on it would let a stranger in for as long as the handshake takes.
	const answered = async (): Promise<string | null> => {
		const held = session.user.get();
		if (held !== undefined) return held;
		return await new Promise<string | null>((done) => {
			const off = session.user.watch((now) => {
				if (now === undefined) return;
				off();
				done(now);
			});
		});
	};

	return {
		require: async () => {
			const who = await answered();
			if (who === null) {
				throw codecError('anonymous', 'this page is for a signed-in user', 'Sign in first.');
			}
			return who;
		},
	};
};
