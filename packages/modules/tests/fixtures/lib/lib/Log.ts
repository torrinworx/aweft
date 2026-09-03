import type { ModuleProps } from '../../../../src/index.ts';

export const defaults = { prefix: '[lib]', level: 'info' };

export default ({ config }: ModuleProps) => ({
	prefix: String(config.prefix),
	level: String(config.level),
});
