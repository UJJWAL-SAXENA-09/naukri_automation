# Oracle Cloud deployment

This deployment contains schedules for all three requested jobs. Profile refresh
starts normally; both auto-apply services are behind the `auto-apply` Compose
profile and remain in dry-run mode until explicitly enabled.

Default times use `Asia/Kolkata`:

| Job | Default schedule |
|---|---|
| Naukri profile refresh | Every hour at minute `05` |
| Naukri auto-apply | `00:00`, `02:00`, `11:00`, `13:00`, `15:00`, `18:00`, `20:00` daily |
| Wellfound auto-apply | `00:00`, `02:00`, `11:00`, `13:00`, `15:00`, `18:00`, `20:00` daily |

Override the times in the server's private `.env` with
`NAUKRI_REFRESH_MINUTE`, `NAUKRI_AUTO_APPLY_TIMES`, and
`WELLFOUND_AUTO_APPLY_TIMES`.

## Server preparation

On an Ubuntu Oracle VM, install Docker Engine and the Docker Compose plugin using
Docker's official installation instructions. Clone this private repository into a
directory owned by the deploy user, then create the persistent local-only folders:

```bash
mkdir -p runtime private
sudo chown -R 10001:10001 runtime private
chmod 700 runtime private
```

Copy your PDF to `private/resume.pdf`, set this in the server's untracked `.env`,
and keep `GEMINI_KEY` empty unless you explicitly accept sending CV data to Gemini:

```dotenv
RESUME_FILE=/private/resume.pdf
```

The `.env`, `private/`, and `runtime/` directories are excluded from Git and from
the Docker build. `runtime/` holds logged-in Chrome profiles/cookies and must never
be copied to GitHub Actions artifacts, caches, or another public location.

Start the hourly profile-refresh service:

```bash
docker compose up --build -d
docker compose logs -f naukri-refresh
```

## First logins

The service needs a one-time manual Google/Naukri login inside its persistent
Chrome profile. It intentionally does not store or type a Google password. A
secure temporary noVNC console is provided, bound to the VM's `localhost` only.

First stop the schedulers, then start the temporary login container for each
profile. Only one login console should run at a time:

```bash
docker compose stop naukri-refresh
docker compose --profile login run --rm --service-ports naukri-login
```

From your Mac, make an SSH tunnel in a separate terminal (replace the address and
username):

```bash
ssh -L 6080:localhost:6080 ubuntu@YOUR_ORACLE_PUBLIC_IP
```

Open `http://localhost:6080/vnc.html` locally, complete Google/Naukri sign-in,
and wait for the container to exit. Repeat for the independent Naukri auto-apply
and Wellfound profiles by overriding the login target:

```bash
docker compose --profile login run --rm --service-ports naukri-login interactive-login naukri
docker compose --profile login run --rm --service-ports naukri-login interactive-login wellfound
```

Then restart the hourly service:

```bash
docker compose up -d naukri-refresh
```

The noVNC port must remain bound to `127.0.0.1` as shown in `compose.yaml`; do not
add a public Oracle security-list rule for port 6080. Once login is complete, the
profile under `runtime/naukri-chrome-profile/` is reused every hour until Google or
Naukri invalidates it.

## Auto-apply rollout

Start the scheduled auto-apply services in dry-run mode first:

```bash
docker compose --profile auto-apply up --build -d
docker compose logs -f naukri-auto-apply wellfound-auto-apply
```

Dry runs fill forms but do not submit them. After reviewing their behavior, set
`AUTO_APPLY_LIVE=1` only in the server's private `.env`, then recreate the services:

```bash
docker compose --profile auto-apply up -d --force-recreate
```

The auto-apply services use separate per-site locks, so both sites can run together
while duplicate runs of the same site cannot overlap. Daily caps in the application
runner still apply: 50 for Naukri and 50 for Wellfound.

## Operations

```bash
docker compose ps
docker compose logs --tail=100 naukri-refresh
docker compose --profile auto-apply logs --tail=100 naukri-auto-apply wellfound-auto-apply
docker compose restart naukri-refresh
docker compose down
```

The image uses Chromium with an X virtual framebuffer because the automation uses
a headed browser. Target sites can still show CAPTCHA or require re-authentication;
this cannot safely be bypassed.
