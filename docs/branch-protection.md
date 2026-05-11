# Branch Protection Setup (`main`)

Use this once in GitHub settings to harden the default branch with no paid features.

## Target

Repository: `2Br0keB0ys/bgdisplay`
Branch: `main`

## Recommended settings

In **Settings → Branches → Add branch protection rule** for `main`:

- [x] Require a pull request before merging
  - [x] Require approvals: `1`
  - [x] Dismiss stale pull request approvals when new commits are pushed
  - [x] Require review from code owners
- [x] Require status checks to pass before merging
  - Required checks:
    - `firmware-build`
    - `worker-validate`
    - `label` (from `Auto Label PRs` workflow)
- [x] Require conversation resolution before merging
- [x] Do not allow bypassing the above settings
- [x] Restrict who can push to matching branches (optional if solo maintainer)

## Notes

- If check names change in workflow files, update required checks in branch protection.
- Keep direct pushes to `main` disabled once this is active.
- Pair this with `docs/release-checklist.md` for consistent release quality.
