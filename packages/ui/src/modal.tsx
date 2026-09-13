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
import { text } from './text.ts';
import { use } from './render.ts';

/**
 * What `Modal` takes. A stage hands its template the props the `open` carried (design 213), so this
 * component reads the ones it names and passes nothing else to the `<dialog>`: an `open` carrying a
 * row for the act would otherwise write it on the element as an attribute.
 */
export interface ModalProps {
	/** A heading inside the dialog, and the dialog's accessible name. A value or a cell. */
	readonly label?: unknown;
	/** Escape does not close it: the `cancel` event is prevented. */
	readonly noEsc?: unknown;
	/** A mousedown on the backdrop does not close it. */
	readonly noClickEsc?: unknown;
	/** The theme variant. `sheet` puts the dialog against an edge instead of in the middle. */
	readonly type?: unknown;
	/** Which edge a `sheet` sits on: `right` (the default), `left`, `top` or `bottom`. */
	readonly side?: unknown;
	/** Decorate this `<dialog>` instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	/** Written on the `<dialog>` beside the theme's own class list. */
	readonly class?: unknown;
	readonly children?: unknown[];
	/** Anything else an `open` carried. It goes to the act and this component ignores it. */
	readonly [prop: string]: unknown;
}

/**
 * The act, in a modal dialog.
 *
 * Params:
 *   props: `label`, `noEsc`, `noClickEsc`, `type`, `side`, `element`, `theme` and `class`. A prop
 *          this does not name reaches the act and goes no further here
 *
 * Returns: a `<dialog>`, opened as this mounts, holding a heading, a close button and the act.
 *
 * `type="sheet"` is the same dialog against an edge, sliding in from it rather than growing in the
 * middle (design 202). `side` says which edge, `right` by default, and is read for no other type.
 *
 * Every close is the stage's `close()`: Escape through the element's own `cancel` event, a mousedown
 * on the backdrop, and the close button. So a modal opened with `history: true` is taken down by the
 * history entry going away, whichever of the three the person used (design 124).
 *
 * A stage calls a template as `h(template, props, act)`, where `props` is what the `open` carried
 * past `name`, `history`, `template` and `children` (design 213). The act is handed the same props,
 * so a prop this component names, `label` or `type` or `side`, is read here as well as there.
 *
 * Throws: an assert, loud in development and stripped in a release build, when there is no stage
 * above it, and the one `elementFor` makes for an `element` that is not a `<dialog>`.
 *
 * Example:
 *   stage.open({ name: 'edit', history: true, template: Modal, label: 'Edit' });
 *   stage.open({ name: 'filters', template: Modal, label: 'Filters', type: 'sheet' });
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
		// Nothing is spread onto the element: the props are the act's as much as this component's,
		// so an act's own `session` row would land on the `<dialog>` as `session="[object Object]"`
		// (design 213).
		const { label, noEsc, noClickEsc, type, side, element, theme, class: className, children } = props;

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
			class: className,
			// The side is a second segment after the type, so `type="sheet" side="left"` reaches
			// `dialog`, `dialog_sheet` and `dialog_sheet_left` (design 202). It is written only for a
			// sheet, because no other type has an edge to sit on.
			theme: ['dialog', type, type === 'sheet' ? side ?? 'right' : null, theme],
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
		h('div', { theme: ['dialog_head'] },
			named ? h('h2', { id: titleId, theme: ['text', 'lg'] }, label) : null,
			h(Button, {
				type: 'quiet',
				round: true,
				'aria-label': text('Close', { context: 'dialog' }),
				icon: h(Icon, { name: 'x' }),
				onClick: () => { control.close(); },
			})),
		h('div', { theme: ['dialog_body'] }, ...(children ?? [])));

		return mount(elem, item, before, context);
	};
};
