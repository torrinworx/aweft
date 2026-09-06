// Where an input event goes: a context an application listens on, rather than a prop threaded
// through every component that might fire one.

import { createContext } from './contexts.ts';

/** What an application puts on the context. */
export interface Input {
	/** Merged down the tree and attached to every event, so a page tags everything inside it once. */
	readonly meta?: Readonly<Record<string, unknown>>;
	/** Called for every event, whatever its type. */
	readonly on?: (event: Record<string, unknown>) => void;
	/** `onClick`, `onSlide` and so on: called after `on`, for that type only. */
	readonly [handler: string]: unknown;
}

const capitalised = (type: string): string => `on${type[0]?.toUpperCase() ?? ''}${type.slice(1)}`;

/**
 * The input handlers and the metadata for everything below.
 *
 * `meta` merges one level deeper than the rest, so a page adds a tag without replacing the tags
 * above it.
 *
 * Example:
 *   <InputContext value={{ meta: { page: 'home' }, on: (e) => analytics.send(e) }}>{app}</InputContext>
 */
export const InputContext = Object.assign(
	createContext<Input>({}, (raw, parent) => {
		const given = (raw ?? {}) as Input;
		return { ...parent, ...given, meta: { ...parent.meta, ...given.meta } };
	}),
	{
		/**
		 * Fire one input event at whoever is listening.
		 *
		 * Params:
		 *   context: the opaque context `dom` handed the mounter
		 *   type: the event's name, `click` or `slide`
		 *   payload: what the component knows about it
		 *
		 * Returns: nothing. The generic `on` runs first, then `on<Type>`, so one handler can catch
		 * every type without listing them. The application's `meta` is applied last, so a page can
		 * override a field a component happened to name the same thing.
		 *
		 * Example:
		 *   InputContext.fire(context, 'click', { component: 'Button', label });
		 */
		fire: (context: unknown, type: string, payload: Record<string, unknown> = {}): void => {
			const input = InputContext.read(context);
			const event = { type, ...payload, ...input.meta };
			input.on?.(event);
			const specific = input[capitalised(type)];
			if (typeof specific === 'function') (specific as (e: Record<string, unknown>) => void)(event);
		},
	},
);
