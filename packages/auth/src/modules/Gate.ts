// auth/Gate: the gate that reads `public` and `needs` (designs 071, 074, 289).

import type { ModuleProps } from '@aweftjs/modules';
import type { Gate as ServerGate, Named, Refusal } from '@aweftjs/server';

import { type AuthContext, userOf } from '../context.ts';
import { isName } from '../names.ts';
import type { Roles } from './Roles.ts';
import type { Session } from './Session.ts';

export const deps = ['auth/Session', 'auth/Roles'];

const isPublic = (instance: unknown): boolean =>
	instance !== null && typeof instance === 'object' && (instance as { public?: unknown }).public === true;

/**
 * The names a module declares it needs: one, a list, or none. A declaration that is neither a
 * name nor a list of names is `undefined`: the module is refused to everyone, because a word
 * that reads as narrow and admits broadly is the wrong way to fail.
 */
const needsOf = (instance: unknown): readonly string[] | undefined => {
	if (instance === null || typeof instance !== 'object' || !('needs' in instance)) return [];
	const held: unknown = (instance as { needs?: unknown }).needs;
	if (held === undefined) return [];
	if (isName(held)) return [held];
	return Array.isArray(held) && held.every(isName) ? held : undefined;
};

export default ({ imports }: ModuleProps): ServerGate<AuthContext> => {
	const Session = imports.Session as Session;
	const Roles = imports.Roles as Roles;
	return {
		identify: (request, peer) => Session.whoIs(request, peer),
		access: async ({ name, instance }: Named, context): Promise<Refusal[]> => {
			const user = userOf(context);
			const needs = needsOf(instance);
			if (needs === undefined) return [{ code: 'needs', message: `${name} declares needs that is not a name or a list of names` }];
			// A module that needs a name needs a person, whatever else it declares.
			if (needs.length === 0 && isPublic(instance)) return [];
			if (user === null) return [{ code: 'private', message: `${name} needs a signed-in user` }];
			for (const wanted of needs) {
				if (!(await Roles.may(user, wanted))) return [{ code: 'needs', message: `${name} needs ${wanted}` }];
			}
			return [];
		},
	};
};
