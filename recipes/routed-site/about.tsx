// The act that arrives later. Nothing imports it: the loader in `site.tsx` does, at run time.

import { Head, Title, h } from '@aweftjs/ui';

export default (): unknown => (
	<main id="about">
		<Head><Title>About</Title></Head>
		<p>Loaded on demand, through the same suspend every other slow thing goes through.</p>
	</main>
);
