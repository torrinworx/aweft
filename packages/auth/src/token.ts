// A token: what a session, a verification link and a reset link are named by (designs 275, 290).
//
// Sixteen random bytes of its own, not an id: an id is twelve bytes, the width a document
// needs, and a credential needs 128 bits. Sixteen bytes are exactly twenty-two base64url
// characters with no padding.
//
// A document is named by the token's hash, never the token, so a copy of the store holds
// nothing that works as a credential (design 324). The hash is a SHA-256 in base64url,
// forty-three characters, which is how a stored name is told from a token.

import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 16;
const TOKEN = /^[A-Za-z0-9_-]{22}$/;

export const mintToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url');

/** Is this text shaped like a token this battery minted. */
export const isToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value);

/** What a token's document is named by. No salt and no key: sixteen random bytes leave nothing to guess. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('base64url');
