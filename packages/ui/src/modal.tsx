// A stage template that puts the act in a native `<dialog>` (design 134).
//
// The element does the top layer, the backdrop and the focus trap; `dialogControl` (design 129)
// adds the three things it does not do. What this component adds on top of both is that every way
// of closing it goes through the stage, so back and the close button are one navigation rather than
// two ways to be half closed (design 124).

import { type ElementLike, type Mounter, createElement, mount } from '@aweftjs/dom';

import { Button } from './button.tsx';
import { Icon } from './icon.tsx';
import { StageContext } from './stage.tsx';
import { assert } from './assert.ts';
import { dialogControl } from './dialog.ts';
import { elementFor } from './control.ts';
import { empty } from './field.ts';
import { h } from './h.ts';
import { use } from './render.ts';

/** What `Modal` takes. Everything not named here goes to the `<dialog>`. */
export interface ModalProps {
	/** A heading inside the dialog, and the dialog's accessible name. A value or a cell. */
	readonly label?: unknown;
	/** Escape does not close it: the `cancel` event is prevented. */
	readonly noEsc?: unknown;
	/** A mousedown on the backdrop does not close it. */
	readonly noClickEsc?: unknown;
	/** The theme variant. */
	readonly type?: unknown;
	/** Decorate this `<dialog>` instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/**
 * The act, in a modal dialog.
 *
 * Params:
 *   props: `label`, `noEsc`, `noClickEsc`, `type`, `element`, and anything else, which goes to the
 *          `<dialog>`
 *
 * Returns: a `<dialog>`, opened as this mounts, holding a heading, a close button and the act.
 *
 * Every close is the stage's `close()`: Escape through the element's own `cancel` event, a mousedown
 * on the backdrop, and the close button. So a modal opened with `history: true` is taken down by the
 * history entry going away, whichever of the three the person used (design 124).
 *
 * A stage calls a template as `h(template, {}, act)`, so props are named by writing the template as
 * a function of your own.
 *
 * Throws: an assert, loud in development and stripped in a release build, when there is no stage
 * above it, and the one `elementFor` makes for an `element` that is not a `<dialog>`.
 *
 * Example:
 *   stage.open({ name: 'edit', history: true, template: Modal });
 *   stage.open({ name: 'edit', history: true, template: (p) => h(Modal, { label: 'Edit' }, ...p.children) });
 */
export const Modal = (
	props: ModalProps,
	cleanup: (...fns: (() => void)[]) => void,
	mounted: (...fns: (() => void)[]) => void,
): Mounter => {
	// `mounted` is only taken while the component's own body runs, and the mount context arrives one
	// step later, in the mounter. So the callback is registered here and filled in there.
	let show = (): void => undefined;
	mounted(() => { show(); });
	return (elem, _item, before, context) => {
		const { label, noEsc, noClickEsc, type, element, theme, children, ...rest } = props;

		const stage = StageContext.read(context);
		assert(stage !== null,
			'a Modal is a stage template and this one has no stage above it; show it with '
			+ 'stage.open({ name, template: Modal, history: true })');
		if (stage === null) return () => undefined;

		const tag = elementFor(element, 'dialog');
		const node = (typeof tag === 'string' ? createElement(tag) : tag) as ElementLike;

		const titleId = use(context).ids.next('modal');
		const named = !empty(label);

		// An unmount is not a close the person asked for. `stop()` closes a dialog that is still
		// open, and without this flag that close would go on to the stage and take the act down with
		// it, so opening another act over this one dropped the page back to the base act.
		let tearingDown = false;
		const control = dialogControl(node, {
			onClose: () => {
				if (tearingDown) return;
				stage.close();
			},
		});
		show = () => { control.open(); };
		cleanup(() => {
			tearingDown = true;
			control.stop();
		});

		const item = h(node, {
			...rest,
			theme: ['dialog', type, theme],
			'aria-labelledby': named ? titleId : null,
			onCancel: (event: unknown) => {
				if (noEsc === true) {
					(event as { preventDefault?: () => void }).preventDefault?.();
					return;
				}
				// Closed here rather than left to the element's own default, so the light tree and a
				// browser take the same path out. `close()` on an element that is already closing does
				// nothing, so the two do not fight.
				control.close();
			},
			onMouseDown: (event: unknown) => {
				// The backdrop is the dialog element itself: anything inside it targets a child.
				if (noClickEsc === true || (event as { target?: unknown }).target !== node) return;
				control.close();
			},
		},
		h('div', { theme: ['dialog', 'head'] },
			named ? h('h2', { id: titleId, theme: ['text', 'lg'] }, label) : null,
			h(Button, {
				type: 'quiet',
				round: true,
				'aria-label': 'Close',
				icon: h(Icon, { name: 'x' }),
				onClick: () => { control.close(); },
			})),
		h('div', { theme: ['dialog', 'body'] }, ...(children ?? [])));

		return mount(elem, item, before, context);
	};
};
