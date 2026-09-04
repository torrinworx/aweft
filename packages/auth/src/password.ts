// Passwords: hashed with Node's own scrypt, compared with Node's own `timingSafeEqual`
// (design 074). No test here measures the comparison's timing; the claim is which function
// is called, and that is all.
//
// The stored text carries the parameters and the salt beside the hash, so a later change of
// parameters is a re-hash on the next sign-in and never a migration.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Node's own defaults for scrypt, written into every hash so they can change.
const COST = 16384;
const BLOCK = 8;
const PARALLEL = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

const derive = (password: string, salt: Buffer, N: number, r: number, p: number, length: number): Promise<Buffer> =>
	new Promise((done, fail) => {
		scrypt(password, salt, length, { N, r, p, maxmem: 128 * N * r * 2 }, (error, key) => (error ? fail(error) : done(key)));
	});

/** The text to store for a password. Never the password. */
export const hashPassword = async (password: string): Promise<string> => {
	const salt = randomBytes(SALT_BYTES);
	const key = await derive(password, salt, COST, BLOCK, PARALLEL, KEY_BYTES);
	return ['scrypt', COST, BLOCK, PARALLEL, salt.toString('base64url'), key.toString('base64url')].join('$');
};

/** Does the password match the stored text? False, never a throw, for text that is not a hash. */
export const verifyPassword = async (password: string, stored: unknown): Promise<boolean> => {
	if (typeof stored !== 'string') return false;
	const [kind, N, r, p, salt, hash] = stored.split('$');
	if (kind !== 'scrypt' || salt === undefined || hash === undefined) return false;
	const expected = Buffer.from(hash, 'base64url');
	if (expected.length === 0) return false;
	let key: Buffer;
	try {
		key = await derive(password, Buffer.from(salt, 'base64url'), Number(N), Number(r), Number(p), expected.length);
	} catch {
		return false;
	}
	return key.length === expected.length && timingSafeEqual(key, expected);
};
