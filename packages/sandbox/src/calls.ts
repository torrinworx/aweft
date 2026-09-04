// A call is a row (design 068), and both ends run this file.
//
// An end writes a row addressed to the other, the other answers by writing beside it, and the
// writer deletes it once it has read the answer. Only text crosses, and the walk that makes
// the text is the check that refuses anything that is not data.

import { createObject, observer } from '@aweftjs/core';

import { type SandboxError, type Side, sandboxError } from './contract.ts';
import { decode, encode } from './data.ts';

/** One call, as the document holds it. `result` or `error` appears when it is answered. */
export interface Row extends Record<string, unknown> {
	from: Side;
	to: string;
	method: string;
	/** JSON text of the argument list. */
	args: string;
	/** JSON text of what the function returned. */
	result?: string;
	/** JSON text of `{ reason, message }`. */
	error?: string;
}

/** What this end does with a call addressed to it. Throw to answer with an error. */
export type Answer = (to: string, method: string, args: readonly unknown[]) => Promise<unknown>;

export interface Bridge {
	/** Write a row and wait for its answer. Rejects with a `SandboxError`. */
	call(to: string, method: string, args: readonly unknown[]): Promise<unknown>;
	/** Stop answering, and reject every call still waiting with `closed`. */
	stop(): void;
}

interface Waiting {
	settle(value: unknown): void;
	fail(error: unknown): void;
	timer: ReturnType<typeof setTimeout> | undefined;
}

const errorText = (reason: string, message: string, path?: string): string =>
	JSON.stringify(path === undefined ? { reason, message } : { reason, message, path });

const pathOf = (error: unknown): string | undefined => {
	const path: unknown = (error as { path?: unknown } | null)?.path;
	return typeof path === 'string' ? path : undefined;
};

const reasonOf = (error: unknown): string => {
	const reason: unknown = (error as { reason?: unknown } | null)?.reason;
	return typeof reason === 'string' ? reason : 'failed';
};

const messageOf = (error: unknown): string =>
	String((error as { message?: unknown } | null)?.message ?? error);

/**
 * This end of the calls document.
 *
 * Params:
 *   calls: the shared calls document
 *   side: which end this is; rows it writes say so, and it answers rows from the other
 *   answer: what to do with a call addressed here
 *   options.callMs: how long a call may wait for its answer before it errors with `timeout`
 */
export const createBridge = (
	calls: Record<string, unknown>,
	side: Side,
	answer: Answer,
	options: { readonly callMs?: number | undefined } = {},
): Bridge => {
	const other: Side = side === 'host' ? 'room' : 'host';
	const pending = new Map<string, Waiting>();
	const answering = new Set<string>();
	let next = 1;
	let over = false;

	const rowOf = (id: string): Row | undefined => {
		const row: unknown = calls[id];
		return row !== null && typeof row === 'object' ? row as Row : undefined;
	};

	// The writer may have deleted the row meanwhile (a timeout, or a stop); then there is
	// nobody to answer.
	const finish = (id: string, outcome: { result: string } | { error: string }): void => {
		const row = rowOf(id);
		if (row === undefined) return;
		if ('result' in outcome) row.result = outcome.result;
		else row.error = outcome.error;
	};

	const take = async (id: string, row: Row): Promise<void> => {
		answering.add(id);
		try {
			if (typeof row.to !== 'string' || typeof row.method !== 'string' || typeof row.args !== 'string') {
				finish(id, { error: errorText('malformed', 'a call row needs to, method and args') });
				return;
			}
			let args: unknown;
			try {
				args = decode(row.args, 'args');
			} catch (error) {
				finish(id, { error: errorText('malformed', messageOf(error)) });
				return;
			}
			if (!Array.isArray(args)) {
				finish(id, { error: errorText('malformed', 'args is not a list') });
				return;
			}
			let result: unknown;
			try {
				result = await answer(row.to, row.method, args);
			} catch (error) {
				finish(id, { error: errorText(reasonOf(error), messageOf(error), pathOf(error)) });
				return;
			}
			let text: string;
			try {
				text = encode(result, 'result');
			} catch (error) {
				finish(id, { error: errorText('not-data', messageOf(error), pathOf(error)) });
				return;
			}
			finish(id, { result: text });
		} finally {
			answering.delete(id);
		}
	};

	const settle = (id: string, waiting: Waiting, row: Row): void => {
		pending.delete(id);
		clearTimeout(waiting.timer);
		delete calls[id];
		if (typeof row.result === 'string') {
			try {
				waiting.settle(decode(row.result, 'result'));
			} catch (error) {
				waiting.fail(error);
			}
			return;
		}
		let reported: unknown;
		try {
			reported = decode(row.error, 'error');
		} catch (error) {
			waiting.fail(error);
			return;
		}
		waiting.fail(sandboxError(reasonOf(reported), messageOf(reported), pathOf(reported)));
	};

	const scan = (): void => {
		if (over) return;
		for (const [id, waiting] of [...pending]) {
			const row = rowOf(id);
			if (row === undefined) {
				// The other end deleted a row it did not write. Nothing will answer it now.
				pending.delete(id);
				clearTimeout(waiting.timer);
				waiting.fail(sandboxError('closed', `the call ${id} vanished before it was answered`));
			} else if (typeof row.result === 'string' || typeof row.error === 'string') {
				settle(id, waiting, row);
			}
		}
		for (const id of Object.keys(calls)) {
			if (answering.has(id) || pending.has(id)) continue;
			const row = rowOf(id);
			if (row === undefined || row.from !== other) continue;
			if (typeof row.result === 'string' || typeof row.error === 'string') continue;
			void take(id, row);
		}
	};

	const stopWatching = observer(calls).watch(scan);
	// Rows written before this end was listening, which is how the first call reaches a room
	// that was still starting.
	scan();

	const call = (to: string, method: string, args: readonly unknown[]): Promise<unknown> =>
		new Promise((resolve, reject) => {
			if (over) {
				reject(sandboxError('closed', 'the room has stopped'));
				return;
			}
			let text: string;
			try {
				text = encode([...args], 'args');
			} catch (error) {
				// A throw while encoding the arguments is a refusal to carry them: report it with a
				// reason a caller can branch on, the same as the result side does (contract's
				// SandboxError). A getter that throws mid-walk lands here rather than as a bare throw.
				reject(reasonOf(error) === 'not-data' ? error : sandboxError('not-data', `${to}.${method}: an argument could not be encoded: ${messageOf(error)}`));
				return;
			}
			const id = `${side}${next}`;
			next += 1;
			const waiting: Waiting = { settle: resolve, fail: reject, timer: undefined };
			if (options.callMs !== undefined) {
				waiting.timer = setTimeout(() => {
					if (!pending.has(id)) return;
					pending.delete(id);
					delete calls[id];
					reject(sandboxError('timeout', `${to}.${method} was not answered within ${options.callMs} ms`));
				}, options.callMs);
			}
			pending.set(id, waiting);
			calls[id] = createObject<Row>({ from: side, to, method, args: text });
		});

	return {
		call,
		stop: () => {
			if (over) return;
			over = true;
			stopWatching();
			for (const [id, waiting] of pending) {
				clearTimeout(waiting.timer);
				waiting.fail(sandboxError('closed', `the room stopped before ${id} was answered`));
			}
			pending.clear();
		},
	};
};

export type { SandboxError };
