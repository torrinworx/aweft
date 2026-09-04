export { connect } from './link.ts';
export type { Link, LinkOptions, Refused, ShareHandlers, Shared } from './link.ts';

export { mirror } from './mirror.ts';

export { track } from './track.ts';
export type { Tracked, Tracker } from './track.ts';

export { decodeFrame, encodeFrame } from './frame.ts';
export type {
	CommitsFrame, FaultFrame, Frame, LeaveFrame, OpenFrame, RefusedFrame, RootRef, StateFrame,
	WireReason,
} from './frame.ts';

export { fromMessagePort, fromWebSocket, inProcess } from './channel.ts';
export type { Channel, PortLike, SocketLike } from './channel.ts';

export { asCommit, reconcile, rootFrom } from './document.ts';

export { requests } from './requests.ts';
export type { Answerer, AskOptions, RequestError, Requests } from './requests.ts';

// The type this package's own signatures take and hand back, so a caller can type a
// replication pipeline without importing below it.
export type { Commit } from '@aweftjs/codec';
