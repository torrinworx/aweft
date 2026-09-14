// A token: what a session, a verification link and a reset link are named by (designs 275, 290).
//
// Sixteen random bytes of its own, not an id: an id is twelve bytes, the width a document
// needs, and a credential needs 128 bits. Sixteen bytes are exactly twenty-two base64url
// characters with no padding.

import { randomBytes } from 'node:crypto';

const TOKEN_BYTES = 16;
const TOKEN = /^[A-Za-z0-9_-]{22}$/;

export const mintToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url');

/** Is this text shaped like a token this battery minted. */
export const isToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value);
