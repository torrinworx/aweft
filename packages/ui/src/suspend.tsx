// Loading something, and what happens when loading it fails (design 112).
//
// `dom` already has the waiting half: a component declares a promise `pending` and a static
// render waits for it. What it has no story for is a rejection, and leaving the fallback on
// screen forever is the one answer this package will not give.

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import type { Component } from './component.ts';
import { createContext } from './contexts.ts';
import { h } from './h.ts';

/** The loading and failure components an application sets once, for everything below. */
export interface Loaders {
	/** Shown while a `suspend` is loading, when the call gave no fallback of its own. */
	readonly loading?: Component | null;
	/** Shown when a loader rejects, when the call gave no `failed` of its own. Given `{ error }`. */
	readonly failed?: Component<{ error?: unknown }> | null;
}

/**
 * The loading and failure components for everything below.
 *
 * Fields are inherited one at a time, so a provider that names only `failed` keeps whatever
 * `loading` was already in effect.
 *
 * Example:
 *   <LoaderContext value={{ loading: Spinner, failed: ErrorPanel }}>{app}</LoaderContext>
 */
export const LoaderContext = createContext<Loaders>({}, (raw, parent) =>
	({ ...parent, ...(raw as Loaders | null ?? {}) }));

/** What a loader is handed, and what it hands back. */
export type Loader<P> = (props: P, cleanup: (...fns: (() => void)[]) => void) => unknown;

/**
 * A component whose content arrives later.
 *
 * Params:
 *   fallback: what to show while the loader runs, or null to use the `LoaderContext`'s `loading`
 *   loader: called once with the component's props and its cleanup; whatever it resolves to is
 *           mounted in place of the fallback
 *   failed: what to show when the loader rejects, given `{ error }`. Omitted, the
 *           `LoaderContext`'s `failed` is used; with neither, the slot goes empty and the
 *           rejection is rethrown on a fresh task so the host reports it
 *
 * Returns: a component. It declares its promise `pending`, so a static render waits for it, and
 * a suspend removed before its loader settles mounts nothing and reports nothing.
 *
 * Example:
 *   const Article = suspend(Spinner, async ({ id }) => {
 *     const article = await fetch(`/articles/${id}`).then((r) => r.json());
 *     return <Body article={article} />;
 *   });
 */
export const suspend = <P extends Record<string, unknown>>(
	fallback: Component | null,
	loader: Loader<P>,
	failed?: Component<{ error?: unknown }> | null,
) => (
	props: P & { children?: unknown[] },
	cleanup: (...fns: (() => void)[]) => void,
	_mounted: unknown,
	pending: (promise: Promise<unknown>) => void,
): Mounter => (elem, _item, before, context) => {
	const loaders = LoaderContext.read(context);
	const waiting = fallback ?? loaders.loading ?? null;
	const shown = mutable<unknown>(waiting === null ? null : h(waiting, {}));

	let dead = false;
	cleanup(() => { dead = true; });

	// Started here rather than in the component body, so the loader sees the props the component
	// was given and the mount is already under way when it resolves.
	const promise = Promise.resolve().then(() => loader(props, cleanup));
	pending(promise);
	promise.then(
		(result) => { if (!dead) shown.set(result ?? null); },
		(error: unknown) => {
			if (dead) return;
			const onError = failed ?? loaders.failed ?? null;
			if (onError !== null) {
				shown.set(h(onError, { error }));
				return;
			}
			shown.set(null);
			// Nobody named a failure component, so nobody is going to show this. Rethrowing puts
			// it where the host already looks rather than nowhere.
			queueMicrotask(() => { throw error; });
		},
	);

	return mount(elem, shown, before, context);
};
