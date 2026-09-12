// The modules that hear what the server did, walked in load order (design 260).
//
// Read off the loader at every use, the way the route table is, so a module loaded while the
// server runs hears from then on. Nothing waits for an observer: a throw or a rejection is
// reported under the observer's name and never becomes an event, so an observer that throws
// on every event does not chase its own tail.

import type { Loader } from '@aweftjs/modules';

import type { ServerEvent, ServerModule } from './contract.ts';

type Hook = NonNullable<ServerModule['observe']>;

/** Deliver one event to every observer, for one context. */
export type Emit = (event: ServerEvent, context: unknown) => void;

const hookOf = (instance: unknown): Hook | undefined => {
	if (instance === null || typeof instance !== 'object') return undefined;
	const hook: unknown = (instance as ServerModule).observe;
	return typeof hook === 'function' ? hook as Hook : undefined;
};

/** An emitter over the loader, reporting through `report` and emitting nothing for what it reports. */
export const emitter = (loader: Loader, report: (name: string, error: unknown) => void): Emit => (event, context) => {
	for (const name of loader.loaded()) {
		const instance = loader.get(name);
		const hook = hookOf(instance);
		if (hook === undefined) continue;
		try {
			const outcome: unknown = hook.call(instance, event, context);
			if (outcome instanceof Promise) outcome.catch((error: unknown) => { report(name, error); });
		} catch (error) {
			report(name, error);
		}
	}
};
