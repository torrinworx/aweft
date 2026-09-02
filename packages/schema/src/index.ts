export { ANY, REST, SELF } from './pattern.ts';
export type { Pattern, PatternStep } from './pattern.ts';

export { createIndex, pathOf, record } from './document.ts';
export type { DocumentIndex } from './document.ts';

export { checkPolicy, validate } from './validate.ts';
export type { Actor, Context, Policy, Reason, Rule, Verdict } from './validate.ts';

// The types this package's own signatures take and hand back, so a caller can type a
// validation pipeline without importing below it.
export type { Commit, Delta, DeltaType } from '@aweftjs/codec';
