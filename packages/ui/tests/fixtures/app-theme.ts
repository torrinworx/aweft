// A component module that defines a theme function, as the README's example does. Loaded twice
// against one `ui`, which is a development reload or two copies of a package in one bundle.
import { Theme } from '@aweftjs/ui';

Theme.define({
	'*': { $em: (args: string[]) => `${Number(args[0]) * 16}px` },
	boxed: { padding: '$em(1)' },
});
