export { randomBelow, randomFrom } from './random.ts';

export { aweftPackageOf, moduleSpecifiers } from './imports.ts';

export { loadFixtures, loadInvalidFixtures } from './fixtures.ts';

export { driverChecks } from './drivers.ts';
export type { DriverCheck, MakeDriver, StoreDriver } from './drivers.ts';

export { checkManifests } from './manifests.ts';
export type { Manifest } from './manifests.ts';

export { checkEdge, checkGraph } from './boundaries.ts';
export type { Plane, PackageInfo, Violation } from './boundaries.ts';

export { checkDecisionHeader } from './decisions.ts';

export { surfaceOf, surfaceProgram } from './surface.ts';

export { applyCommit, canonicalJson, slotKey, valueFromJson, valueToJson } from './document.ts';
export type { DocumentJson, ObservableJson, ValueJson } from './document.ts';

export {
	checkFixture, checkInvalidFixture, commitToJson, deltaFromJson, deltaToJson, modelApplier,
	refFromJson, refToJson, seedFrom, shuffle,
} from './conformance.ts';
export type {
	Applier, CommitJson, DeltaJson, Fixture, InvalidFixture, RefJson,
} from './conformance.ts';

// The id conversions a fixture consumer needs: DocumentJson is keyed by an id's text form
// while a Commit carries bytes, so the function across the gap rides along, the same way
// core re-exports the codec types its own signatures hand out.
export { idFromText, idToText, slotKeyOf } from '@aweftjs/codec';
