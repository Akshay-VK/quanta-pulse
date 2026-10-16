# Releasing Quanta Pulse

This document describes how a release works end to end, and the one-time setup
needed before the first release. The short version:

```
npm run release -- 0.3.0
git push --follow-tags origin main
```

## How the pieces fit

| Piece | Where | Role |
| --- | --- | --- |
| Version | `package.json` | The single source of truth. |
| Synced copies | `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json` | Kept in step by `scripts/sync-version.mjs` during `npm version`. |
| Tag | `vX.Y.Z` on `main` | Triggers the release workflow. |
| CI build | `.github/workflows/release.yml` | Builds the signed NSIS installer on `windows-latest`. |
| Signing key | `~/.tauri/quanta-pulse.key` (never committed) | Signs the bundle; the public key is compiled into the app. |
| Update server | GitHub Releases `latest.json` | The app downloads it, verifies the signature, installs. |
| Release notes | `CHANGELOG.md` section for the version | Becomes the GitHub release body. |

The updater endpoint is `https://github.com/Akshay-VK/quanta-pulse/releases/latest/download/latest.json`.
It is configured in `src-tauri/tauri.conf.json` under `plugins.updater.endpoints`
and must keep matching the repository the releases are published from.

## Version policy

- [Semantic Versioning](https://semver.org/spec/v2.0.0.html), with a pre-1.0
  relaxation: **minor** (`0.x.0`) for features, redesigns and migrations,
  **patch** (`0.0.x`) for fixes.
- A version is never reused or lowered. Tags are `vX.Y.Z`.
- `npm run version:check` fails if `package.json`, `tauri.conf.json`,
  `Cargo.toml` or `Cargo.lock` disagree. An optional tag argument must equal
  `v` + the version.
- `npm version <x>` runs `scripts/sync-version.mjs` in its `version` lifecycle,
  so the commit npm creates carries every version-bearing file at once.

## Release procedure

1. Make sure `main` is clean and up to date with `origin/main`.
2. Run the release:

   ```powershell
   npm run release -- 0.3.0
   ```

   The script checks, in order: clean tree, on `main`, up to date with
   `origin/main`, `version:check`, `tsc`, `eslint`, `vitest`, the release-config
   check, that the requested version is greater than the latest tag, and that
   the tag does not already exist. It then runs `npm version` (which commits and
   tags) and prints the push command.

   - `--dry-run` performs every check but creates no commit, tag or push.
   - `--push` pushes after tagging. It is never passed by CI.

3. Push:

   ```powershell
   git push --follow-tags origin main
   ```

4. The release workflow builds the signed NSIS installer and opens a **draft**
   GitHub release with the `CHANGELOG.md` section as the body and `latest.json`
   attached. Publish the draft when ready.

### The first release

The first release is `0.2.0` and the version is already in `package.json`, so
there is nothing to bump — only the tag is missing. The script detects this and,
after the same checks, creates the `v0.2.0` tag without changing the version:

```powershell
npm run release -- 0.2.0
git push --follow-tags origin main
```

## One-time GitHub setup

Do this once, before the first release.

1. **Create a public repository** at `https://github.com/Akshay-VK/quanta-pulse`.
   It must be public: the updater fetches `latest.json` and the installer from
   GitHub Releases without authentication, so a private repository would break
   updates for every user. Push `main`:

   ```powershell
   git push -u origin main
   ```

2. **Workflow permissions.** The release workflow needs `contents: write` to
   create releases and upload assets. Set it under
   Settings → Actions → General → Workflow permissions, or rely on the
   `permissions: contents: write` block already in the workflow.

3. **Secrets.** Add two repository secrets
   (Settings → Secrets and variables → Actions → New repository secret):

   | Secret | Value |
   | --- | --- |
   | `TAURI_SIGNING_PRIVATE_KEY` | The contents of `~/.tauri/quanta-pulse.key`. |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password that protects it. |

   Never commit either value. Never print them in logs — the workflow passes
   them to the Tauri CLI as environment variables only.

4. **Branch protection.** On `main`, require status checks to pass and restrict
   pushes that create tags matching `v*.*.*` to maintainers. This stops a
   broken build from being published as an update.

5. **Two-factor authentication.** Required for the account that holds the
   signing key. A leaked key is indistinguishable from a legitimate release.

## Generating the signing key

The updater only accepts bundles signed by a key whose public half is compiled
into the app. Generate the pair once, on the machine that will run releases:

```powershell
scripts/generate-signing-key.ps1
```

This creates `~/.tauri/quanta-pulse.key` and `~/.tauri/quanta-pulse.key.pub`
with the Tauri CLI, prompting for a password. It refuses to overwrite an
existing key. Then install the public half into the app:

```powershell
scripts/set-pubkey.mjs "$HOME\.tauri\quanta-pulse.key.pub"
```

`npm run release:config:check` fails while `plugins.updater.pubkey` is still a
placeholder, so a release cannot ship an unverifiable bundle.

**Back up the private key.** Store `quanta-pulse.key` and its password in a
password manager or encrypted volume. If the key is lost, no future release can
be installed by existing users — they must download and install the new build
manually once. If the key is leaked, revoke trust by rotating to a new key and
releasing a new build; every user must install that build manually, because the
old public key will reject bundles signed by the replacement.

## The first updater-enabled build must be installed manually

The public key is compiled into the app at build time. A build made before the
key was installed cannot verify updates, and an older installed build does not
know the new key. So:

1. Build and install `0.2.0` manually (download the NSIS installer from the
   draft release and run it).
2. Only after that build is installed will the updater accept `0.3.0` and later.

## Testing an update before publishing

1. Cut the release and let the workflow create the **draft**.
2. Install the draft's NSIS installer on a test machine (or a fresh user
   profile) that already runs the previous version.
3. Wait for the first check (30 s after launch) or use
   Settings → About → Check for updates.
4. Confirm the update downloads, verifies, installs and relaunches, and that
   the database and mirror survive.
5. Only then publish the draft.

## Rolling back

Every release is a normal version, so a rollback is a release that lowers the
version number's *behaviour* by shipping the previous code under a new patch
version — never by reusing a version. If an update must be withdrawn
immediately, publish a new patch release whose code reverts the change; the
updater will offer it like any other.

Local data is additionally protected: before any migration runs, the app writes
a consistent backup of the database to
`<app data>/backups/quanta-pulse-<oldversion>-<timestamp>.db` and keeps the
newest three. If a migration is the problem, close the app, restore the newest
backup over `quanta-pulse.sqlite`, and relaunch.

## Troubleshooting

- `version:check` fails — run `npm run version:sync` and commit.
- `release:config:check` fails — the pubkey is still a placeholder; run
  `scripts/set-pubkey.mjs` against the generated `.pub` file.
- The workflow fails on `tauri-apps/tauri-action` — check that both secrets
  exist and that the tagged commit is reachable from `main`.
- The app reports "update check failed" — the endpoint in
  `src-tauri/tauri.conf.json` must match the repository, and `latest.json`
  must be attached to the latest release.
