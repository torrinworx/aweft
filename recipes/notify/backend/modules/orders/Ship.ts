// orders/Ship: the application's own module that sends. Private, so the gate lets only a
// signed-in page ask, and the notification goes to whoever asked.

import type { ModuleProps } from '@aweftjs/modules';
import type { Send, SendOptions } from '@aweftjs/notify';

export const deps = ['notify/Send'];

export default ({ imports }: ModuleProps) => {
	const { send } = imports.Send as Send;
	return {
		call: (args: unknown, context: unknown) => {
			const { level, private: isPrivate } = (args ?? {}) as Partial<Pick<SendOptions, 'level' | 'private'>>;
			const user = (context as { user: string }).user;
			return send({ to: { user }, title: 'Order shipped', body: 'Order 1 is on its way', level, url: '/orders/1', tag: 'orders', private: isPrivate });
		},
	};
};
