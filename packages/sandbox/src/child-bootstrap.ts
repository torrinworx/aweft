// What the `child` runner runs: the far end over the IPC pipe it was spawned with. A child
// forwards its console and nothing else: its uncaught error ends the process, and the channel
// closing is the report the host gets (design 283).

import { inside } from './inside.ts';
import { type IpcLike, fromIpc } from './ipc.ts';

const room = await inside(fromIpc(process as unknown as IpcLike), { forward: { console: true } });
process.on('disconnect', () => {
	room.stop().then(() => process.exit(0), () => process.exit(0));
});
