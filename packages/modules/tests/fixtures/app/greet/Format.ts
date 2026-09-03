import type { ModuleProps } from '../../../../src/index.ts';

export const defaults = { punctuation: '.' };

export default ({ config }: ModuleProps) => ({
	format: (text: string): string => `${text}${String(config.punctuation)}`,
});
