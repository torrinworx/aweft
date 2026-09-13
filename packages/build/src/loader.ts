// The Node hooks that let this repo run its own `.tsx`, and name an icon the way a bundle does.
//
// Node strips types and refuses JSX, so a `.tsx` file cannot be imported as it stands. `load`
// reads the file, runs the same `transform` a bundler runs, and hands the result back as
// TypeScript, which Node then strips as it does every other file here (design 110).
//
// `resolve` answers the imports that transform writes. `@aweftjs/icons/<set>/<name>` and its two
// neighbours are modules nobody wrote, and this is the other half of what the bundler plugin
// does, so a page rendered in Node and the same page in a bundle name an icon the same way
// (design 141). Their URLs carry their own scheme, and `load` below builds their source.
//
// Registered with `--import @aweftjs/build/loader`. Nothing imports it as a module.

import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

import { codecError } from '@aweftjs/codec';

import { iconRequest } from './icons.ts';
import { type TransformOptions, transform } from './transform.ts';

/** The scheme a generated icon module answers under. Nothing on disk has it. */
const SCHEME = 'aweft-icons:';

interface LoadResult {
	format?: string;
	source?: string | Uint8Array;
	shortCircuit?: boolean;
	responseURL?: string;
}

type NextLoad = (url: string, context: unknown) => Promise<LoadResult>;

interface ResolveResult {
	url: string;
	format?: string | null | undefined;
	shortCircuit?: boolean;
}

type NextResolve = (specifier: string, context: unknown) => Promise<ResolveResult>;

/**
 * Node's `resolve` hook: claim an icon import, leave everything else to the chain.
 *
 * Params:
 *   specifier: the import as it was written
 *   context: what Node hands the hook; `parentURL` is the file that wrote the import
 *   nextResolve: the rest of the chain
 *
 * Returns: for `@aweftjs/icons/<set>`, `@aweftjs/icons/<set>/<name>` and
 * `@aweftjs/icons/<set>/+standard`, a URL under this file's own scheme carrying the request and
 * the directory to resolve the set from. For anything else, whatever the rest of the chain says,
 * which is what the package's two real entries get, and what a specifier the generator does not
 * recognise as a request gets.
 *
 * Example:
 *   import check from '@aweftjs/icons/lucide/check';
 */
export const resolve = async (
	specifier: string,
	context: unknown,
	nextResolve: NextResolve,
): Promise<ResolveResult> => {
	const request = iconRequest(specifier);
	const parent = (context as { parentURL?: string }).parentURL;
	// A file URL is what says where to resolve the set from. Without one there is nothing to
	// resolve against, so the import goes to the chain and fails where it was written.
	if (request === null || parent === undefined || !parent.startsWith('file:')) {
		return await nextResolve(specifier, context);
	}
	const from = dirname(fileURLToPath(parent));
	const { moduleFor } = await import('@aweftjs/icons/node');
	// A request the generator does not recognise is not an icon import at all, so it goes back to
	// the chain and resolves the ordinary way. A set or a name it does recognise but cannot find
	// is a refusal, and that one is `load`'s to raise, where the module has a name.
	let known = true;
	try {
		known = moduleFor(request, from) !== null;
	} catch {
		// Claimed, so `load` asks again and refuses there.
	}
	if (!known) return await nextResolve(specifier, context);
	const url = `${SCHEME}${encodeURIComponent(request)}?from=${encodeURIComponent(from)}`;
	return { url, format: 'module', shortCircuit: true };
};

/**
 * The environment variable a Node process names `defaultH` in.
 *
 * A bundler takes the setting as a plugin option. `--import` is a flag with nowhere to hang one,
 * so the environment is the only place a process can put it, and it is what makes a server render
 * and a bundle compile one file the same way (design 147).
 */
const SETTING = 'AWEFT_DEFAULT_H';

const PACKAGES = ['@aweftjs/dom', '@aweftjs/ui'];

/** The `defaultH` this process asked for, checked, or nothing when it asked for none. */
const settingOf = (): TransformOptions['defaultH'] | undefined => {
	const named = process.env[SETTING];
	if (named === undefined || named === '') return undefined;
	if (!PACKAGES.includes(named)) {
		throw codecError('unknown-default-h', `${SETTING}=${named}`,
			'Set it to @aweftjs/dom or @aweftjs/ui, or leave it unset to compile a file with no h of its own against dom.');
	}
	return named as TransformOptions['defaultH'];
};

