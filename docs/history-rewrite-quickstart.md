# History Rewrite Quickstart (Windows, this repo)

Use this only when you are ready to rewrite published git history.

## Repository defaults

- Source repo: `N:\vsCode\bgdisplay`
- Mirror repo (new): `N:\vsCode\bgdisplay-rewrite.git`
- Remote: `https://github.com/2Br0keB0ys/bgdisplay.git`

## 1) Pre-check

Run:

- `scripts/history-rewrite/preflight_scan.ps1 -RepoPath N:\vsCode\bgdisplay`

If you still see the known historical indicators, proceed.

## 2) Dry run (safe)

Run:

- `scripts/history-rewrite/run-mirror-rewrite-bgdisplay.ps1 -InitMirror -TrustMirrorPath -CreateBackupBundle`

This will:
- create mirror clone,
- create bundle backup,
- print rewrite command,
- stop before rewriting.

## 3) Execute rewrite

Run:

- `scripts/history-rewrite/run-mirror-rewrite-bgdisplay.ps1 -MirrorRepoPath N:\vsCode\bgdisplay-rewrite.git -TrustMirrorPath -ExecuteRewrite`

## 4) Push rewritten history

Run:

- `scripts/history-rewrite/run-mirror-rewrite-bgdisplay.ps1 -MirrorRepoPath N:\vsCode\bgdisplay-rewrite.git -TrustMirrorPath -PushMirror`

> Optional one-shot execution:
>
> `scripts/history-rewrite/run-mirror-rewrite-bgdisplay.ps1 -InitMirror -TrustMirrorPath -CreateBackupBundle -ExecuteRewrite -PushMirror`

### Why `-TrustMirrorPath`?

On Windows network shares, Git may block repo access with a "dubious ownership" error.
`-TrustMirrorPath` adds the mirror path to global `safe.directory` before running rewrite operations.

## 5) After push

- Re-enable branch protection rules
- Tell collaborators to **re-clone** (recommended) or hard-reset to new history
- Re-run preflight scan on fresh clone to verify

## Rollback

Backup bundle path:

- `N:\vsCode\bgdisplay-pre-rewrite.bundle`

Use bundle to restore if needed (see `docs/history-rewrite-plan.md`).
