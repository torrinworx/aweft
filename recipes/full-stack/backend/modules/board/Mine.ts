// board/Mine: no `public`, so the battery's gate lets only a signed-in connection reach it.
//
// It answers with who asked. That answer is what tells the page its cookie reached the socket,
// because identity is read from the cookie at the handshake and nowhere else.

import type { AuthContext } from '@aweftjs/auth';

export default () => ({
	call: (_args: unknown, context: AuthContext) => `the board of ${String(context.user)}`,
});
