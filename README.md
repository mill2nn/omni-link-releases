# Omni Link — Premiere Pro panel

Link each bin to a folder on disk, hit **Import**, and only the files you don't
already have come in. Nothing gets duplicated.

Premiere Pro 2020 or later · macOS and Windows.

## Install — one line

**Quit Premiere first.** Then paste this into Terminal (macOS):

```bash
curl -fsSL https://raw.githubusercontent.com/mill2nn/omni-link-releases/main/install.sh | bash
```

Windows — paste into PowerShell:

```powershell
irm https://raw.githubusercontent.com/mill2nn/omni-link-releases/main/install.ps1 | iex
```

Then reopen Premiere → **Window ▸ Extensions ▸ Omni Link**.

Nothing gets downloaded to your Downloads folder, so **macOS has nothing to
block** — no Gatekeeper warning, no Privacy & Security detour. No admin rights
either.

<details>
<summary>Prefer clicking to typing?</summary>

**[⬇ Download OmniLink-v1.3.5.zip](https://github.com/mill2nn/omni-link-releases/releases/latest)**

Unzip it, quit Premiere, double-click `Install Omni Link (Mac).command` or
`Install Omni Link (Windows).bat`, then reopen Premiere.

If macOS blocks it: **System Settings ▸ Privacy & Security** → **Open Anyway**,
then double-click again.

Use the **Releases** link above, not the green *Code ▸ Download ZIP* button —
that one strips the executable bit and the installer won't run.
</details>

> **What the one-liner does**, since pasting a command that runs code deserves an
> answer: reads `latest.json`, downloads the panel files listed above into a temp
> folder, checks none came back empty, then copies them into Premiere's
> extensions folder. It also sets Adobe's `PlayerDebugMode`, which lets Premiere
> load unsigned panels — all of them, not just this one. Read
> [install.sh](https://raw.githubusercontent.com/mill2nn/omni-link-releases/main/install.sh) before running it if you'd rather check.

Once installed, the panel updates itself — it checks here on launch and offers
any newer version with a button.

---

Built output only: no source, no history, no tests. `latest.json` is what the
panel reads to spot a new version.

Current version: **1.3.5**
