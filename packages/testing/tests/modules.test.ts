// The module harness: a module instantiated the way the loader does it, with stubs in place of
// its dependencies.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule } from '../src/index.ts';

const Create = {
	deps: ['auth/Session', 'lib/Log'],
	defaults: { maxLength: 80, prefix: 'post' },
	default: ({ imports, config, ...props }: { imports: Record<string, unknown>; config: Record<string, unknown> }) => ({
		make: (title: string): string => {
			const user = (imports.Session as { userOf(): string }).userOf();
			(imports.Log as { log(l: string): void }).log(`${user} made ${title}`);
			return `${String(config.prefix)}:${title.slice(0, Number(config.maxLength))}`;
		},
		props,
		stopped: false,
		stop(): void { this.stopped = true; },
	}),
};

test('a module loads with its dependencies stubbed, by short name, and its configuration merged over defaults', async () => {
	const lines: string[] = [];
	const { instance, stop } = await loadModule({
		exports: Create,
		imports: { 'auth/Session': { userOf: () => 'u_1' }, 'lib/Log': { log: (l: string) => lines.push(l) } },
		config: { maxLength: 4 },
		props: { site: 'test' },
	});
	const create = instance as { make(t: string): string; props: Record<string, unknown>; stopped: boolean };
	assert.equal(create.make('hello world'), 'post:hell');
	assert.deepEqual(lines, ['u_1 made hello world']);
	assert.equal(create.props.site, 'test');
	await stop();
	assert.equal(create.stopped, true);
});

test('a dependency without a stub is refused by name, before anything is instantiated', async () => {
	await assert.rejects(
		() => loadModule({ exports: Create, imports: { 'auth/Session': {} } }),
		/lib\/Log is a dependency/,
	);
});

test('a module with no dependencies and no configuration needs nothing but its exports', async () => {
	const { instance } = await loadModule({ exports: { default: () => ({ fine: true }) } });
	assert.deepEqual(instance, { fine: true });
});
