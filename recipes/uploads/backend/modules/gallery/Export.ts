// gallery/Export: a signed-in page asks for a CSV of its pictures, and the module makes the file
// itself through the keeper's trusted path. No type rule, no cap, no accept: the module is the
// application.

import type { Files } from '@aweftjs/uploads';

export const deps = ['uploads/Files'];

export default ({ imports }: { imports: { Files: Files } }) => ({
	call: async (args: { ids?: string[] }, context: { user: string | null }) => {
		const rows = ['id,url,name,size'];
		for (const id of args.ids ?? []) {
			const record = await imports.Files.get(id);
			if (record !== undefined) rows.push([record.id, record.url, record.name ?? '', String(record.size)].join(','));
		}
		const csv = rows.join('\n') + '\n';
		return imports.Files.put(new TextEncoder().encode(csv), { type: 'text/csv', name: 'pictures.csv', user: context.user });
	},
});
