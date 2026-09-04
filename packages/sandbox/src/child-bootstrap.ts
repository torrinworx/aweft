// What the `child` runner runs: the far end over the IPC pipe it was spawned with.

import { inside } from './inside.ts';
import { type IpcLike, fromIpc } from './ipc.ts';

const room = await inside(fromIpc(process as unknown as IpcLike));
process.on('disconnect', () => {
	room.stop().then(() => process.exit(0), () => process.exit(0));
});
