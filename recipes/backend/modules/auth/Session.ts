// Configuration for a module this application did not write. No factory here, so the
// battery's `auth/Session` is still the implementation: this file only sets its lifetime,
// and it wins because this source comes first.

export const config = { sessionMs: 60 * 60 * 1000 };
