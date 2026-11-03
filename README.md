# ZQ630 Plus Studio

IPRO 497 Group 1's interactive 3D model of the Zebra ZQ630 Plus, plus a "Studio" page where teammates suggest changes in plain words. Claude builds each suggestion on its own branch, the team previews and votes, and the owner merges the ones everyone agrees on.

## How it works

1. A teammate opens the Studio, types an idea (and can attach an image) and presses **Send to Claude**.
2. The Studio's small API (Cloudflare Pages Functions in `functions/api/`) opens a GitHub issue for it, saves the image on a branch called `proposal-<number>`, and adds the `proposal` label.
3. The label starts `.github/workflows/studio.yml`, which runs Claude Code with the owner's Claude subscription. Claude edits `site/viewer/index.html`, runs `scripts/check.mjs`, and writes a short plain-language summary. The workflow commits to the branch and opens a pull request.
4. Cloudflare Pages builds every branch, so each proposal gets its own preview link. The Studio shows it in the "Showing" menu.
5. Teammates vote or send a follow-up ("Change it"), which rebuilds the same branch. The owner presses **Merge**, and the change goes live for everyone.

Teammates don't need a GitHub or Claude account. They need the Studio link and the team passcode.

## Layout

| Path | What it is |
| --- | --- |
| `site/index.html` | The Studio page |
| `site/viewer/` | The 3D viewer and its model and texture files |
| `functions/api/` | The Studio API: `proposals`, `propose`, `refine`, `vote`, `merge`, `image` |
| `lib/studio.js` | Helpers shared by the API (GitHub calls, passcodes, the hidden markers in issues) |
| `.github/workflows/studio.yml` | The build workflow that runs Claude |
| `scripts/request.mjs` | Turns an issue and its follow-ups into the request Claude reads |
| `scripts/check.mjs` | Syntax and file check that every build must pass |
| `CLAUDE.md` | Instructions Claude follows when building a proposal |

## One-time setup

### 1. GitHub repository settings

1. **Settings → Actions → General → Workflow permissions**: choose **Read and write permissions** and tick **Allow GitHub Actions to create and approve pull requests**. Save.
2. In a terminal on your own computer with Claude Code installed, run `claude setup-token`. It signs in with your Claude subscription and prints a token.
3. **Settings → Secrets and variables → Actions → New repository secret**: name it `CLAUDE_CODE_OAUTH_TOKEN` and paste the token.

### 2. A GitHub token for the Studio API

GitHub → your profile → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.

- Repository access: **Only select repositories** → this repo.
- Permissions: **Actions**, **Contents**, **Issues** and **Pull requests** set to **Read and write** (Metadata read-only is added automatically). Actions is what lets the Studio cancel and rerun builds.
- Pick an expiry date that lasts past the end of the semester.

Copy the token. It goes into Cloudflare in the next step. The Studio acts as you on GitHub, which is what lets the workflow run for teammates who have no GitHub account.

### 3. Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, and pick this repository.
2. Build settings: framework preset **None**, build command empty, build output directory **`site`**. Cloudflare finds `functions/` by itself.
3. After the first deploy: **Settings → Variables and Secrets**. Add these for **Production** and also for **Preview**:

| Name | Value |
| --- | --- |
| `GITHUB_TOKEN` | the fine-grained token from step 2 (mark it as a secret) |
| `GITHUB_REPO` | `danishm07/IPRO_Printer` |
| `TEAM_PASSCODE` | a passcode you share with the team |
| `ADMIN_PASSCODE` | a different passcode only you know (for Merge and Close) |
| `PAGES_PROJECT` | the project name, the part before `.pages.dev` |

4. Redeploy (Deployments → the latest one → Retry deployment) so the variables take effect.
5. Open `https://<project>.pages.dev`, sign in with the team passcode, and send a small test idea.

### Owner tools

On the Studio page, click **Owner tools** at the bottom and enter the admin passcode. Each proposal then shows **Merge into live version** and **Close without merging**.

## Notes

- A build takes about 3 to 8 minutes and counts against the owner's Claude usage. Each build is capped at 40 turns.
- If two proposals change the same lines, the second may not merge cleanly. The Studio then asks for a follow-up ("update it to the latest version"), which rebuilds it on top of the current version.
- The repo can go private at any time. Reference images are served through the API, so they keep working.
- Running a personal subscription for a shared team tool may not fit Anthropic's terms of use. Check them. The fallback is an API key: add an `ANTHROPIC_API_KEY` secret and swap `claude_code_oauth_token` for `anthropic_api_key` in the workflow.
