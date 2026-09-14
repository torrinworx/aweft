// Who grants a name is this application's rule: here the administrator hands names out over
// the wire, and nobody else reaches this module. The battery ships no such route.

import type { Roles } from '@aweftjs/auth';
import type { ModuleProps } from '@aweftjs/modules';

export const deps = ['auth/Roles'];

export default ({ imports }: ModuleProps) => {
	const roles = imports.Roles as Roles;
	return {
		needs: 'admin',
		call: async ({ user, name }: { user: string; name: string }) => { await roles.grant(user, name); return 'granted'; },
	};
};
