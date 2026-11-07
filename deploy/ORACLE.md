# Oracle Cloud deployment

This deployment runs only the hourly Naukri profile-refresh task. Auto-apply is
deliberately not scheduled by default: first test each site in dry-run mode.

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

Start the hourly service:

```bash
docker compose up --build -d
docker compose logs -f naukri-refresh
```

## First login

The service needs a one-time manual Google/Naukri login inside its persistent
Chrome profile. It intentionally does not store or type a Google password. A
secure temporary noVNC console is provided, bound to the VM's `localhost` only.

First stop the scheduler, then start the temporary login container:

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
and wait for the container to exit. Then restart the hourly service:

```bash
docker compose up -d naukri-refresh
```

The noVNC port must remain bound to `127.0.0.1` as shown in `compose.yaml`; do not
add a public Oracle security-list rule for port 6080. Once login is complete, the
profile under `runtime/naukri-chrome-profile/` is reused every hour until Google or
Naukri invalidates it.

## Operations

```bash
docker compose ps
docker compose logs --tail=100 naukri-refresh
docker compose restart naukri-refresh
docker compose down
```

The image uses Chromium with an X virtual framebuffer because the automation uses
a headed browser. Target sites can still show CAPTCHA or require re-authentication;
this cannot safely be bypassed.
