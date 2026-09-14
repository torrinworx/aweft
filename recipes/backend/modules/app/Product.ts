// A rule finer than a module: one product is readable by whoever holds a name under
// `products.<id>`, asked of auth/Roles per call, so a grant of `products.p1` opens one product
// and not the next.

import { codecError } from '@aweftjs/codec';
import type { Roles } from '@aweftjs/auth';
import type { ModuleProps } from '@aweftjs/modules';

export const deps = ['auth/Roles'];

export default ({ imports }: ModuleProps) => {
	const roles = imports.Roles as Roles;
	return {
		call: async ({ id }: { id: string }, context: { user: string }) => {
			if (!(await roles.may(context.user, `products.${id}.read`))) {
				throw codecError('needs', `product ${id} is not yours to read`, 'Ask the administrator for access.');
			}
			return `product ${id}`;
		},
	};
};
