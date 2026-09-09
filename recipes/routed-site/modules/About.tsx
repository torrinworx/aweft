// The act that arrives later, as a module. Nothing imports it: the source in `site.tsx` names it,
// and the stage loads it when the URL reaches `/about`.

import { Head, Title, h } from '@aweftjs/ui';

/** What a static walk reads to learn this act's URLs, without the factory ever running. */
export const entries = async (): Promise<readonly Record<string, string>[]> => [{}];

export default (): unknown => ({
	title: 'About',
	component: (): unknown => (
		<main id="about">
			<Head><Title>About</Title></Head>
			<p>Loaded on demand, as a module the stage names in its acts.</p>
		</main>
	),
});
