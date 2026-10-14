// What a component is, as a `ui` page writes one.
//
// The same shape `dom` describes, with one difference: `children` is optional in the type. JSX
// children reach `h` as its rest arguments rather than as a prop, so the compiler never sees one
// written, and `h` fills the array in before the body runs.

import type { Cleanup, Mounted, Pending } from '@aweftjs/dom';

/**
 * A component: called once with its props, and what it returns is mounted.
 *
 * It is written as a method, because TypeScript checks a method's parameter in both directions.
 * That way a component that declares props of its own, such as an act's `stage`, fits where any
 * component goes (design 308).
 */
export type Component<P = Record<string, unknown>> = {
	component(props: P & { children?: unknown[]; each?: unknown }, cleanup: Cleanup, mounted: Mounted, pending: Pending): unknown;
}['component'];
