// A library bundle for an act in a Node test: a module inside a room cannot import a bare name
// from a data: URL, so `ui` reaches the act as a granted-looking library module. `hooks` is
// where the act leaves what the test drives, and the test imports this same file to read it.
import { Stage, StageContext, h } from '@aweftjs/ui';

export const hooks: Record<string, unknown> = {};

export default {
	'./test/Ui.ts': { default: () => ({ h, Stage, StageContext, hooks }) },
};
