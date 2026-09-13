// notify/Devices: where a user can be reached when no page of theirs is open. One
// `devices:<user>` document, written through the one call and read by the broker, and never
// shared on a link: an endpoint is an address, and a page that can read every address of a user
// can hand them on (design 268).

import { codecError } from '@aweftjs/codec';
import { atomic, createObject } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';
import type { Store } from '@aweftjs/store';

import { type Device, PLATFORMS, TRANSPORTS } from '../item.ts';
import { anonymous, noStore, oneOf, storeOf, userOf } from '../props.ts';

export const defaults = {
	perUser: 20,
	endpointBytes: 1024,
};

/** The root of a devices document, as the module writes it. */
interface Root {
	devices: Record<string, Device>;
}

/** The instance: the call, and what the broker calls. */
export interface Devices {
	/**
	 * Register or forget a device for the connection's user.
	 *
	 * Throws: `anonymous` with no user on the context; `no-store` when the server has none;
	 * `invalid-device` for a field out of shape; `capped` past `perUser` devices.
	 */
	call(args: unknown, context: unknown): Promise<{ devices: number }>;
	/**
	 * The user's devices, keyed by id.
	 *
	 * Throws: `no-store` when the server has none.
	 */
	list(user: string): Promise<Readonly<Record<string, Device>>>;
	/** Drop one device, as after a push the service answered dead for. */
	forget(user: string, device: string): Promise<void>;
}

const refuse = (detail: string, fix: string): Error => codecError('invalid-config', `notify/Devices was given ${detail}`, fix);

const numberOf = (config: Readonly<Record<string, unknown>>, key: keyof typeof defaults): number => {
	const held: unknown = config[key];
	if (typeof held !== 'number' || !(held > 0)) throw refuse(`${key} ${JSON.stringify(held)}`, 'Give that setting a number above zero.');
	return held;
};

const invalid = (detail: string): Error =>
	codecError('invalid-device', `notify/Devices was handed ${detail}`, 'Register with { device, platform, transport, endpoint }: an id of letters, digits, dashes and underscores, a known platform and transport, and an endpoint under the byte cap.');

const capped = (): Error =>
	codecError('capped', 'this user has as many devices as notify/Devices keeps', 'Forget one, or raise perUser in the module\'s config.');

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export default (props: ModuleProps): Devices => {
	const { config } = props;
	const store: Store | undefined = storeOf(props);
	const perUser = numberOf(config, 'perUser');
	const endpointBytes = numberOf(config, 'endpointBytes');

	const name = (user: string): string => `devices:${user}`;

	/** One read or write on a user's document: open, do it, keep the tail to one, close. */
	const on = async <T>(user: string, change: (root: Root) => T, writes = true): Promise<T> => {
		if (store === undefined) throw noStore('the device list');
		const handle = await store.open(name(user));
		try {
			const root = handle.root as Partial<Root>;
			// A read of a document nobody has written yet writes nothing to it.
			if (root.devices === undefined && !writes) return change({ devices: {} });
			if (root.devices === undefined) root.devices = createObject<Record<string, Device>>();
			const out = atomic(() => change(root as Root));
			if (writes) {
				await store.settled(handle);
				await store.truncate(name(user), 1);
			}
			return out;
		} finally {
			await store.close(handle);
		}
	};

	const register = (user: string, raw: unknown): Promise<number> => {
		const held = raw as { device?: unknown; platform?: unknown; transport?: unknown; endpoint?: unknown } | null;
		if (typeof held?.device !== 'string' || !ID.test(held.device)) throw invalid(`a device id of ${JSON.stringify(held?.device)}`);
		if (!oneOf(held.platform, PLATFORMS)) throw invalid(`a platform of ${JSON.stringify(held.platform)}`);
		if (!oneOf(held.transport, TRANSPORTS)) throw invalid(`a transport of ${JSON.stringify(held.transport)}`);
		const endpoint = held.endpoint ?? null;
		if (endpoint !== null && (typeof endpoint !== 'string' || endpoint === '' || new TextEncoder().encode(endpoint).length > endpointBytes)) {
			throw invalid('an endpoint that is not a string under the byte cap, or is empty');
		}
		const device: Device = { platform: held.platform, transport: held.transport, endpoint, seenAt: Date.now() };
		return on(user, (root) => {
			if (root.devices[held.device as string] === undefined && Object.keys(root.devices).length >= perUser) throw capped();
			root.devices[held.device as string] = createObject<Device>(device);
			return Object.keys(root.devices).length;
		});
	};

	const forget = (user: string, device: string): Promise<number> => on(user, (root) => {
		delete root.devices[device];
		return Object.keys(root.devices).length;
	});

	return {
		call: async (args, context) => {
			const user = userOf(context);
			if (user === null) throw anonymous('the device list');
			const held = args as Partial<{ register: unknown; forget: unknown }> | null;
			if (held?.register !== undefined) return { devices: await register(user, held.register) };
			if (held?.forget !== undefined) {
				const id: unknown = (held.forget as { device?: unknown } | null)?.device;
				if (typeof id !== 'string' || !ID.test(id)) throw invalid(`a device id of ${JSON.stringify(id)}`);
				return { devices: await forget(user, id) };
			}
			throw invalid('neither register nor forget');
		},

		list: (user) => on(user, (root) => {
			const out: Record<string, Device> = {};
			for (const [id, device] of Object.entries(root.devices)) out[id] = { ...device };
			return out;
		}, false),

		forget: async (user, device) => { await forget(user, device); },
	};
};
