// The route table, read off the loaded modules each time it is needed (design 072).
//
// Read each time rather than once, because a loader's modules change under `follow`, and a
// table built at start would answer for modules that are gone and miss the ones that came.

import type { Loader } from '@aweftjs/modules';

import { type Route, type ServerModule, serverError } from './contract.ts';

export interface Owned {
	readonly name: string;
	readonly instance: unknown;
	readonly route: Route;
}

const routesOf = (instance: unknown): Readonly<Record<string, Route>> | undefined => {
	if (instance === null || typeof instance !== 'object') return undefined;
	const routes: unknown = (instance as ServerModule).routes;
	if (routes === null || typeof routes !== 'object') return undefined;
	return routes as Readonly<Record<string, Route>>;
};

/** Every route the loaded modules declare, by exact key. Throws `route-conflict` naming both owners. */
export const routeTable = (loader: Loader): Map<string, Owned> => {
	const table = new Map<string, Owned>();
	for (const name of loader.loaded()) {
		const instance = loader.get(name);
		const routes = routesOf(instance);
		if (routes === undefined) continue;
		for (const [key, route] of Object.entries(routes)) {
			if (typeof route !== 'function') continue;
			const held = table.get(key);
			if (held !== undefined) {
				throw serverError(
					'route-conflict', `${held.name} and ${name} both declare ${key}`,
					'Rename one of the two routes, or unload one of the modules.',
				);
			}
			table.set(key, { name, instance, route });
		}
	}
	return table;
};

/** The key a request is looked up by: its method and its path, with no query. */
export const routeKey = (request: Request): string =>
	`${request.method} ${new URL(request.url).pathname}`;
