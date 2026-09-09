// This application's gate: the battery's policy, plus one rule of its own. The boot names it,
// so nothing composes anything by hand.
//
// The rule: the first person to arrive is the administrator, and only the administrator
// reaches a module that declares `admin: true`. Who that is lives in a document, so it
// survives a restart the way everything else in this stack does.

import type { ModuleProps } from '@aweftjs/modules';
import type { Gate, Identified, Named, Peer, Refusal } from '@aweftjs/server';
import type { Store } from '@aweftjs/store';

export const deps = ['auth/Gate', 'app/Log'];

interface Who { user: string | null }

export default async ({ imports, store }: ModuleProps) => {
	const under = imports.Gate as Gate<Who>;
	const log = imports.Log as { note(line: string): void };
	const held = await (store as Store).open('app:admin');
	const admin = held.root as { user?: string };

	return {
		identify: async (request: Request, peer: Peer): Promise<Identified<Who>> => {
			const who = await under.identify(request, peer);
			if ('context' in who && who.context.user !== null && admin.user === undefined) {
				admin.user = who.context.user;
				await (store as Store).settled(held);
			}
			return who;
		},
		access: async (module: Named, context: Who): Promise<readonly Refusal[]> => {
			const reasons = await under.access(module, context);
			if (reasons.length > 0) return reasons;
			const wantsAdmin = (module.instance as { admin?: boolean } | null)?.admin === true;
			return wantsAdmin && context.user !== admin.user
				? [{ code: 'not-admin', message: `${module.name} is for the administrator` }]
				: [];
		},
		stop: async () => {
			log.note('app/Gate');
			await (store as Store).close(held);
		},
	};
};
