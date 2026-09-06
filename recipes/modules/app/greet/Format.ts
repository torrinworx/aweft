import type { ModuleProps } from '@aweftjs/modules';

export const defaults = { punctuation: '.' };

export default ({ config }: ModuleProps) => ({
	format: (text: string): string => `${text}${String(config.punctuation)}`,
});
