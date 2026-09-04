// The tools, and nothing that decides for the application (design 063).
//
// A loader is an instance. It reads candidates from its sources when asked, instantiates what
// it is asked to and what that needs, and lets go of what it is asked to let go of. Which
// modules, when, how many and for how long are the caller's.

import type { Candidate, ModuleProps, Source } from './contract.ts';
import { modulesError } from './contract.ts';
import { type Definition, order, resolve } from './graph.ts';

/**
 * A loader: the loaded graph and the tools that change it.
 *
 * Every method is about this loader alone. Two loaders share nothing.
 */
export interface Loader {
	/**
	 * Instantiate these modules and whatever they depend on, in dependency order, and hand
	 * back the named instances.
	 *
	 * Params:
	 *   names: the modules wanted, by name
	 *
	 * Returns: the named instances, keyed by name. A module already loaded is handed back as
	 * it is; its factory does not run again.
	 *
	 * Throws a `ModulesError` when a name is in no source (`missing`), has only configuration
	 * (`no-implementation`), sits in a dependency cycle (`cycle`), needs two dependencies whose
	 * names end the same way (`ambiguous-import`), or whose factory threw (`failed`, with the
	 * cause). Whatever was instantiated before the failure stays loaded.
	 *
	 * Example:
	 *   const { 'auth/Session': session } = await loader.load(['auth/Session']);
	 */
	load(names: readonly string[]): Promise<Readonly<Record<string, unknown>>>;

	/**
	 * Let go of one module.
	 *
	 * Params:
	 *   name: the module
	 *
	 * Returns: true when it was loaded, false when there was nothing to unload.
	 *
	 * If the instance has a `stop` function it is called and awaited first. Exactly this module
	 * is unloaded: a loaded module that depends on it keeps the reference it was handed. Ask
	 * `dependents` first if that matters to you.
	 *
	 * Example:
	 *   for (const name of loader.dependents('auth/Session')) await loader.unload(name);
	 *   await loader.unload('auth/Session');
	 */
	unload(name: string): Promise<boolean>;

	/** The names loaded right now, in the order their factories finished, which is always a dependency order. */
	loaded(): readonly string[];

	/** The instance of a loaded module, or undefined. */
	get(name: string): unknown;

	/** The direct dependencies a loaded module declared, or undefined when it is not loaded. */
	dependencies(name: string): readonly string[] | undefined;

	/** The loaded modules that depend directly on this one, in the order their factories finished. */
	dependents(name: string): readonly string[];
}

interface Held {
	readonly instance: unknown;
	readonly deps: readonly string[];
}

/**
 * Make a loader.
 *
 * Params:
 *   sources: where modules come from, in order of precedence; the first source with an
 *     implementation of a name wins, and every source's configuration for it contributes
 *   props: spread into every factory's props, under `imports`, `config` and `extensions`
 *
 * Returns: a loader with nothing loaded.
 *
 * Example:
 *   const loader = createLoader({ sources: [fromDirectory('./modules'), fromDocument(plugins)] });
 *   await loader.load(['posts/Create']);
 */
export const createLoader = (
	{ sources, props = {} }: { sources: readonly Source[]; props?: Readonly<Record<string, unknown>> },
): Loader => {
	const held = new Map<string, Held>();
	// A module being instantiated, so two loads asking for it at once build it once.
	const pending = new Map<string, Promise<unknown>>();

	/** Every candidate of every source, by name, in precedence order. Lists; evaluates nothing. */
	const listAll = async (): Promise<Map<string, Candidate[]>> => {
		const byName = new Map<string, Candidate[]>();
		for (const source of sources) {
			// Precedence is between sources, not within one. Two candidates with one name in a
			// single source (thing.js beside thing.ts) would shadow each other in silence.
			const seen = new Set<string>();
			for (const candidate of await source.candidates()) {
				if (seen.has(candidate.name)) {
					throw modulesError('duplicate', candidate.name, `${candidate.name} appears twice in one source`);
				}
				seen.add(candidate.name);
				let list = byName.get(candidate.name);
				if (list === undefined) byName.set(candidate.name, (list = []));
				list.push(candidate);
			}
		}
		return byName;
	};

	const importsFor = (definition: Definition): Record<string, unknown> => {
		const imports: Record<string, unknown> = {};
		for (const dep of definition.deps) {
			const short = dep.slice(dep.lastIndexOf('/') + 1);
			if (short in imports) {
				throw modulesError(
					'ambiguous-import', definition.name,
					`${definition.name} depends on two modules named ${short}; imports are keyed by the last segment`,
				);
			}
			const instance = held.get(dep);
			if (instance === undefined) {
				// Unreachable through `load`, which orders dependencies first; kept as a loud stop
				// rather than an undefined import.
				throw modulesError('missing', definition.name, `${definition.name} needs ${dep}, which is not loaded`);
			}
			imports[short] = instance.instance;
		}
		return imports;
	};

	const instantiate = async (definition: Definition): Promise<unknown> => {
		const moduleProps: ModuleProps = {
			...props,
			imports: importsFor(definition),
			config: definition.config,
			extensions: definition.extensions,
		};
		let instance: unknown;
		try {
			instance = await definition.factory(moduleProps);
		} catch (error) {
			throw modulesError('failed', definition.name, `${definition.name} failed to load: ${String((error as Error)?.message ?? error)}`, error);
		}
		held.set(definition.name, { instance, deps: definition.deps });
		return instance;
	};

	const load = async (names: readonly string[]): Promise<Readonly<Record<string, unknown>>> => {
		const all = await listAll();

		// Settle the closure of what is wanted and not yet loaded.
		const definitions = new Map<string, Definition>();
		const work = [...names];
		while (work.length > 0) {
			const name = work.pop()!;
			if (held.has(name) || definitions.has(name)) continue;
			const definition = await resolve(name, all.get(name) ?? []);
			definitions.set(name, definition);
			for (const dep of definition.deps) work.push(dep);
		}

		for (const name of order(definitions)) {
			if (held.has(name)) continue;
			let building = pending.get(name);
			if (building === undefined) {
				building = instantiate(definitions.get(name)!).finally(() => pending.delete(name));
				pending.set(name, building);
			}
			await building;
		}

		const out: Record<string, unknown> = {};
		for (const name of names) {
			// A factory is user code and may have unloaded a sibling while this load was running.
			const found = held.get(name);
			if (found === undefined) {
				throw modulesError('missing', name, `${name} was unloaded while it was being loaded`);
			}
			out[name] = found.instance;
		}
		return out;
	};

	const unload = async (name: string): Promise<boolean> => {
		const was = held.get(name);
		if (was === undefined) return false;
		held.delete(name);
		const instance = was.instance;
		if (instance !== null && (typeof instance === 'object' || typeof instance === 'function')) {
			const stop = (instance as { stop?: unknown }).stop;
			if (typeof stop === 'function') await (stop as () => unknown).call(instance);
		}
		return true;
	};

	return {
		load,
		unload,
		loaded: () => [...held.keys()],
		get: (name) => held.get(name)?.instance,
		dependencies: (name) => held.get(name)?.deps,
		dependents: (name) => [...held.entries()].filter(([, h]) => h.deps.includes(name)).map(([n]) => n),
	};
};
