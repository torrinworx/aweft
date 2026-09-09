// The scheduler, as a module: it owns the array of jobs, owns the scheduler over it, and
// stops it when it is unloaded. Nothing about scheduling reaches the boot file.

import { createArray, createObject } from '@aweftjs/core';
import { createScheduler } from '@aweftjs/jobs';
import type { Job, Scheduler } from '@aweftjs/jobs';
import type { ModuleProps } from '@aweftjs/modules';

export const deps = ['app/Log'];

export const defaults = { everyMs: 20 };

export default ({ imports, config }: ModuleProps) => {
	const log = imports.Log as { note(line: string): void };
	const runs: number[] = [];
	const jobs = createArray<Job>([createObject<Job>({ name: 'digest', every: Number(config.everyMs) })]);
	const scheduler: Scheduler = createScheduler({
		jobs,
		run: (_job, { due }) => { runs.push(due); },
	});

	return {
		public: true,
		call: () => runs.length,
		stop: async () => {
			log.note('app/Digest');
			await scheduler.stop();
		},
	};
};
