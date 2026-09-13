// The message parser's cache: one parse per source, which is what lets a token written once and
// mounted a thousand times parse once (design 278). White-box, so it reads the parser directly.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMessage } from '../src/message.ts';

test('a message parses once per source, and the same source answers the same parts', () => {
	const source = '{n, plural, one {# item} other {# items}}';
	const first = parseMessage(source);
	assert.equal(parseMessage(source), first, 'the cached parts, not a second parse');
	assert.notEqual(parseMessage(`${source} `), first, 'a different source is a different parse');
});
