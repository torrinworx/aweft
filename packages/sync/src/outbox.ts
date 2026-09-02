// Batching what goes out, without ever dropping any of it.
//
// Frames are held until the end of the tick and then sent, and consecutive commits for one
// topic are merged into a single frame. Measured in `bench/replicate.ts` on a 1,840 commit
// stream, a frame per commit costs 15.5% over the commit bytes; sixteen to a frame costs 4.3%,
// and per-frame compression stops being a loss (116,532 bytes gzipped one at a time against
// 104,945 raw).
//
// This is batching and never rate limiting. Every commit still goes, in order, in the same
// tick it was made. A sync path that dropped one commit of a burst would leave the receiver
// holding a different document forever after, which is why core keeps `throttle` off this
// path entirely.

import type { Channel } from './channel.ts';
import type { Frame } from './frame.ts';

export interface Outbox {
	/** Queue a frame. It goes out at the end of the tick, merged where it can be. */
	send(frame: Frame): void;
	/** Send what is queued now. */
	flush(): void;
}

/** Can this commits frame carry the next one's commits too? */
const follows = (held: Frame, next: Frame): held is Frame & { kind: 'commits' } =>
	held.kind === 'commits' && next.kind === 'commits'
	&& held.topic === next.topic
	&& held.first + held.commits.length === next.first;

export const outbox = (channel: Channel): Outbox => {
	const queued: Frame[] = [];
	let scheduled = false;

	const flush = (): void => {
		scheduled = false;
		while (queued.length > 0) channel.send(queued.shift()!);
	};

	return {
		send: (frame) => {
			const held = queued[queued.length - 1];
			if (held !== undefined && follows(held, frame) && frame.kind === 'commits') {
				queued[queued.length - 1] = {
					kind: 'commits', topic: held.topic, first: held.first,
					commits: [...held.commits, ...frame.commits],
				};
			} else {
				queued.push(frame);
			}

			if (scheduled) return;
			scheduled = true;
			queueMicrotask(() => { if (scheduled) flush(); });
		},
		flush,
	};
};
