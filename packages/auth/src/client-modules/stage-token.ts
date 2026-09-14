// The token a link put in the URL, as the two link acts read it (design 290).

import type { StageValue } from '@aweftjs/ui';

/** The token the URL carries, from the act's own parameter first and the query second. */
export const tokenOf = (stage: StageValue | undefined): string | undefined => {
	const named = stage?.params.get().token;
	if (typeof named === 'string' && named !== '') return named;
	const queried = stage?.query.get().token;
	return typeof queried === 'string' && queried !== '' ? queried : undefined;
};
