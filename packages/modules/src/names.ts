// One rule for turning a path into a module name, shared by every source that reads paths.

import { modulesError } from './contract.ts';

/**
 * The module name a path stands for: without `prefix` (or a leading `./`), and without its
 * last extension. Refuses a path that leaves no name, because an empty name would load and be
 * addressable and mean nothing.
 */
export const nameOfPath = (path: string, prefix?: string): string => {
	const trimmed = prefix !== undefined && path.startsWith(prefix)
		? path.slice(prefix.length)
		: path.replace(/^\.\//, '');
	const name = trimmed.replace(/\.[^./]+$/, '');
	if (name === '') {
		throw modulesError(
			'invalid-name', path, `${path} leaves no module name once its extension is removed`,
			'Give the file a name before its extension.',
		);
	}
	return name;
};
