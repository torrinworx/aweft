// Configuration for a module this application did not write. No factory here, so the battery's
// `health/Check` is still the implementation: this file says what the application adds to the
// answer, and it wins because this source comes ahead of the battery.

import { readFile } from 'node:fs/promises';

interface BackupStatus {
	readonly ok: boolean;
	readonly at: number;
}

export const config = {
	// The hash the release was built from, written into the environment by the deploy.
	info: { build: process.env.BUILD_SHA ?? null },
	checks: {
		// Where the nightly dump leaves its result. A backup that stops happening is invisible from
		// every other angle, and this endpoint is the one thing reachable from off the box.
		backup: async () => {
			const status = JSON.parse(await readFile(process.env.BACKUP_STATUS ?? 'backup-status.json', 'utf8')) as BackupStatus;
			return { ok: status.ok, ageHours: Math.round((Date.now() - status.at) / 36e5) };
		},
	},
};
