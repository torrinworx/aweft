export { checkEdge, checkGraph } from './boundaries.ts';
export type { Plane, PackageInfo, Violation } from './boundaries.ts';

export { applyCommit, canonicalJson, slotKey, valueFromJson, valueToJson } from './document.ts';
export type { DocumentJson, ObservableJson, ValueJson } from './document.ts';

export {
	checkFixture, checkInvalidFixture, commitToJson, deltaFromJson, deltaToJson, modelApplier,
	refFromJson, refToJson, seedFrom, shuffle,
} from './conformance.ts';
export type {
	Applier, CommitJson, DeltaJson, Fixture, InvalidFixture, RefJson,
} from './conformance.ts';
