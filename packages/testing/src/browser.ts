// The two checks a page a test drives can only get from the rendered page: axe over the
// document, and a Tab walk over its controls (design 267).
//
// The page is whatever the browser driver handed the test, read through three members every
// driver has, and the code that runs inside it is source text, so nothing crosses the boundary
// but strings and plain data.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { codecError } from '@aweftjs/codec';

/**
 * The page object a browser driver hands a test, as much of it as these checks read.
 *
 * Playwright's `Page` has these three, and the suite passes one: `evaluate` takes an expression
 * as source text and answers what it evaluates to, `addScriptTag` puts a script into the page by
 * its content, and `keyboard.press` presses one key.
 */
export interface PageLike {
	evaluate(source: string): Promise<unknown>;
	addScriptTag(options: { readonly content: string }): Promise<unknown>;
	readonly keyboard: { press(key: string): Promise<void> };
}

/** One node axe found a violation on. */
export interface AuditNode {
	/** A selector for the node, as axe wrote it. */
	readonly target: string;
	/** The node's markup, cut where axe cuts it. */
	readonly html: string;
}

/** One rule the page broke. */
export interface AuditViolation {
	/** axe's rule id, such as `image-alt` or `color-contrast`. */
	readonly rule: string;
	/** `minor`, `moderate`, `serious` or `critical`, or null when axe gives none. */
	readonly impact: string | null;
	/** The `wcag*` tags axe puts on the rule, as it writes them: `wcag2a`, `wcag111`. */
	readonly wcag: readonly string[];
	/** axe's one sentence on what to do. */
	readonly help: string;
	readonly helpUrl: string;
	readonly nodes: readonly AuditNode[];
}

/** What `audit` answers: the rules the page broke, and how many it kept. */
export interface AuditResult {
	readonly violations: readonly AuditViolation[];
	/** How many rules ran and passed. */
	readonly passes: number;
}

