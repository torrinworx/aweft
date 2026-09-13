// What leaves the room as data (design 280): the text of an error, a rejection or a console
// line, made so that nothing a module hands the console can throw back into the room, and the
// listeners a realm installs to forward them.

import type { Report } from './contract.ts';

/** The most of a message or a stack that crosses. */
const MOST = 4096;

const cut = (text: string): string => (text.length > MOST ? text.slice(0, MOST) : text);

/** One console argument as text, whatever it is and however it misbehaves. */
const textOf = (value: unknown): string => {
	if (typeof value === 'string') return value;
	if (value instanceof Error) return `${value.name}: ${value.message}`;
	try {
		const json = JSON.stringify(value);
		if (typeof json === 'string') return json;
	} catch {
		// A cycle, a bigint, or a toJSON that throws: fall through to String.
	}
	try {
		return String(value);
	} catch {
		return '[unprintable]';
	}
};

const stackOf = (value: unknown): string => {
	const stack: unknown = (value as { stack?: unknown } | null)?.stack;
	return typeof stack === 'string' ? cut(stack) : '';
};

/** A stack taken here, in the room's realm, without the leading message line. */
const stackNow = (): string => cut((new Error().stack ?? '').replace(/^Error\n?/, ''));

/** An error report from what an `error` event or a thrown value carried. */
export const errorReport = (kind: 'error' | 'rejection', thrown: unknown, fallback: string, module: string | undefined): Report => {
	const message = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : thrown === undefined || thrown === null ? fallback : textOf(thrown);
	const entry: Report = { kind, message: cut(message), stack: stackOf(thrown) };
	return module === undefined ? entry : { ...entry, module };
};

/** A console report from the arguments a level was called with. */
export const consoleReport = (level: string, args: readonly unknown[], module: string | undefined): Report => {
	const entry: Report = { kind: 'console', level, message: cut(args.map(textOf).join(' ')), stack: stackNow() };
	return module === undefined ? entry : { ...entry, module };
};

interface ErrorEventLike {
	readonly error?: unknown;
	readonly message?: unknown;
	readonly reason?: unknown;
}

interface RealmLike {
	addEventListener?(type: string, fn: (event: ErrorEventLike) => void): void;
	removeEventListener?(type: string, fn: (event: ErrorEventLike) => void): void;
	console?: Record<string, unknown>;
}

/**
 * Forward this realm's uncaught errors and unhandled rejections. Returns what uninstalls them.
 * A realm with no event target (Node) installs nothing, because a child process reports
 * console only and its uncaught error ends the process.
 */
export const forwardErrors = (report: (entry: Report) => void, module: () => string | undefined): () => void => {
	const realm = globalThis as unknown as RealmLike;
	if (typeof realm.addEventListener !== 'function' || typeof realm.removeEventListener !== 'function') return () => {};
	const onError = (event: ErrorEventLike): void => {
		const fallback = typeof event.message === 'string' ? event.message : 'uncaught error';
		report(errorReport('error', event.error, fallback, module()));
	};
	const onRejection = (event: ErrorEventLike): void => {
		report(errorReport('rejection', event.reason, 'unhandled rejection', module()));
	};
	realm.addEventListener('error', onError);
	realm.addEventListener('unhandledrejection', onRejection);
	return () => {
		realm.removeEventListener!('error', onError);
		realm.removeEventListener!('unhandledrejection', onRejection);
	};
};

/**
 * Wrap the named console levels so each call reaches the real console first and then the
 * host. A level the console does not have is left alone. Returns what restores the console.
 */
export const forwardConsole = (levels: readonly string[], report: (entry: Report) => void, module: () => string | undefined): () => void => {
	const held = (globalThis as unknown as RealmLike).console;
	if (held === undefined || held === null) return () => {};
	const restores: (() => void)[] = [];
	for (const level of levels) {
		const original = held[level];
		if (typeof original !== 'function') continue;
		held[level] = (...args: unknown[]): void => {
			(original as (...a: unknown[]) => void).apply(held, args);
			report(consoleReport(level, args, module()));
		};
		restores.push(() => { held[level] = original; });
	}
	return () => { for (const restore of restores) restore(); };
};
