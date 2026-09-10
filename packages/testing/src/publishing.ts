// What a manifest has to say before the package can go to a registry (design 256).
//
// A package on npm ships compiled JavaScript, because Node refuses to strip types from a file
// under `node_modules`. A checkout runs the TypeScript as it stands. One `exports` map serves
// both, and every part of that arrangement is a line in a manifest that is easy to leave out and
// impossible to notice until a publish is already done. This is the check that notices.
//
// It reads manifests and nothing else. Whether the compiled output exists, and whether it runs,
// is what building and installing the package answer.

/** The publishing-relevant part of one package.json. */
export interface PublishManifest {
	readonly name: string;
	readonly version?: string | undefined;
	readonly private?: boolean | undefined;
	readonly engines?: Readonly<{ node?: string | undefined }> | undefined;
	readonly files?: readonly string[] | undefined;
	readonly exports?: Readonly<Record<string, string | Readonly<Record<string, string>>>> | undefined;
	readonly dependencies?: Readonly<Record<string, string>> | undefined;
	readonly peerDependencies?: Readonly<Record<string, string>> | undefined;
	readonly publishConfig?: Readonly<{ access?: string | undefined }> | undefined;
	readonly scripts?: Readonly<Record<string, string>> | undefined;
}

/** The condition a checkout and a submodule application ask for the source by. */
const SOURCE = 'aweft-source';

const conditionsOf = (entry: string | Readonly<Record<string, string>>): Readonly<Record<string, string>> | null =>
	typeof entry === 'string' ? null : entry;

/**
 * Every way a set of manifests would publish something other than what design 256 describes.
 *
 * Params:
 *   manifests: the packages' manifests, as `package.json` holds them
 *
 * Returns: one line per violation, naming the package and what is wrong, empty when clean. The
 * version check compares the manifests against each other rather than against a constant, because
 * the packages version in lockstep and no file is the record of which version that is.
 *
 * Example:
 *   const violations = checkPublishing([JSON.parse(readFileSync('packages/core/package.json', 'utf8'))]);
 */
export const checkPublishing = (manifests: readonly PublishManifest[]): string[] => {
	const violations: string[] = [];
	const versions = new Set(manifests.map((manifest) => manifest.version));

	for (const manifest of manifests) {
		const say = (said: string): void => { violations.push(`${manifest.name} ${said}`); };

		if (manifest.private === true) say('is private, so it can never be published');
		if (manifest.version === undefined) say('declares no version');
		else if (versions.size > 1) say(`is version ${manifest.version}, and the packages do not all agree`);

		if (manifest.publishConfig?.access !== 'public') {
			say('does not set publishConfig.access to public, so a scoped publish is refused as private');
		}

		if (!(manifest.files ?? []).includes('dist')) {
			say('does not name dist in files, so the compiled output would not ship');
		}

		// The stack runs on a Node new enough to strip types and to have the flags the sandbox
		// spawns a room with. Without this field an install on an older one is silent, and what the
		// consumer gets is a syntax error somewhere inside a dependency.
		if (manifest.engines?.node === undefined) {
			say('declares no engines.node, so an install on an older Node warns about nothing');
		}

		if (manifest.scripts?.prepack === undefined) {
			say('has no prepack script, so a pack could carry a stale dist or none');
		}

		for (const [subpath, entry] of Object.entries(manifest.exports ?? {})) {
			const conditions = conditionsOf(entry);
			if (conditions === null) {
				say(`exports ${subpath} as one file, which serves a checkout or a consumer but not both`);
				continue;
			}
			for (const required of [SOURCE, 'types', 'default']) {
				if (conditions[required] === undefined) say(`exports ${subpath} without a ${required} condition`);
			}
			const source = conditions[SOURCE];
			const types = conditions.types;
			const fallback = conditions.default;
			if (source !== undefined && !source.startsWith('./src/')) {
				say(`exports ${subpath} with an ${SOURCE} outside src/`);
			}
			if (types !== undefined && !types.startsWith('./dist/')) say(`exports ${subpath} with types outside dist/`);
			if (fallback !== undefined && !fallback.startsWith('./dist/')) {
				say(`exports ${subpath} with a default outside dist/`);
			}
			// The conditions are tried in order, so a `default` before `aweft-source` would answer
			// first and the source condition would never be reached.
			if (Object.keys(conditions)[0] !== SOURCE) say(`exports ${subpath} without ${SOURCE} first`);
		}

		for (const group of [manifest.dependencies, manifest.peerDependencies]) {
			for (const [dependency, range] of Object.entries(group ?? {})) {
				if (!dependency.startsWith('@aweftjs/')) continue;
				if (range === '*' || range === '') {
					say(`depends on ${dependency} at "${range}", which on a registry means any version`);
				}
			}
		}
	}
	return violations;
};
