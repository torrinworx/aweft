// What the browser runs. Three lines of boot: a connection, a router, and the app on the page.
//
// Everything else this application does is a module, and the stage builds the loader.

import { createClient } from '@aweftjs/client';
import { createRouter } from '@aweftjs/dom/router';
import { Theme, dark, h, light, mount } from '@aweftjs/ui';

import { App } from './app.tsx';

const client = createClient();
const router = createRouter();
const wants = (globalThis as { matchMedia?: (query: string) => { matches: boolean } })
	.matchMedia?.('(prefers-color-scheme: dark)').matches === true;

const page = (globalThis as unknown as { document: { body: unknown } }).document.body as never;
const stop = mount(page, (
	<Theme value={wants ? dark : light}>
		<App router={router} client={client} />
	</Theme>
));
router.links(page);

// The checks in `main.ts` take the page down to see what the modules' `stop` did. A real
// application never needs this: the tab closing is the unmount.
(globalThis as { unmountApp?: () => void }).unmountApp = () => { stop(); };
