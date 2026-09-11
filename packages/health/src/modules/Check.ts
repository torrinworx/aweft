// health/Check: one route that says whether the process and its store are up (design 258).

import { codecError } from '@aweftjs/codec';
import type { ModuleProps } from '@aweftjs/modules';

export const defaults = {
	info: {},
	checks: {},
	public: true,
};

/** A check: run on every poll and answered under its name. What it answers is its own. */
export type Check = () => unknown;

/** The instance: what the gate reads, and the one route, for GET and for HEAD. */
export interface Health {
	/** True unless the configuration says otherwise, so a gate that reads it answers anyone. */
	readonly public: boolean;
	readonly routes: {
		readonly 'GET /api/health': () => Promise<Response>;
		readonly 'HEAD /api/health': () => Promise<Response>;
	};
}

/** The store as far as this module reads it: the one probe every driver answers. */
interface Probed {
	head(doc: string): Promise<number>;
}

const refuse = (detail: string, fix: string): Error =>
	codecError('invalid-config', `health/Check was given ${detail}`, fix);

const isPlain = (held: unknown): held is Record<string, unknown> =>
	held !== null && typeof held === 'object' && !Array.isArray(held);

const INFO_FIX = 'Give info an object JSON can write, such as { build: "abc123" }.';
const CHECKS_FIX = 'Give checks a function per name, each answering what to report under that name.';

const infoOf = (held: unknown): Readonly<Record<string, unknown>> => {
	let written: string | undefined;
	try {
		written = JSON.stringify(held);
	} catch {
		throw refuse('an info JSON cannot write', INFO_FIX);
	}
	if (!isPlain(held)) throw refuse(`info ${String(written)}`, INFO_FIX);
	return held;
};

const checksOf = (held: unknown): readonly (readonly [string, Check])[] => {
	if (!isPlain(held)) throw refuse(`checks ${JSON.stringify(held)}`, CHECKS_FIX);
	return Object.entries(held).map(([name, check]) => {
		if (typeof check !== 'function') throw refuse(`a check that is not a function: ${name}`, CHECKS_FIX);
		return [name, check as Check] as const;
	});
};

export default ({ config, store }: ModuleProps): Health => {
	const info = infoOf(config.info);
	const checks = checksOf(config.checks);
	if (typeof config.public !== 'boolean') {
		throw refuse(`public ${JSON.stringify(config.public)}`, 'Set public to true for a poll anyone may make, or false for one that needs a signed-in user.');
	}
	const probed = store === undefined ? undefined : store as Probed;
	// The process's start, not the module's: a module reloaded while the process runs answers
	// the same time as before, because the poll is asking whether the process restarted.
	const started = new Date(Date.now() - process.uptime() * 1000).toISOString();

	// One read that every driver answers, of a document that need not exist. Nothing of what
	// went wrong reaches the body: a driver's message can carry the connection string.
	const alive = async (): Promise<boolean> => {
		if (probed === undefined) return true;
		try {
			await probed.head('health');
			return true;
		} catch {
			return false;
		}
	};

	// What a check answered, as JSON can carry it: `null` for nothing, and `{ ok: false }` for a
	// throw or for a value JSON cannot write, so one check never costs the poll the whole body.
	const ran = async (check: Check): Promise<unknown> => {
		try {
			const value = await check();
			return JSON.stringify(value) === undefined ? null : value;
		} catch {
			return { ok: false };
		}
	};

	const answer = async (): Promise<{ status: number; headers: Record<string, string>; text: string }> => {
		const [ok, answers] = await Promise.all([alive(), Promise.all(checks.map(([, check]) => ran(check)))]);
		const held: Record<string, unknown> = {};
		checks.forEach(([name], at) => { held[name] = answers[at]; });
		const text = JSON.stringify({ ok, time: new Date().toISOString(), started, info, checks: held });
		return {
			status: ok ? 200 : 503,
			headers: {
				'content-type': 'application/json',
				'content-length': String(Buffer.byteLength(text)),
				'cache-control': 'no-store',
			},
			text,
		};
	};

	return {
		public: config.public,
		routes: {
			'GET /api/health': async () => {
				const { status, headers, text } = await answer();
				return new Response(text, { status, headers });
			},
			'HEAD /api/health': async () => {
				const { status, headers } = await answer();
				return new Response(null, { status, headers });
			},
		},
	};
};
