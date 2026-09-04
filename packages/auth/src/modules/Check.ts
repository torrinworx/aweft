// auth/Check: does anyone have this email. Public, so a sign-in form can ask before it asks
// for a password.

import type { ModuleProps } from '@aweftjs/modules';

import { storeOf } from '../props.ts';
import { findUser, looksLikeEmail, normalEmail } from '../users.ts';

export interface Check {
	readonly public: true;
	exists(email: string): Promise<boolean>;
	call(args: unknown): Promise<{ exists: boolean }>;
}

export default (props: ModuleProps): Check => {
	const store = storeOf(props);
	const exists = async (email: string): Promise<boolean> =>
		looksLikeEmail(normalEmail(email)) && (await findUser(store, email)) !== undefined;
	return {
		public: true,
		exists,
		call: async (args) => {
			const email: unknown = (args as { email?: unknown } | null)?.email;
			if (typeof email !== 'string') throw Object.assign(new Error('auth/Check asks for { email }'), { reason: 'malformed' });
			return { exists: await exists(email) };
		},
	};
};
