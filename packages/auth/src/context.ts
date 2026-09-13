// What the auth gate resolves for a connection or a request (design 074).

/** Who is on a connection: the user's id and the session token, or neither. */
export interface AuthContext {
	readonly user: string | null;
	readonly session: string | null;
}

/** The user on a context, when the context is one of ours and has one. */
export const userOf = (context: unknown): string | null => {
	const user: unknown = (context as { user?: unknown } | null)?.user;
	return typeof user === 'string' ? user : null;
};
