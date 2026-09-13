// The keeper's configuration: where the bytes go, what the site takes, and one rule of its own.
// A same-named file exporting only `config` configures the battery's module.

import { directory } from '@aweftjs/uploads';
import type { Accept } from '@aweftjs/uploads';

// A picture whose name says it should not be here is refused after its bytes arrive, the way a
// moderation call would refuse one: this is where that call goes.
const accept: Accept = async (upload) => {
	const bytes = await upload.bytes();
	if (upload.name === 'nope.png' || bytes.byteLength === 0) return { reasons: [{ code: 'not-here', message: 'this picture was refused' }] };
	return undefined;
};

export const config = {
	storage: directory(process.env.AWEFT_UPLOADS_DIR ?? 'var/uploads'),
	types: ['image/png', 'image/jpeg', 'text/csv'],
	maxBytes: { image: 200_000, default: 50_000 },
	accept,
};
