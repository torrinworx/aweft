// The first bytes of each type the table knows, and the types it does not (design 262).

import test from 'node:test';
import assert from 'node:assert/strict';

import { SNIFF_BYTES, matches } from '../src/sniff.ts';

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
const head = (...parts: (number[] | number)[]): Uint8Array => new Uint8Array(parts.flatMap((p) => (typeof p === 'number' ? [p] : p)).concat(new Array(4).fill(0)));

const right: [string, Uint8Array][] = [
	['image/png', head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
	['image/jpeg', head([0xff, 0xd8, 0xff, 0xe1])],
	['image/gif', head(ascii('GIF89a'))],
	['image/gif', head(ascii('GIF87a'))],
	['image/webp', head(ascii('RIFF'), [1, 2, 3, 4], ascii('WEBP'))],
	['application/pdf', head(ascii('%PDF-1.7'))],
	['video/mp4', head([0, 0, 0, 0x18], ascii('ftypisom'))],
	['audio/mp4', head([0, 0, 0, 0x18], ascii('ftypM4A '))],
	['video/quicktime', head([0, 0, 0, 0x14], ascii('ftypqt  '))],
	['video/webm', head([0x1a, 0x45, 0xdf, 0xa3])],
	['audio/webm', head([0x1a, 0x45, 0xdf, 0xa3])],
	['video/ogg', head(ascii('OggS'))],
	['audio/ogg', head(ascii('OggS'))],
	['audio/mpeg', head(ascii('ID3'))],
	['audio/mpeg', head([0xff, 0xfb, 0x90])],
	['audio/mpeg', head([0xff, 0xf3, 0x90])],
	['audio/wav', head(ascii('RIFF'), [1, 2, 3, 4], ascii('WAVE'))],
	['audio/x-wav', head(ascii('RIFF'), [1, 2, 3, 4], ascii('WAVE'))],
	['audio/wave', head(ascii('RIFF'), [1, 2, 3, 4], ascii('WAVE'))],
	['audio/flac', head(ascii('fLaC'))],
];

for (const [type, bytes] of right) {
	test(`${type} matches its own first bytes`, () => { assert.equal(matches(type, bytes), true); });
}

test('every known type refuses HTML, an empty file, and each other\'s bytes', () => {
	const html = new Uint8Array(ascii('<!doctype html>'));
	for (const [type, bytes] of right) {
		assert.equal(matches(type, html), false, `${type} against html`);
		assert.equal(matches(type, new Uint8Array(0)), false, `${type} against nothing`);
		for (const [other, otherBytes] of right) {
			if (other === type) continue;
			const shared = (a: string, b: string): boolean => {
				const family = (t: string): string => (/mp4|quicktime/.test(t) ? 'ftyp' : /webm/.test(t) ? 'ebml' : /ogg/.test(t) ? 'ogg' : /wav/.test(t) ? 'wav' : t);
				return family(a) === family(b);
			};
			if (shared(type, other)) continue;
			assert.equal(matches(type, otherBytes), false, `${type} against ${other}`);
		}
		void bytes;
	}
});

test('a wav is not a webp and a webp is not a wav, though both begin RIFF', () => {
	assert.equal(matches('audio/wav', head(ascii('RIFF'), [1, 2, 3, 4], ascii('WEBP'))), false);
	assert.equal(matches('image/webp', head(ascii('RIFF'), [1, 2, 3, 4], ascii('WAVE'))), false);
});

test('a frame sync with a reserved layer is not an mpeg audio', () => {
	assert.equal(matches('audio/mpeg', head([0xff, 0xf9])), false);
	assert.equal(matches('audio/mpeg', head([0xff, 0x7b])), false);
});

test('a type the table does not know is taken as declared', () => {
	assert.equal(matches('text/csv', new Uint8Array(ascii('a,b'))), true);
	assert.equal(matches('model/gltf-binary', new Uint8Array(0)), true);
});

test('twelve bytes are enough for every match', () => {
	assert.equal(SNIFF_BYTES, 12);
	for (const [type, bytes] of right) assert.equal(matches(type, bytes.subarray(0, SNIFF_BYTES)), true, type);
});
