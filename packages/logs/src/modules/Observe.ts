// logs/Observe: what the server did, into the visit it belongs to (design 261). A call's args
// and result are written only for a module that says `logs: true`; a request's body never is.

import type { ModuleProps } from '@aweftjs/modules';
import type { ServerEvent } from '@aweftjs/server';

import { asText, bytesOf } from '../entries.ts';
import type { Visits } from './Visits.ts';

export const deps = ['logs/Visits'];

export interface Observe {
	observe(event: ServerEvent, context: unknown): void;
}

const errorFields = (error: unknown): Record<string, unknown> => {
	const held = error as { reason?: unknown; message?: unknown; stack?: unknown } | null;
	return {
		reason: typeof held?.reason === 'string' ? held.reason : undefined,
		message: held !== null && typeof held === 'object' && typeof held.message === 'string' ? held.message : asText(error),
		stack: typeof held?.stack === 'string' ? held.stack : undefined,
	};
};

/** The entry for an event, or nothing for the one event this battery makes itself. */
export const entryFor = (event: ServerEvent): Record<string, unknown> | undefined => {
	switch (event.kind) {
		case 'connection': return { at: event.at, kind: 'connection', path: new URL(event.request.url).pathname };
		case 'closed': return { at: event.at, kind: 'closed', ms: event.ms };
		case 'call': {
			const opted = (event.instance as { logs?: unknown } | undefined)?.logs === true;
			const ok = 'result' in event.outcome;
			return {
				at: event.at, kind: 'call', name: event.name, ms: event.ms, ok,
				...(ok ? {} : errorFields(event.outcome.error)),
				argsBytes: bytesOf(event.args),
				resultBytes: ok ? bytesOf(event.outcome.result) : undefined,
				args: opted ? asText(event.args) : undefined,
				result: opted && ok ? asText(event.outcome.result) : undefined,
			};
		}
		case 'request':
			// Every batch the page sends would otherwise be a row.
			if (event.path === '/api/logs') return undefined;
			return { at: event.at, kind: 'request', method: event.method, path: event.path, status: event.status, ms: event.ms, name: event.name };
		case 'refused': return { at: event.at, kind: 'refused', topic: event.topic, reasons: event.reasons };
		case 'failed': return { at: event.at, kind: 'failed', name: event.name, ...errorFields(event.error) };
	}
};

export default ({ imports }: ModuleProps): Observe => {
	const visits = imports.Visits as Visits;
	return {
		observe: (event, context) => {
			const entry = entryFor(event);
			if (entry === undefined) return;
			void visits.write(entry, context).catch(() => undefined);
		},
	};
};
