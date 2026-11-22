# Naukri Automation

Local browser automation for Naukri profile updates and job applications, with support for Wellfound and Indeed. Built with Node.js, Playwright, and Chrome.

## Features

- Refresh the Naukri profile headline and upload a resume.
- Filter jobs by title keywords and exclusions.
- Fill application forms using details from a local configuration file.
- Track application results in a local CSV file.
- Run manually or on a schedule.

## Setup

Requires Node.js 18+ and Google Chrome.

```bash
git clone https://github.com/UJJWAL-SAXENA-09/naukri_automation.git
cd naukri_automation
npm install
cp .env.example .env
```

On Windows, use `copy .env.example .env` for the last step.

Fill in `.env` with your profile details, resume path, and job filters. Keep credentials, resumes, and saved browser sessions on your own machine.

## Configuration

| Setting | Purpose |
|---|---|
| `RESUME_FILE` | Resume PDF path, either absolute or relative to the repository. |
| `TARGET_TITLE_KEYWORDS` | Comma-separated job title keywords to include. |
| `TITLE_BLOCKLIST` | Comma-separated title keywords to exclude. |
| `AUTO_APPLY_LIVE` | Set to `0` for preview mode in combined and scheduled runs, or `1` to submit. |

The direct site runner uses `--live` to enable submission; it does not read `AUTO_APPLY_LIVE`. Start with a preview and a small `--max-applications` value when changing filters.

After filling in `.env` and adding your resume, check the configuration without opening Chrome:

```bash
npm run check:quick
```

Resolve any failed checks before scheduling runs. Run `npm run check` for the full check, including browser sessions; stop active runs before using it so they do not share a browser profile. Both check commands only inspect the setup; they do not submit applications or refresh the profile.

## Usage

Sign in once using a visible browser:

```bash
node naukri-profile-refresh.js login
node auto-apply-runner.js naukri login
```

Refresh the Naukri profile:

```bash
npm run refresh
```

Preview an application run without submitting:

```bash
node auto-apply-runner.js naukri --show --max-applications=5
```

After reviewing the preview, add `--live` to submit applications. Replace `naukri` with `wellfound` or `indeed` to use another supported site, and run its `login` command first.

To run Naukri and Wellfound together in preview mode:

```bash
npm run apply:all -- --dry-run --show --max-applications=5
```

### Choosing a run mode

| Command | Mode |
|---|---|
| `node auto-apply-runner.js naukri` | Preview; add `--live` to submit. |
| `npm run apply:naukri` | Live; the npm script already includes `--live`. |
| `npm run apply:wellfound` | Live; the npm script already includes `--live`. |
| `npm run apply:all` | Uses `AUTO_APPLY_LIVE` from the local `.env` file. |
| `npm run apply:all -- --dry-run` | Explicit preview for both sites, overriding the combined runner's live setting. |

Use the explicit preview command when checking a new profile or changing filters. The single-site npm shortcuts retain their live mode regardless of `AUTO_APPLY_LIVE`.

## Scheduling

For macOS, export the saved sessions and install the schedules:

```bash
npm run session:export
node deploy/setup-macos-schedule.js install
node deploy/setup-macos-schedule.js status
```

Scheduled application runs use `AUTO_APPLY_LIVE` from `.env`. Set it to `0` for preview mode or `1` to submit applications. Remove schedules with `node deploy/setup-macos-schedule.js remove`.

Docker deployment instructions are in [deploy/ORACLE.md](deploy/ORACLE.md).

## Troubleshooting

| Problem | What to check |
|---|---|
| Required details or resume are missing | Update `.env`, confirm `RESUME_FILE` points to an existing PDF, and rerun `npm run check:quick`. |
| A Naukri or Wellfound scheduled session has expired | Repeat the relevant site login, then run `npm run session:export` to refresh the snapshots used by scheduled jobs. |
| A browser profile is already in use | Stop the running job that owns that profile before starting another login or the full setup check. |

Use `npm run check:quick` while a job is active; it skips browser-session checks. After logging in again, stop competing runs before exporting sessions or running `npm run check`.

## Local files

`.env`, browser profiles, resumes, logs, session snapshots, and application CSV files are excluded from Git. If a saved session expires, run the relevant login command again.
