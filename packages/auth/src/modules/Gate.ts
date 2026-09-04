// auth/Gate: the gate that reads `public` (designs 071, 074).

import type { ModuleProps } from '@aweftjs/modules';
import type { Gate as ServerGate, Named } from '@aweftjs/server';

import { type AuthContext, userOf } from '../context.ts';
import type { Session } from './Session.ts';

export const deps = ['auth/Session'];

const isPublic = (instance: unknown): boolean =>
	instance !== null && typeof instance === 'object' && (instance as { public?: unknown }).public === true;

export default ({ imports }: ModuleProps): ServerGate<AuthContext> => {
	const Session = imports.Session as Session;
	return {
		identify: (request) => Session.whoIs(request),
		access: ({ name, instance }: Named, context) => {
			if (isPublic(instance) || userOf(context) !== null) return [];
			return [{ code: 'private', message: `${name} needs a signed-in user` }];
		},
	};
};
