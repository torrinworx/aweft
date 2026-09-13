// The room entry: what the frame imports. One call, with the template the acts are wrapped in,
// which is where the theme goes because a frame starts with no theme at all.

import { room } from '@aweftjs/sandbox/room';
import { Theme, h, light } from '@aweftjs/ui';

const Layout = (props: { children?: unknown[] }): unknown => <Theme value={light}>{props.children}</Theme>;

export const insidePort = (port: Parameters<typeof room>[0]): ReturnType<typeof room> => room(port, { template: Layout });
