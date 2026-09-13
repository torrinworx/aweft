// What a drop zone accepts, why it refused a file, and how it says both to a person (design 214).
//
// Two components run these checks: the zone, and a `FileDrop.Button` standing on its own. One file
// rather than two, so neither holds a second opinion about what `image/*` matches or how a byte
// count is written.
//
// This is not exported.
//
// Every sentence a person reads is a text token resolved by `say`, which the component hands in
// with its mount context, so the zone's prompt and an entry's `error` come out in the page's
// language and `error` stays the string a page reads (design 278).

import { type TextToken, text } from './text.ts';

/** How a sentence reaches a person: a token resolved in the component's own render. */
export type Say = (token: TextToken) => string;

/** One file the zone was given, as the application reads it. */
export interface FileDropEntry {
	/** The file's own name. */
	readonly name: string;
	/** The platform `File`. Upload it however you like. */
	readonly file: unknown;
	/** `ready` for one the zone accepted, `error` for one it refused, `loading` while you upload. */
	readonly status: 'ready' | 'loading' | 'error';
	/** Why it was refused, on an entry that was: a sentence to read. */
	readonly error?: string;
	/** Why it was refused, on an entry that was: a code to branch on. */
	readonly reason?: 'type' | 'size' | 'count';
}

/** What the checks are made of: what is accepted, how many, and how big. */
export interface Limits {
	readonly wanted: readonly string[];
	readonly many: boolean;
	readonly cap: number | null;
}

export const nameOf = (file: unknown): string => String((file as { name?: unknown }).name ?? '');
export const sizeOf = (file: unknown): number => Number((file as { size?: unknown }).size ?? 0);
const typeOf = (file: unknown): string =>
	String((file as { type?: unknown }).type ?? '').toLowerCase();

/** Whether one of the declared extensions or MIME types covers this file. */
export const covers = (wanted: readonly string[], file: unknown): boolean => {
	if (wanted.length === 0) return true;
	const name = nameOf(file).toLowerCase();
	const mime = typeOf(file);
	return wanted.some((raw) => {
		const want = raw.trim().toLowerCase();
		if (want === '') return false;
		if (want.startsWith('.')) return name.endsWith(want);
		if (want.endsWith('/*')) return mime.startsWith(want.slice(0, -1));
		return mime === want;
	});
};

const UNITS: readonly string[] = ['bytes', 'KB', 'MB', 'GB'];

/**
 * A byte count as a person says it: KB, MB or GB, 1024 to a step.
 *
 * Under a kilobyte it stays in bytes, because "0.5 KB" is a rounder number than the truth and the
 * truth is short enough to read. One decimal where the number is not whole, none where it is.
 */
export const sizeText = (bytes: number): string => {
	let held = Math.max(0, bytes);
	let at = 0;
	while (held >= 1024 && at < UNITS.length - 1) {
		held /= 1024;
		at += 1;
	}
	const rounded = Math.round(held * 10) / 10;
	return `${rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1)} ${UNITS[at]!}`;
};

/**
 * One declared type as a person says it: `image/png` is `png`, `image/*` is `image`, `.csv` is
 * `csv`. The prompt is read by whoever is about to choose a file, and `image/png` is a header.
 */
const typeName = (raw: string): string => {
	const want = raw.trim();
	if (want === '') return '';
	if (want.startsWith('.')) return want.slice(1);
	const slash = want.indexOf('/');
	if (slash < 0) return want;
	const sub = want.slice(slash + 1);
	return sub === '*' ? want.slice(0, slash) : sub;
};

/** The declared types, named for a person, with the empty ones dropped. */
export const typeNames = (wanted: readonly string[]): string[] =>
	wanted.map(typeName).filter((name) => name !== '');

/** The line the zone shows: what to do, then what is accepted and how big it may be. */
export const promptFor = (limits: Limits, say: Say): string => {
	const asked = say(limits.many
		? text('Drop files here, or choose them')
		: text('Drop a file here, or choose one'));
	const said: string[] = [];
	const names = typeNames(limits.wanted);
	if (names.length > 0) said.push(names.join(', '));
	if (limits.cap !== null) said.push(say(text('up to {size}', { size: sizeText(limits.cap) })));
	return said.length === 0 ? asked : `${asked}. ${said.join(', ')}`;
};

/** Why this file was refused, or null when it was not. `taken` is how many are already accepted. */
export const refusalOf = (
	limits: Limits,
	file: unknown,
	taken: number,
	say: Say,
): { reason: 'type' | 'size' | 'count'; error: string } | null => {
	if (!covers(limits.wanted, file)) {
		return { reason: 'type', error: say(text('{name} is not one of the accepted types', { name: nameOf(file) })) };
	}
	if (limits.cap !== null && sizeOf(file) > limits.cap) {
		return { reason: 'size', error: say(text('{name} is over the {size} limit', { name: nameOf(file), size: sizeText(limits.cap) })) };
	}
	// A refused file stays in the list with its reason, so a person who dragged eight of them can
	// see which ones did not land (design 137).
	if (!limits.many && taken > 0) {
		return { reason: 'count', error: say(text('only one file is accepted')) };
	}
	return null;
};

/** A run of files as entries, and the ones that were accepted. */
export const sortFiles = (
	limits: Limits,
	given: readonly unknown[],
	say: Say,
): { rows: FileDropEntry[]; taken: unknown[] } => {
	const rows: FileDropEntry[] = [];
	const taken: unknown[] = [];
	for (const file of given) {
		const why = refusalOf(limits, file, taken.length, say);
		if (why !== null) {
			rows.push({ name: nameOf(file), file, status: 'error', error: why.error, reason: why.reason });
			continue;
		}
		rows.push({ name: nameOf(file), file, status: 'ready' });
		taken.push(file);
	}
	return { rows, taken };
};

/** What `ready` is written: null while anything is loading, else the file or the files. */
export const readyValue = (rows: readonly FileDropEntry[], many: boolean): unknown => {
	if (rows.some((row) => row.status === 'loading')) return null;
	const kept = rows.filter((row) => row.status !== 'error').map((row) => row.file);
	return many ? kept : kept[0] ?? null;
};
