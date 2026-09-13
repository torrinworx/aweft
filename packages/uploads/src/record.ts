// What an upload's record is: the document as the keeper writes it, and the plain shape every
// reader answers (design 262).

import { createObject } from '@aweftjs/core';

export type Primitive = string | number | boolean | null;

/** An upload as plain data: what `put` and the route answer, and what the readers read back. */
export interface UploadRecord {
	readonly id: string;
	/** `/files/<id>`, where `uploads/Serve` answers it. */
	readonly url: string;
	readonly user: string | null;
	readonly name: string | null;
	readonly type: string;
	readonly size: number;
	/** Hex, lower case. */
	readonly sha256: string;
	readonly at: number;
	readonly storage: { readonly adapter: string; readonly key: string };
	readonly meta: Readonly<Record<string, Primitive>> | null;
}

/** The root of an `upload:<id>` document. */
export interface Root {
	kind: 'upload';
	user: string | null;
	name: string | null;
	type: string;
	size: number;
	sha256: string;
	at: number;
	storage: { adapter: string; key: string };
	meta: Record<string, Primitive> | null;
}

/** The document name an id has. */
export const docOf = (id: string): string => `upload:${id}`;

/** The URL an id is served at. */
export const urlOf = (id: string): string => `/files/${id}`;

/** The primitive slots of a value, and nothing nested: what `meta` may hold. */
export const flat = (value: Readonly<Record<string, unknown>>): Record<string, Primitive> => {
	const out: Record<string, Primitive> = {};
	for (const [key, held] of Object.entries(value)) {
		if (held === null || typeof held === 'string' || typeof held === 'number' || typeof held === 'boolean') out[key] = held;
	}
	return out;
};

/** Write a root's slots in one place, so the shape has one spelling. */
export const writeRoot = (root: Root, fields: Omit<Root, 'kind'>): void => {
	root.kind = 'upload';
	root.user = fields.user;
	root.name = fields.name;
	root.type = fields.type;
	root.size = fields.size;
	root.sha256 = fields.sha256;
	root.at = fields.at;
	root.storage = createObject({ adapter: fields.storage.adapter, key: fields.storage.key }) as { adapter: string; key: string };
	root.meta = fields.meta === null ? null : createObject(fields.meta) as Record<string, Primitive>;
};

/** A record from a root the store handed back, or undefined when it is not one. */
export const recordOf = (id: string, root: unknown): UploadRecord | undefined => {
	const held = root as Partial<Root> | null;
	if (held === null || typeof held !== 'object' || held.kind !== 'upload' || typeof held.type !== 'string' || typeof held.sha256 !== 'string') return undefined;
	const storage = held.storage as { adapter?: unknown; key?: unknown } | undefined;
	return {
		id,
		url: urlOf(id),
		user: typeof held.user === 'string' ? held.user : null,
		name: typeof held.name === 'string' ? held.name : null,
		type: held.type,
		size: typeof held.size === 'number' ? held.size : 0,
		sha256: held.sha256,
		at: typeof held.at === 'number' ? held.at : 0,
		storage: { adapter: String(storage?.adapter ?? ''), key: String(storage?.key ?? id) },
		meta: held.meta === null || held.meta === undefined ? null : flat(held.meta as Record<string, unknown>),
	};
};
