export { decodeFrame, encodeFrame } from './frame.ts';
export type {
	AcceptFrame, CommitsFrame, FaultFrame, Frame, JoinFrame, JoinedFrame, LeaveFrame,
	RefuseFrame, RootRef, WireReason,
} from './frame.ts';

export { fromMessagePort, fromWebSocket, inProcess } from './channel.ts';
export type { Channel, PortLike, SocketLike } from './channel.ts';

export { asCommit, reconcile } from './document.ts';
export { rootFrom } from './document.ts';

export { track } from './track.ts';
export type { Tracked, Tracker } from './track.ts';

export { serve } from './server.ts';
export type { Connection, Host, HostOptions, Resolve, Topic } from './server.ts';

export { connect } from './client.ts';
export type {
	JoinOptions, Refused, Replica, ReplicaState, Session, SessionOptions,
} from './client.ts';

// The types this package's own signatures take and hand back, so a caller can type a
// replication pipeline without importing below it.
export type { Commit } from '@aweftjs/codec';
export type { Actor, Policy } from '@aweftjs/schema';

export { mirror } from './mirror.ts';
