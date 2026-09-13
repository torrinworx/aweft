// What the auth gate resolves for a connection or a request (designs 074, 275).

/** Who is on a connection: the user's id and the session token, or neither, and where it came from. */
export interface AuthContext {
	readonly user: string | null;
	readonly session: string | null;
	/** The peer address as far as the listener could tell, so a route can count by it. Absent from a context built by hand. */
	readonly address?: string | undefined;
}

/** The user on a context, when the context is one of ours and has one. */
export const userOf = (context: unknown): string | null => {
	const user: unknown = (context as { user?: unknown } | null)?.user;
	return typeof user === 'string' ? user : null;
};

/** The address on a context, when it carries one. */
export const addressOf = (context: unknown): string | undefined => {
	const address: unknown = (context as { address?: unknown } | null)?.address;
	return typeof address === 'string' ? address : undefined;
};
