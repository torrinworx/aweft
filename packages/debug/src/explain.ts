// One way in.
//
// A reader holding something they do not understand should not first have to work out which
// reader to call. `explain` takes whatever they have and dispatches; the specific readers stay
// exported for when the answer is already known.

import type { Commit } from '@aweftjs/codec';

import type { Described } from './described.ts';
import { commitOf } from './commit.ts';
import { documentOf } from './document.ts';
import { render, value as renderValue } from './render.ts';

const isCommit = (v: unknown): v is Commit =>
	typeof v === 'object' && v !== null && Array.isArray((v as Commit).deltas);

const isRefusal = (v: unknown): v is Error & { reason: string; fix?: string } =>
	v instanceof Error && typeof (v as { reason?: unknown }).reason === 'string';

/** What a document throws when a rule the application wrote refused a commit. */
interface Refused extends Error {
	readonly refusals: readonly { code: string; message: string; path?: readonly string[] }[];
}

// A guarded document throws this, not a refusal from the library, so it is the error a reader
// meets most and the one that carries no `fix`: the reasons in it were written by application
// code. Laying them out is all this can do, and it is what the reader needs.
const isRefused = (v: unknown): v is Refused =>
	v instanceof Error && Array.isArray((v as { refusals?: unknown }).refusals);

const refusedOf = (e: Refused): Described => ({
	kind: 'refused',
	facts: [['refusals', e.refusals.length]],
	children: e.refusals.map((r) => ({
		kind: 'refusal',
		id: r.code,
		facts: r.path === undefined || r.path.length === 0
			? [['message', r.message]]
			: [['at', r.path.join('.')], ['message', r.message]],
	})),
});

const refusalOf = (e: Error & { reason: string; fix?: string }): Described => ({
	kind: 'refusal',
	id: e.reason,
	facts: e.fix === undefined ? [['message', e.message]] : [['message', e.message], ['fix', e.fix]],
});

/**
 * Whatever you are holding, as text.
 *
 * Params:
 *   subject: an observable, a commit, or either kind of refusal this stack throws
 *   document: optional, the document a commit landed in, so its ids become paths
 *
 * Returns: lines a person or an agent reads. Never throws: something it cannot describe comes
 * back saying so, because a debug call that fails leaves its reader worse off than before.
 *
 * Example:
 *   try { doc.count = 'text'; } catch (e) { console.log(explain(e)); }
 */
export const explain = (subject: unknown, document?: unknown): string => {
	try {
		if (isCommit(subject)) return render(commitOf(subject, document));
		if (isRefused(subject)) return render(refusedOf(subject));
		if (isRefusal(subject)) return render(refusalOf(subject));

		// Last, because it is the one that decides by trying: an observable is a proxy and
		// there is no test for one short of asking core.
		return render(documentOf(subject));
	} catch {
		return render({
			kind: 'not described',
			facts: [
				['value', renderValue(subject)],
				['why', 'nothing in this stack claims it, and it carries no describe hook'],
			],
		});
	}
};