/**
 * The environment variable a Node process turns the text pass on with (design 277), for the
 * same reason `AWEFT_DEFAULT_H` exists: a server render and a bundle have to compile one file the
 * same way, and `--import` has nowhere to hang an option.
 */
const TEXT_SETTING = 'AWEFT_TEXT';

const ON = ['1', 'true', 'on'];
const OFF = ['0', 'false', 'off'];

/** Whether this process asked for the text pass, checked. */
const textOf = (): boolean => {
	const named = process.env[TEXT_SETTING];
	if (named === undefined || named === '') return false;
	const said = named.toLowerCase();
	if (ON.includes(said)) return true;
	if (OFF.includes(said)) return false;
	throw codecError('unknown-text-setting', `${TEXT_SETTING}=${named}`,
		'Set it to 1 to find the text a page shows, or leave it unset.');
};

// Read here rather than per file, so a process that sets it to something this cannot honour is
// stopped as it starts rather than at whichever `.tsx` happens to be imported first, or never at
// all in a run that compiles none. A worker takes its environment when it is made, so the value
// cannot change under a running process anyway.
const DEFAULT_H = settingOf();
const TEXT = textOf();

/** What the parser or the transform said about where the fault is: `:line:column`, or nothing. */
const positionOf = (fault: unknown, source: string): string => {
	const held = fault as { loc?: { line?: number; column?: number }; at?: number };
	const line = held.loc?.line;
	if (typeof line === 'number') return `:${line}:${held.loc?.column ?? 0}`;
	if (typeof held.at !== 'number') return '';
	// A `TransformError` carries an offset, which is what the source it was given was measured in.
	const before = source.slice(0, held.at).split('\n');
	return `:${before.length}:${before[before.length - 1]!.length}`;
};

/**
 * Node's `load` hook: compile a `.tsx` file, leave everything else alone.
 *
 * Params:
 *   url: the module's URL
 *   context: what Node hands the hook, passed on unchanged
 *   nextLoad: the rest of the chain
 *
 * Returns: for a `.tsx` file, its source with the JSX compiled, as `module-typescript` so
 * Node strips the types afterwards. For a URL `resolve` above claimed, the generated icon
 * module. For anything else, whatever the rest of the chain says. A file that binds no `h`
 * of its own gets one from the package `AWEFT_DEFAULT_H` names, and from `@aweftjs/dom` when
 * nothing names one.
 *
 * Throws: an `Error` naming the file and the line, with the fault as its `cause`. The fault is a
 * `TransformError` for a rule a compiled template cannot meet, and the parser's own `SyntaxError`
 * for source it cannot read. Neither names the file on its own, and a stack into a parser is not
 * where the reader has to look. `AWEFT_DEFAULT_H` set to anything but the two package names is
 * refused when this module loads, before any file is read and whether or not one ever is, and so
 * is `AWEFT_TEXT` set to anything but a yes or a no. With `AWEFT_TEXT=1` the text pass runs on
 * every file, as it does under `aweft({ text: true })`.
 */
export const load = async (url: string, context: unknown, nextLoad: NextLoad): Promise<LoadResult> => {
	if (url.startsWith(SCHEME)) {
		const [request, from] = url.slice(SCHEME.length).split('?from=');
		const { moduleFor } = await import('@aweftjs/icons/node');
		const source = moduleFor(decodeURIComponent(request ?? ''), decodeURIComponent(from ?? ''));
		// `resolve` above only made this URL after the same call answered a source, so a null here
		// is not a request that was let through: it is one that stopped being one.
		if (source === null) throw new Error(`no icon module answers ${url}`);
		return { format: 'module', source, shortCircuit: true };
	}
	if (!url.startsWith('file:') || !url.endsWith('.tsx')) return nextLoad(url, context);
	const filename = fileURLToPath(url);
	const source = await readFile(filename, 'utf8');
	let code: string;
	try {
		// Written this way rather than `defaultH: named`, because the repo compiles with
		// `exactOptionalPropertyTypes` and an explicit undefined is not the same as an absent field.
		code = transform(source, {
			filename,
			...(DEFAULT_H === undefined ? {} : { defaultH: DEFAULT_H }),
			...(TEXT ? { text: true } : {}),
		}).code;
	} catch (fault) {
		const where = positionOf(fault, source);
		const said = fault instanceof Error ? fault.message : String(fault);
		throw new Error(`${filename}${where}: ${said}`, { cause: fault });
	}
	return { format: 'module-typescript', source: code, shortCircuit: true };
};

// Registering from the module Node was told to `--import` is what makes one flag enough: the
// hooks have to run on a worker thread, and `register` is what puts them there.
register(import.meta.url);
