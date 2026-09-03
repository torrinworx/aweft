// The one helper that acts on its own, and only because you asked it to (design 063,
//).

import { observer } from '@aweftjs/core';

import { entryNames, sourceOf } from './document.ts';
import type { Loader } from './loader.ts';

export interface FollowHandlers {
	/**
	 * Called when a reload fails, with the module that failed and what it threw. Without a
	 * handler the failure is raised where nothing catches it, on purpose.
	 */
	readonly failed?: ((name: string, error: unknown) => void) | undefined;
	/**
	 * Called after a change has been applied: the named module and its dependents were loaded
	 * again (`reloaded`), or unloaded because its entry left the document (`unloaded`). This is
	 * how a caller knows the loader has caught up with an edit, without polling it.
	 */
	readonly applied?: ((name: string, action: 'reloaded' | 'unloaded') => void) | undefined;
}

/**
 * Keep a loader's loaded modules matching a document.
 *
 * Params:
 *   loader: the loader whose loaded modules follow the document
 *   document: the same object handed to `fromDocument`
 *   handlers.failed: where a reload failure goes
 *   handlers.applied: told when a reload or an unload has finished, by module name
 *
 * Returns: the function that stops following.
 *
 * While following: a loaded module whose entry's `source` changes is unloaded and loaded
 * again, together with the loaded modules that depend on it, dependents first on the way out
 * and dependency order on the way back. A loaded module whose entry is removed is unloaded
 * together with its loaded dependents. A change to any other field of an entry, or to an
 * entry nothing has loaded, does nothing. Reloads run one at a time, in the order the changes
 * landed, and `applied` hears each one as it finishes.
 *
 * Example:
 *   const stop = follow(loader, plugins, {
 *     failed: (name, error) => log.warn(name, error),
 *     applied: (name, action) => log.info(`${name} ${action}`),
 *   });
 */
export const follow = (loader: Loader, document: object, handlers: FollowHandlers = {}): (() => void) => {
	// The source each entry had after the last commit. A module loaded between two commits was
	// compiled from what the document held then, which is what this remembers.
	const seen = new Map<string, string>();
	const remember = (): void => {
		seen.clear();
		for (const name of entryNames(document)) seen.set(name, sourceOf(document, name)!);
	};
	remember();

	/** A module and every loaded module that depends on it, however indirectly. */
	const closureOf = (name: string): string[] => {
		const out = new Set<string>([name]);
		for (const at of out) for (const dependent of loader.dependents(at)) out.add(dependent);
		// Reverse instantiation order is a reverse dependency order, because a module is always
		// instantiated after everything it depends on.
		const position = new Map(loader.loaded().map((n, i) => [n, i]));
		return [...out].sort((a, b) => (position.get(b) ?? -1) - (position.get(a) ?? -1));
	};

	// Without a handler the error is thrown from a fresh microtask, where nothing catches it and
	// the process reports it as uncaught. A handler that throws is treated the same way, so a
	// broken handler cannot silence the failure it was told about.
	const raise = (error: unknown): void => queueMicrotask(() => { throw error; });
	const report = (name: string, error: unknown): void => {
		if (handlers.failed === undefined) { raise(error); return; }
		try { handlers.failed(name, error); } catch (thrown) { raise(thrown); }
	};

	/** Unload every member, letting a `stop` that throws stop only itself. Answers the first throw. */
	const unloadAll = async (members: readonly string[]): Promise<{ threw: boolean; error: unknown }> => {
		let threw = false;
		let error: unknown;
		for (const member of members) {
			try { await loader.unload(member); } catch (thrown) { if (!threw) { threw = true; error = thrown; } }
		}
		return { threw, error };
	};

	// Every unit of work catches its own failure, so the queue itself never rejects: a module
	// whose `stop` throws, or a handler that throws, costs that one change and not the follow.
	let queue: Promise<void> = Promise.resolve();
	const settle = (changed: string[], removed: string[]): void => {
		queue = queue.then(async () => {
			for (const name of removed) {
				const gone = await unloadAll(closureOf(name));
				if (gone.threw) { report(name, gone.error); continue; }
				try { handlers.applied?.(name, 'unloaded'); } catch (thrown) { report(name, thrown); }
			}
			for (const name of changed) {
				const members = closureOf(name);
				const gone = await unloadAll(members);
				try {
					await loader.load(members);
				} catch (error) {
					report(name, error);
					continue;
				}
				if (gone.threw) { report(name, gone.error); continue; }
				try { handlers.applied?.(name, 'reloaded'); } catch (thrown) { report(name, thrown); }
			}
		});
	};

	return observer(document).watch(() => {
		const changed: string[] = [];
		const removed: string[] = [];
		for (const name of loader.loaded()) {
			const was = seen.get(name);
			if (was === undefined) continue;                  // not a module from this document
			const now = sourceOf(document, name);
			if (now === undefined) removed.push(name);
			else if (now !== was) changed.push(name);
		}
		remember();
		if (changed.length > 0 || removed.length > 0) settle(changed, removed);
	});
};