/** What `audit` takes beside the page. All three are optional. */
export interface AuditOptions {
	/** A selector for the part of the page to audit. The whole document when left off. */
	readonly root?: string;
	/** The axe tags to run. The WCAG 2.x A and AA set when left off. */
	readonly tags?: readonly string[];
	/** Where the axe-core script is, for a project that keeps it somewhere the resolver does not look. */
	readonly locate?: () => string;
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

const installed = (): string => fileURLToPath(import.meta.resolve('axe-core/axe.min.js'));

const sources = new Map<() => string, Promise<string>>();

// An optional peer, reached only when the audit runs (design 140): the message names the package
// and the fix is the one sentence true of every project.
const axe = (locate: () => string): Promise<string> => {
	let source = sources.get(locate);
	if (source === undefined) {
		source = (async () => {
			try {
				return await readFile(locate(), 'utf8');
			} catch (cause) {
				throw codecError('axe-not-installed', `axe-core is not installed, and audit needs it (${String(cause)})`,
					'Install axe-core as a devDependency, or say where the script is with options.locate.');
			}
		})();
		sources.set(locate, source);
	}
	return source;
};

/**
 * Run axe-core over the page and answer what it found.
 *
 * Params:
 *   page: the page a browser driver opened
 *   options: `root`, a selector for the part to audit; `tags`, the axe tags to run; `locate`,
 *            where the axe-core script is, when the installed one is not the one to use
 *
 * Returns: the violations, each with axe's rule id, its WCAG tags, its help and the nodes, and
 * the count of rules that passed. Nothing is thrown for a violation; the test decides.
 *
 * Throws: `axe-not-installed` when `locate`, or the resolver in its place, finds nothing.
 *
 * Example:
 *   const { violations } = await audit(view);
 *   assert.deepEqual(violations, [], violations.map((v) => `${v.rule}: ${v.help}`).join('\n'));
 */
export const audit = async (page: PageLike, options: AuditOptions = {}): Promise<AuditResult> => {
	const content = await axe(options.locate ?? installed);
	const tags = options.tags ?? WCAG_TAGS;
	// axe refuses to be set up twice, so a page audited twice, once per colour scheme, keeps the
	// script it already has.
	const loaded = await page.evaluate('typeof globalThis.axe === "object" && globalThis.axe !== null');
	if (loaded !== true) await page.addScriptTag({ content });

	const found = await page.evaluate(`(async () => {
		const root = ${JSON.stringify(options.root ?? null)};
		const target = root === null ? document : document.querySelector(root);
		if (target === null) throw new Error('audit: nothing on the page matches ' + root);
		const result = await globalThis.axe.run(target, { runOnly: { type: 'tag', values: ${JSON.stringify(tags)} } });
		return {
			passes: result.passes.length,
			violations: result.violations.map((violation) => ({
				rule: violation.id,
				impact: violation.impact ?? null,
				wcag: violation.tags.filter((tag) => tag.startsWith('wcag')),
				help: violation.help,
				helpUrl: violation.helpUrl,
				nodes: violation.nodes.map((node) => ({ target: node.target.join(' '), html: node.html })),
			})),
		};
	})()`) as AuditResult;
	return found;
};

/** Where the focus landed after one press. */
export interface Stop {
	readonly tag: string;
	readonly id: string | null;
	readonly role: string | null;
	/** What the page names the element: its `aria-label`, else its `<label>`, else its text, cut short. */
	readonly name: string;
	/** Whether the element draws a ring while it matches `:focus-visible`. */
	readonly ring: boolean;
}

/** One thing the walk found wrong, with the element it is about. */
export interface WalkProblem {
	readonly reason: 'focus-not-visible' | 'focus-stuck' | 'focus-loops' | 'unreachable' | 'never-cycles';
	readonly fix: string;
	/** The element, as `tag#id` or `tag` with its name. */
	readonly target: string;
}

/** What `walk` answers: where the focus went, in order, and what was wrong on the way. */
export interface WalkResult {
	readonly stops: readonly Stop[];
	readonly problems: readonly WalkProblem[];
}

/** What `walk` takes beside the page. */
export interface WalkOptions {
	/** Presses before the walk gives up on coming back round. 300 when left off. */
	readonly limit?: number;
}

const FIXES: Record<WalkProblem['reason'], string> = {
	'focus-not-visible': 'Draw an outline or a box-shadow on :focus-visible, or let the theme\'s ring show.',
	'focus-stuck': 'Let Tab leave the element: remove the handler that keeps the focus, or move it on yourself.',
	'focus-loops': 'Let Tab leave the page from the last control: remove the handler that sends the focus back, or give the loop a way out.',
	'unreachable': 'Put the element in the tab order with tabindex="0", or take the handler off it.',
	'never-cycles': 'Raise the limit for a page with this many controls, or find what keeps Tab from coming back round.',
};

// Installed once per walk under one property, so each press can say whether the element the
// focus landed on was seen before, which is the one thing a selector cannot say.
const INSTALL = `(() => {
	const walk = { seen: [] };
	globalThis.__aweft_walk = walk;
	// From the top. Blurring leaves the browser's starting point where the focus was, and a click
	// on plain text moves that point without focusing anything, so the body itself, made
	// focusable for the moment, takes the focus and puts the point at the top of the page.
	const had = document.body.getAttribute('tabindex');
	document.body.tabIndex = -1;
	document.body.focus();
	if (had === null) document.body.removeAttribute('tabindex');
	else document.body.setAttribute('tabindex', had);

	const focusable = 'a[href], button, input, select, textarea, summary, [tabindex]';
	// A closed details keeps its content laid out but not rendered, which only checkVisibility
	// reads; a host without it gets the box test.
	const shown = (element) => (typeof element.checkVisibility === 'function'
		? element.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })
		: element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
	const reachable = Array.from(document.querySelectorAll(focusable)).filter((element) => {
		if (element.matches('[tabindex="-1"], [disabled], [hidden], [inert]')) return false;
		if (element.closest('[inert]') !== null) return false;
		if (element.tagName === 'INPUT' && element.type === 'hidden') return false;
		// No box, so no way to reach it: inside a closed details, a closed dialog, a hidden parent.
		return shown(element);
	});
	// A radio group is one stop: Tab lands on the ticked one, or the first, and the arrows do the
	// rest.
	const groups = new Map();
	for (const element of reachable) {
		if (element.tagName !== 'INPUT' || element.type !== 'radio' || element.name === '') continue;
		const key = (element.form === null ? 'd' : 'f') + '\\u0000' + element.name;
		const held = groups.get(key);
		if (held === undefined || (element.checked && !held.checked)) groups.set(key, element);
	}
	const stops = new Set(groups.values());
	walk.expected = reachable.filter((element) =>
		element.tagName !== 'INPUT' || element.type !== 'radio' || element.name === '' || stops.has(element));
	return walk.expected.length;
})()`;

const DESCRIBE = `((element) => {
	const tag = element.tagName.toLowerCase();
	const own = element.getAttribute('aria-label');
	const labelled = Array.from(element.labels ?? []).map((label) => label.textContent).join(' ');
	const name = (own ?? (labelled.trim() !== '' ? labelled : element.textContent ?? '')).trim().replace(/\\s+/g, ' ').slice(0, 40);
	return { tag, id: element.id === '' ? null : element.id, role: element.getAttribute('role'), name };
})`;

// A ring is the element's own outline or box-shadow, or one an ancestor draws for the control
// inside it: a rule about focus that matches the ancestor now and sets either. The rules are read
// rather than the ancestor blurred and refocused, because a blur runs the page's own handlers.
const RING = `((element) => {
	const draws = (style) => style.outlineStyle !== 'none' || style.boxShadow !== 'none';
	if (draws(getComputedStyle(element))) return true;
	const focusRule = (rules, ancestor) => {
		for (const rule of rules) {
			if (rule.cssRules !== undefined && rule.selectorText === undefined && focusRule(rule.cssRules, ancestor)) return true;
			if (rule.selectorText === undefined || !/focus/.test(rule.selectorText)) continue;
			if (rule.style.outline === '' && rule.style.outlineStyle === '' && rule.style.boxShadow === '') continue;
			try { if (ancestor.matches(rule.selectorText)) return true; } catch {}
		}
		return false;
	};
	for (let up = element.parentElement, depth = 0; up !== null && depth < 4; up = up.parentElement, depth += 1) {
		if (!draws(getComputedStyle(up))) continue;
		for (const sheet of document.styleSheets) {
			let rules;
			try { rules = sheet.cssRules; } catch { continue; }
			if (focusRule(rules, up)) return true;
		}
	}
	return false;
})`;

const STEP = `(() => {
	const walk = globalThis.__aweft_walk;
	const element = document.activeElement;
	if (element === null || element === document.body || element === document.documentElement) return { body: true };
	const before = walk.seen.indexOf(element);
	const describe = ${DESCRIBE};
	if (before < 0) walk.seen.push(element);
	// The focus is inside it and the document cannot say where: a shadow host, a frame, a media
	// element's own controls. Tab keeps moving in there while the active element stays put.
	const tag = element.tagName;
	const composite = element.shadowRoot !== null || tag === 'IFRAME'
		|| ((tag === 'AUDIO' || tag === 'VIDEO') && element.hasAttribute('controls'));
	const ring = composite || (element.matches(':focus-visible') && (${RING})(element));
	return { body: false, seen: before, composite, ...describe(element), ring };
})()`;

const LEFT = `(() => {
	const walk = globalThis.__aweft_walk;
	delete globalThis.__aweft_walk;
	if (walk === undefined) return [];
	const describe = ${DESCRIBE};
	return walk.expected.filter((element) => !walk.seen.includes(element)).map(describe);
})()`;

const targetOf = (stop: { tag: string; id: string | null; name: string }): string =>
	(stop.id !== null ? `${stop.tag}#${stop.id}` : stop.name === '' ? stop.tag : `${stop.tag} "${stop.name}"`);

/**
 * Press Tab through the page, from the top, and answer where the focus went and what was wrong
 * on the way. Whatever had the focus loses it first, so the walk starts before the first control.
 *
 * Params:
 *   page: the page a browser driver opened
 *   options: `limit`, presses before the walk gives up
 *
 * Returns: every stop in order, and the problems: a stop with no visible ring, a press that
 * moved nothing, a press that sent the focus back round the page without leaving it, a focusable
 * element the walk never reached, or a walk that never came back round. Nothing is thrown for a
 * problem; the test decides.
 *
 * Example:
 *   const { stops, problems } = await walk(view);
 *   assert.deepEqual(problems, [], problems.map((p) => `${p.reason} at ${p.target}: ${p.fix}`).join('\n'));
 */
export const walk = async (page: PageLike, options: WalkOptions = {}): Promise<WalkResult> => {
	const limit = options.limit ?? 300;
	const stops: Stop[] = [];
	const problems: WalkProblem[] = [];
	const expected = await page.evaluate(INSTALL) as number;

	let last: { seen: number; target: string; composite: boolean } | null = null;
	let cycled = false;
	let missed: { tag: string; id: string | null; name: string }[];
	try {
		for (let presses = 0; presses < limit; presses += 1) {
			await page.keyboard.press('Tab');
			const landed = await page.evaluate(STEP) as
				| { body: true }
				| { body: false; seen: number; composite: boolean; tag: string; id: string | null; role: string | null; name: string; ring: boolean };
			if (landed.body) {
				// The focus went past the last control. That is the way round on an ordinary page,
				// and it is where the walk started, so the next press is the first stop again.
				if (stops.length > 0) { cycled = true; break; }
				continue;
			}
			const target = targetOf(landed);
			if (last !== null && landed.seen === last.seen && landed.seen >= 0) {
				// Still inside a frame, a shadow tree or a media element's controls: Tab is moving
				// where the document cannot see, and the limit is what ends a walk that never leaves.
				if (last.composite) continue;
				problems.push({ reason: 'focus-stuck', fix: FIXES['focus-stuck'], target });
				break;
			}
			// Back on an element it had visited without passing the body: the page itself sent the
			// focus round, so Tab can never leave it.
			if (landed.seen >= 0) {
				problems.push({ reason: 'focus-loops', fix: FIXES['focus-loops'], target });
				cycled = true;
				break;
			}
			stops.push({ tag: landed.tag, id: landed.id, role: landed.role, name: landed.name, ring: landed.ring });
			if (!landed.ring) problems.push({ reason: 'focus-not-visible', fix: FIXES['focus-not-visible'], target });
			last = { seen: stops.length - 1, target, composite: landed.composite };
		}
	} finally {
		// Whatever happened, the page is left without the walk's bookkeeping on it.
		missed = await page.evaluate(LEFT) as { tag: string; id: string | null; name: string }[];
	}
	for (const element of missed) problems.push({ reason: 'unreachable', fix: FIXES['unreachable'], target: targetOf(element) });
	// A page with nothing to focus has nothing to come back round to.
	if (!cycled && expected > 0 && problems.every((problem) => problem.reason !== 'focus-stuck')) {
		problems.push({ reason: 'never-cycles', fix: FIXES['never-cycles'], target: 'the page' });
	}
	return { stops, problems };
};
