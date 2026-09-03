import type { ModuleProps } from '@aweftjs/modules';

export const deps = ['greet/Format'];

export default ({ imports }: ModuleProps) => ({
	say: (name: string): string => (imports.Format as { format(t: string): string }).format(`hello ${name}`),
});
