---
name: aweft-release
description: Publish the aweft packages to npm. Use when asked to release, publish, cut a version, or push the stack to the registry. Sets one version across every package, builds the compiled output, runs the root gate, packs and installs the result in a scratch directory before anything goes out, and asks before the one command that cannot be taken back.
---

# Releasing aweft

Nineteen packages go out together at one version (design 256). A publish is the only action in
this repo that cannot be undone: npm keeps the version number whatever happens next, and an
unpublish is a 72-hour window with conditions. So every check runs before it, not after.

## Read first

`docs/design/256-a-published-package-ships-javascript.md`, which is what every step below is
enforcing, and `AGENTS.md` under KEEPING ONE SOURCE OF TRUTH for the lockstep rule.

## Procedure

1. **Clean tree, and fetched.** `git status` shows nothing and `git fetch` has run. A release
   built from a stale checkout publishes work that is not on the default branch.
2. **The version.** Ask which one, unless the maintainer already said. Every package takes it,
   and so does every `^` range one package names another by. `npm run publishing` refuses the
   set if one package disagrees.
3. **The gate, then the audit.** `npm test` at the repo root, then `npm run audit`
   (`npm audit --audit-level=high`). Read each exit code from its own output. Red stops the
   release; nothing about a release is worth a workaround here, and a dependency with a known
   hole is not published under this name.
4. **Build.** `npm run build`. It writes each package's `dist/`, which no commit carries.
5. **Prove the tarball, not the repo.** This is the step the gate cannot do, because every
   check in it runs against the source:

   ```
   npm pack --workspaces --pack-destination <scratch>
   ```

   Then, in a scratch directory outside the repo, with no `.npmrc` and no submodule:
   install the tarballs, import every package's main entry and every subpath its `exports`
   names, and run something small that touches more than one package. What you are looking for
   is `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, a missing `dist/`, or a subpath that
   resolves in the repo and not from a tarball.
6. **Log in as the right account.** `npm whoami`. The scope is `@aweftjs`.
7. **Ask, then publish.** Name the version, the package count and the account, and wait for
   the maintainer to say go. Then:

   ```
   npm publish --workspaces --access public
   ```

   Each package's `prepack` rebuilds its own `dist/` as it goes, so step 4 is the check rather
   than the source of what ships.
8. **Tag and push.** `git tag v<version>` and push it with the commit that set the version.
9. **Report.** The published version, the packages, the gate's exit code, and what step 5
   installed and ran.

## Stop conditions

The gate is red. `npm whoami` is the wrong account or none. A tarball fails to import in step 5.
The version is already on the registry. A package's `dist/` is empty after a build. On any of
these, stop and say which: none of them has a workaround that is not worse than not shipping.
