// auth/Roles: the names a person holds, kept in `roles:<user>` and read live (design 289).

import { codecError } from '@aweftjs/codec';
import { atomic, createArray } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';
import type { Connection } from '@aweftjs/server';

import { type AuthContext, userOf } from '../context.ts';
import { type Implies, holds, isName } from '../names.ts';
import { notGated, storeOf } from '../props.ts';

export const defaults = { implies: {}, first: [] };

/** What a `roles:<user>` document holds. */
export interface RolesDocument extends Record<string, unknown> {
	names: string[];
	modifiedAt: number;
}

export interface Roles {
	/** Does the person hold the name: granted, covered by a granted name, or implied by one. Reads the store. False for text that is not a name, since nobody holds one. */
	may(user: string, name: string): Promise<boolean>;
	/** Give the person these names. A name already held is left as it is. */
	grant(user: string, ...names: string[]): Promise<void>;
	/** Take these names away. A name not held is nothing. */
	revoke(user: string, ...names: string[]): Promise<void>;
	/** What the person was granted, and nothing implied. */
	names(user: string): Promise<string[]>;
	/** Grant the configured `first` names when nobody signed up before this person. True when they were the first. */
	first(user: string): Promise<boolean>;
	/** The table, for a page that runs the same check. */
	call(args: unknown, context: unknown): { implies: Implies };
	connection(connection: Connection<AuthContext>): Promise<() => Promise<void>>;
}

const refuse = (detail: string, fix: string): Error => codecError('invalid-config', `auth/Roles was given ${detail}`, fix);

const NAME_FIX = 'A name is non-empty text with no whitespace: admin, verified, products.abc123.';
const LIST_FIX = 'Give first, and each entry of implies, a list of names: non-empty text with no whitespace.';

const namesOf = (value: unknown, what: string): readonly string[] => {
	if (!Array.isArray(value) || !value.every(isName)) throw refuse(`${what} ${JSON.stringify(value)}`, LIST_FIX);
	return value as string[];
};

const impliesOf = (value: unknown): Implies => {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw refuse(`implies ${JSON.stringify(value)}`, 'Give implies an object from a name to the list of names it implies.');
	}
	// No prototype, so a key such as `__proto__` is a name in the table and not a write to Object.
	const table: Record<string, readonly string[]> = Object.create(null) as Record<string, readonly string[]>;
	for (const [key, listed] of Object.entries(value as Record<string, unknown>)) {
		if (!isName(key)) throw refuse(`the implies key ${JSON.stringify(key)}`, NAME_FIX);
		table[key] = namesOf(listed, `implies.${key}`);
	}
	return table;
};

const invalidName = (name: unknown): Error =>
	codecError('invalid-name', `auth/Roles was handed the name ${JSON.stringify(name)}`, NAME_FIX);

const invalidUser = (user: unknown): Error =>
	codecError('invalid-user', `auth/Roles was handed the user ${JSON.stringify(user)}`, 'Hand it the id the gate put on the context, which is text.');

/** The one document this module keeps that is nobody's: whether a first sign-up has been seen. */
const FIRST = 'auth:first';

/** The page's write, refused: the names are the server's to give. */
const READ_ONLY = { accept: () => [{ code: 'read-only', message: 'names are granted by the server; a page reads them' }] };

export default async ({ config, ...props }: ModuleProps): Promise<Roles> => {
	const store = storeOf(props);
	const implies = impliesOf(config.implies);
	const first = namesOf(config.first, 'first');
	const doc = (user: string): string => `roles:${user}`;

	const checked = (user: unknown, names: readonly unknown[]): string[] => {
		if (typeof user !== 'string' || user === '') throw invalidUser(user);
		for (const name of names) if (!isName(name)) throw invalidName(name);
		return names as string[];
	};

	const writeFirst = async (granted: string | null): Promise<boolean> => {
		const marker = await store.open(FIRST);
		const root = marker.root as { granted?: string | null };
		// Two sign-ups in flight open the same live document, so the first to get here writes
		// it and the second reads it written.
		const mine = root.granted === undefined;
		if (mine) atomic(() => { Object.assign(root, { granted, at: Date.now() }); });
		await store.settled(marker);
		await store.close(marker);
		return mine;
	};

	// The marker says whether a first sign-up has been seen. Where people exist and no marker
	// does, this module was added to a store that already had them, and the next stranger to
	// sign up is not the first: the index is read once, here, and the marker written for nobody.
	if (await store.head(FIRST) === 0) {
		const hits = await store.find({ where: [{ field: 'email', op: 'gt', value: '' }] });
		if (hits.some((hit) => hit.doc.startsWith('user:'))) await writeFirst(null);
	}

	// `open` creates a document, and a check must not write one per person it asks about.
	const granted = async (user: string): Promise<string[]> => {
		if (await store.head(doc(user)) === 0) return [];
		const handle = await store.open(doc(user));
		const held = [...((handle.root as Partial<RolesDocument>).names ?? [])];
		await store.close(handle);
		return held;
	};

	const write = async (user: string, change: (names: string[]) => void): Promise<void> => {
		const handle = await store.open(doc(user));
		const root = handle.root as Partial<RolesDocument>;
		atomic(() => {
			if (root.names === undefined) root.names = createArray<string>() as string[];
			change(root.names);
			root.modifiedAt = Date.now();
		});
		await store.settled(handle);
		await store.close(handle);
	};

	const grant = async (user: string, ...names: string[]): Promise<void> => {
		const wanted = checked(user, names);
		if (wanted.length === 0) return;
		await write(user, (held) => {
			for (const name of wanted) if (!held.includes(name)) held.push(name);
		});
	};

	const firstOf = async (user: string): Promise<boolean> => {
		checked(user, []);
		if (await store.head(FIRST) !== 0) return false;
		if (!(await writeFirst(user))) return false;
		await grant(user, ...first);
		return true;
	};

	return {
		// A name built from a client's input can come out as no name at all, and the answer to
		// "does anyone hold that" is no, not a fault.
		may: async (user, name) => { checked(user, []); return isName(name) && holds(await granted(user), implies, name); },
		grant,
		revoke: async (user, ...names) => {
			const unwanted = checked(user, names);
			if (unwanted.length === 0 || await store.head(doc(user)) === 0) return;
			await write(user, (held) => {
				for (let at = held.length - 1; at >= 0; at -= 1) if (unwanted.includes(held[at]!)) held.splice(at, 1);
			});
		},
		names: async (user) => { checked(user, []); return granted(user); },
		first: firstOf,
		call: () => ({ implies }),
		connection: async ({ link, context }) => {
			const user = userOf(context);
			if (user === null) throw notGated();
			const handle = await store.open(doc(user));
			link.share('roles', handle.root, READ_ONLY);
			return async () => { await store.close(handle); };
		},
	};
};
