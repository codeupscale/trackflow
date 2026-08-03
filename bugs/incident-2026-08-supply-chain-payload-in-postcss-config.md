# INCIDENT — supply-chain payload hidden in postcss.config.mjs

| | |
|---|---|
| **Type** | Security incident (code execution + credential exposure) |
| **Severity** | **P0** |
| **Discovered** | 2026-08-03, while diffing local vs remote `develop` after the owner suspected the repo was compromised |
| **Status** | 🟡 Contained — infected refs deleted, guard in place. **Credential rotation deferred by the owner to ~2026-08-10.** |

## What was found

An obfuscated Node loader appended to the **end of the `export default config;` line**
of both `web/postcss.config.mjs` and `marketing/postcss.config.mjs`, behind roughly
150 spaces — so it sat off-screen in an editor and off the right edge of a diff. The
file also gained `import { createRequire } from 'module'` at the top, which is what
lets an ESM config reach `require('child_process')`.

What it does:

1. Resolves its command-and-control **through the Ethereum blockchain** — reads
   transactions from a hardcoded address via public RPC endpoints and the blockscout
   API, then decodes the transaction's `to` field into **two IPv4 addresses**. Domain
   takedowns are useless against this.
2. Fetches an XOR-encrypted stage-2 from `http://<ip>:443/0x/cls` and `/0x/ls`,
   using a browser `User-Agent` and a `Sec-V` header carrying a campaign id.
3. `eval()`s it **and** re-spawns it as a detached `node -e` child with
   `stdio: 'ignore'` and `windowsHide: true` — persistence, invisible in a task list.
4. Strings are `\uXXXX`-escaped throughout (`http`, `https`, `child_process`, …) to
   defeat plain-text grep.

**It executes on every `next build` and `next dev`** in `web/` or `marketing/` — so on
developer laptops and, more importantly, on CI runners, where the secrets are.

### Indicators of compromise

| | |
|---|---|
| Campaign marker | `A9-365-1` (in `global.i`, and sent as the `Sec-V` header) |
| Attacker ETH address | `0xa322E5f3D311D3080e6f0121063e9aDC2490Ef1a` |
| C2 paths | `http://<ip>:443/0x/cls`, `http://<ip>:443/0x/ls` |
| Persistence | detached `node -e` process, `stdio: ignore`, `windowsHide: true` |
| Files | `web/postcss.config.mjs`, `marketing/postcss.config.mjs` |

## Blast radius

- **27 branch tips** carried it (26 remote + 1 local). `main` and `develop` were
  **clean** throughout — verified on both sides.
- It also **removed `.env` and `.env.production` from `.gitignore`** while adding
  `config.bat`. That is not incidental: un-ignore the secrets, hide the dropper.
- On **2026-08-02** a `workflow_dispatch` deployed from the stale branch
  `fix/web-frontend-and-desktop-app` @ `8e6f70f1` — **an infected branch** — rebuilding
  api/web/marketing and rolling production back ~3.5 months. That build ran the loader
  on the runner. (The ref guard added in `372ace99` now blocks non-`main` dispatches.)
- Production containers were re-created 2026-08-03 08:32 UTC from clean `main`; the dev
  stack was rebuilt 2026-08-02 21:54 UTC, from infected source.

### Dating it — read this before trusting any commit date

The infected branches were **rewritten with author *and* committer dates preserved**.
The same commit exists twice: `63ac1e5c` (clean, on develop) and `ffc5322b` (infected
twin — identical message and dates, different SHA). So **every date on an infected
commit is inherited from the original and says nothing about when injection happened.**

The only unforged timestamps in the entire clone are three branch tips stamped
**2026-08-02 23:45:58 +0200** — a timezone this team does not use. GitHub's push-event
log is the only authority on the real date; a clone cannot answer it.

## Response taken (2026-08-03)

1. Full `git clone --mirror` forensic backup — **`~/trackflow-forensic-mirror-2026-08-03.git`**
   (182 refs). Everything below is recoverable from it.
2. Deleted the 26 infected remote branches. Each had exactly **one** commit not on
   `develop` — the injected twin tip — so no unmerged work was lost.
3. Deleted the infected local branch `fix/deploy-ref-guard-and-marketing-version`.
4. Added `scripts/scan-for-malware.sh` + `.githooks/pre-commit` + a
   `Malware scan` GitHub Actions workflow that runs on **every branch**, not just main
   (a main-only scan would have seen nothing while 26 branches were infected). The
   scanner is verified against the real payload, not just against a clean tree.

## Still outstanding

- **Credential rotation — deferred by the owner to ~2026-08-10.** Everything reachable
  from a CI job or a developer laptop should be treated as compromised: GitHub PATs and
  Actions secrets, GHCR tokens, deploy SSH keys, DB passwords, S3/AWS keys, Reverb
  credentials, the Google OAuth secret, `APP_KEY`. Highest value if only two things get
  done early: the **CI deploy SSH key** and the **GHCR push token**.
- **GitHub audit log** — who force-pushed `develop` at 12:17 on 2026-08-03, and who
  dispatched the 08-02 deploy. Deleting branches does not remove the objects from
  GitHub; they stay reachable by SHA and in PRs/forks until Support purges them.
- **Developer machines** that ran `next build`/`next dev` on any affected branch: look
  for stray detached `node` processes and outbound traffic to the C2 IPs.
- Consider requiring signed commits and blocking force-push on `main`/`develop`.

## Guard usage

```bash
git config core.hooksPath .githooks   # once per clone — enables the pre-commit scan
scripts/scan-for-malware.sh           # scan every tracked file
scripts/scan-for-malware.sh --staged  # what the hook runs
```
