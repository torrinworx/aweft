// The modules that answer what no route matched, walked in load order behind the gate (design 248).
//
// Read off the loader at every use, the way the route table is: a module loaded or unloaded
// while the server runs answers, or stops answering, from then on.

import type { Refusal } from '@aweftjs/core';
import type { Loader } from '@aweftjs/modules';

import { type Gate, type ServerModule, serverError } from './contract.ts';
import { routeKey } from './routes.ts';

type Hook = NonNullable<ServerModule['request']>;

interface Falling {
	readonly request: Request;
	readonly context: unknown;
	readonly loader: Loader;
	readonly gate: Gate;
	readonly report: (name: string, error: unknown) => void;
}

/**
 * What the walk found. `answer` is the response of the first module that gave one; `refused`
 * the reasons of the first module the gate turned away, when nothing answered after it;
 * `failed` a hook that threw or answered something else, already reported. None of the three
 * means every module declined.
 */
export interface Fallthrough {
	readonly answer?: Response;
	readonly refused?: readonly Refusal[];
	readonly failed?: boolean;
}

const hookOf = (instance: unknown): Hook | undefined => {
	if (instance === null || typeof instance !== 'object') return undefined;
	const hook: unknown = (instance as ServerModule).request;
	return typeof hook === 'function' ? hook as Hook : undefined;
};

/** Ask every loaded module that declares `request`, in load order, until one answers. */
export const fallthrough = async ({ request, context, loader, gate, report }: Falling): Promise<Fallthrough> => {
	let refused: readonly Refusal[] | undefined;
	for (const name of loader.loaded()) {
		const instance = loader.get(name);
		const hook = hookOf(instance);
		if (hook === undefined) continue;
		try {
			const reasons = await gate.access({ name, instance }, context);
			// Skipped rather than refused where it stands, so a public module still answers under
			// a private one that happens to be loaded before it.
			if (reasons.length > 0) {
				refused ??= reasons;
				continue;
			}
			const answer: unknown = await hook.call(instance, request, context);
			if (answer instanceof Response) return { answer };
			if (answer !== undefined) {
				throw serverError(
					'not-a-response', `${name} answered ${routeKey(request)} with something that is not a Response`,
					'Return a Response from the request hook, or undefined to decline.',
				);
			}
		} catch (error) {
			report(name, error);
			return { failed: true };
		}
	}
	return refused === undefined ? {} : { refused };
};
