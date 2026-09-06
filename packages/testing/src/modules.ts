// A module under test, through the real loader, with its dependencies stubbed.
//
// The harness builds one small bundle: the module, one stub per dependency, and an extension
// carrying the test's configuration. Then it loads through `createLoader`, so a module tested
// here is instantiated exactly the way an application instantiates it.

import { codecError } from '@aweftjs/codec';
import { createLoader, fromBundle } from '@aweftjs/modules';
import type { ModuleExports } from '@aweftjs/modules';

export interface ModuleUnderTest {
	/** The module's exports, as its file exports them. */
	readonly exports: ModuleExports;
	/** An instance for every name in `deps`, keyed by the full dependency name. */
	readonly imports?: Readonly<Record<string, unknown>>;
	/** Configuration merged over the module's `defaults`, the way an extension's would be. */
	readonly config?: Readonly<Record<string, unknown>>;
	/** Loader props, as the application would pass them. */
	readonly props?: Readonly<Record<string, unknown>>;
}

/** The instance the module produced, and the way to unload it. */
export interface LoadedModule {
	readonly instance: unknown;
	/** Unload the module, calling its `stop` if it has one. */
	stop(): Promise<void>;
}

const NAME = 'module-under-test';

/**
 * Instantiate one module the way the loader would, with its dependencies replaced by the
 * instances the test supplies.
 *
 * Params:
 *   test.exports: the module
 *   test.imports: one instance per dependency name in `exports.deps`
 *   test.config: merged over `exports.defaults`
 *   test.props: spread into the factory's props
 *
 * Returns: the instance and a `stop` that unloads it.
 *
 * Throws: `dependency-not-stubbed`, naming the dependency, when one has no entry in `imports`:
 * a test that forgot one should not get an undefined import.
 *
 * Example:
 *   const { instance, stop } = await loadModule({
 *     exports: await import('./modules/posts/Create.ts'),
 *     imports: { 'auth/Session': { userOf: () => 'u_1' } },
 *     config: { maxLength: 10 },
 *   });
 */
export const loadModule = async (test: ModuleUnderTest): Promise<LoadedModule> => {
	const stubs: Record<string, ModuleExports> = {};
	for (const dep of test.exports.deps ?? []) {
		if (test.imports === undefined || !(dep in test.imports)) {
			throw codecError(
				'dependency-not-stubbed',
				`${dep} is a dependency of the module under test and has no entry in imports`,
				'Add an entry under imports for every name the module lists in deps.',
			);
		}
		const instance = test.imports[dep];
		stubs[dep] = { default: () => instance };
	}

	const sources = [
		...(test.config === undefined ? [] : [fromBundle({ [NAME]: { config: test.config } })]),
		fromBundle({ [NAME]: test.exports, ...stubs }),
	];
	const loader = createLoader({ sources, ...(test.props === undefined ? {} : { props: test.props }) });
	const instance = (await loader.load([NAME]))[NAME];
	return { instance, stop: async () => { await loader.unload(NAME); } };
};
