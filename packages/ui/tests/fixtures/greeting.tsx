// A `.tsx` file with real JSX in it, so the gate compiles one on every run (design 110).

import { h } from '@aweftjs/ui';

export const greetingTag = 'p';

export const Greeting = (props: { name: string; children: unknown[] }): unknown =>
	<p theme="muted">hello {props.name}</p>;
