// A suspend whose loader rejects with nothing anywhere to show a failure (design 112).
//
// Run as its own process by `suspend.test.ts`, because the guarantee is that the rejection reaches
// the host's unhandled-error path, and a test runner catches an uncaught error before the host
// can. The handler below is the host: reaching it at all is what is being proven.

import { createDocument, toHtml } from '@aweftjs/dom';
import { h, mount, suspend } from '@aweftjs/ui';

const Waiting = (): unknown => h('p', {}, 'loading');
const Page = suspend(Waiting, async () => { throw new Error('the loader said no'); });

const document = createDocument();
mount(document.body, h(Page as never, {}));

process.on('uncaughtException', (error: Error) => {
	console.log(`SLOT:${toHtml(document.body.childNodes)}`);
	console.error(`REPORTED:${error.message}`);
	process.exit(3);
});

setTimeout(() => {
	console.log('NOTHING REPORTED');
	process.exit(0);
}, 200);
