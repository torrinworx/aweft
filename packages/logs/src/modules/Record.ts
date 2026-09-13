// logs/Record: the one route a page sends its batches to (design 261). Public unless configured
// otherwise, because an anonymous page has as much to report as a signed-in one.

import { codecError } from '@aweftjs/codec';
import type { ModuleProps } from '@aweftjs/modules';

import { bodyOf, json } from '../props.ts';
import type { Visits } from './Visits.ts';

export const deps = ['logs/Visits'];

export const defaults = {
	public: true,
};

export interface Record {
	readonly public: boolean;
	readonly routes: {
		readonly 'POST /api/logs': (request: Request, context: unknown) => Promise<Response>;
	};
}

const reasonOf = (error: unknown): string | undefined => (error as { reason?: unknown } | null)?.reason as string | undefined;

export default ({ config, imports }: ModuleProps): Record => {
	if (typeof config.public !== 'boolean') {
		throw codecError(
			'invalid-config', `logs/Record was given public ${JSON.stringify(config.public)}`,
			'Set public to true for a route any page may post to, or false for one that needs a signed-in user.',
		);
	}
	const visits = imports.Visits as Visits;
	return {
		public: config.public,
		routes: {
			'POST /api/logs': async (request, context) => {
				const body = await bodyOf(request);
				if (body === undefined) return json(400, { reasons: [{ code: 'malformed', message: 'the body is not a JSON object' }] });
				try {
					return json(200, await visits.record(body, context));
				} catch (error) {
					const reason = reasonOf(error);
					if (reason === 'malformed') return json(400, { reasons: [{ code: reason, message: (error as Error).message }] });
					if (reason === 'capped') return json(429, { reasons: [{ code: reason, message: (error as Error).message }] });
					throw error;
				}
			},
		},
	};
};
