// The whole page: the routed site, with a banner above it that binds no `h` of its own.
//
// The site itself is `recipes/routed-site`, imported rather than copied, so what is written out
// here is the same site that recipe drives in a browser. Its two parameterised acts declare
// `entries()` and its `tags/:tag` act does not, which is what gives the walk something to report.

import { h } from '@aweftjs/ui';
import type { Router } from '@aweftjs/dom/router';

import { Site } from '../routed-site/site.tsx';
import { Banner } from './banner.tsx';

export const Page = (props: { router: Router }): unknown => (
	<div id="site">
		<Banner />
		<Site router={props.router} />
	</div>
);
