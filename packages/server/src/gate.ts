// The trusted case, at both seams. One explicit word, so trust is never the default: a link a
// module shares on a connection requires `accept`, and a server requires a gate (design 071).

import type { Accepting, Gate } from './contract.ts';

/**
 * Everyone, everything, every commit.
 *
 * As a gate, it identifies every caller with an empty context and allows every module: the
 * microservice that knows nothing about users types `gate: open`, and that one word is what
 * to grep for. As share handlers, it accepts every commit: `link.share('doc', doc, open)`.
 *
 * Example:
 *   const server = createServer({ loader, gate: open, listener: node({ port: 8080 }) });
 */
export const open: Gate<Record<string, never>> & Accepting = {
	identify: () => ({ context: {} }),
	access: () => [],
	accept: () => [],
};
