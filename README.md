# Job OS

A personal job-search system: a Python/SQLite core (`job_os.py`), operated by the Hermes agent, with a phone-first Next.js dashboard reached over **Tailscale Serve**.

> **Status: implemented, not deployed.** Everything here passes unit tests and a run against a *fake* Hermes. Nothing has run on the real machine, real Tailscale or real Hermes yet. The product-defining test is the chain **iPhone on cellular → Serve → dashboard → Hermes → `job_os.py`** ([smoke test](#live-smoke-test)). Don't build more features until it passes.

This repo is **public**. It contains code and synthetic examples only. Your real `profile.json`, companies, database, drafts and chat history live in `JOB_OS_DIR`, outside git.

## What's here

| Path | What |
|---|---|
| `job_os.py` | Every rule: prescreen, skill-graph match, versioned drafts, status machine with evidence notes, JST deadlines, prep, JSON views. Stdlib only. |
| `skill/SKILL.md` | Hermes skill: hard rules (never submit, never send, data only through `job_os.py`) and workflows. |
| `examples/` | Synthetic `profile.json`, `skills_graph.json`, `companies.json`. |
| `tests/` | Python unit tests (16). |
| `web/` | Next.js 16 dashboard: Today, Pipeline, Job, Prep, Readiness, Hermes chat. |
| `web/proxy.ts` | Tailscale identity allowlist on every request. |
| `web/server.mjs` | Production server; binds only to loopback or a Unix socket. |
| `web/lib/turns.ts` | Server-owned Hermes turns: dedupe, one-at-a-time, resume after a dropped connection. |
| `scripts/check-local-forgery.sh` | Tests whether a local process can forge the identity header. |

**P0 only.** Debriefs, drills, the evidence finder, the ES answer bank and calendar sync (P1) aren't built. Dashboard approvals are P2: Hermes' API server denies dangerous commands straight away, and that denial is the intended behaviour.

## Quick start (on your PC, no Tailscale)

```bash
export JOB_OS_DIR=~/job-os-data
python3 job_os.py init --example        # copies the synthetic examples; then replace them with your own
python3 -m unittest discover -s tests

cd web
npm install
npm test                                 # parser, auth, turn-store tests
PORT=8649 node test/fake-hermes.mjs &    # FAKE gateway, for UI work only
JOB_OS_DIR=$JOB_OS_DIR JOB_OS_DEV_LOGIN=you@example.com ALLOWED_TAILSCALE_LOGINS=you@example.com \
  HERMES_URL=http://127.0.0.1:8649 HERMES_API_KEY=test-key npm run dev
```

`JOB_OS_DEV_LOGIN` works only under `next dev`. It's ignored in production.

## CLI

```bash
python3 job_os.py add --company "株式会社Example" --title "Frontend" --posting-file posting.txt \
  --requirements "typescript,react" --preferred "go"
python3 job_os.py match <id>
python3 job_os.py draft <id>                       # refused on BLOCK unless you record an override
python3 job_os.py override <id> --reason "..."      # you only, never Hermes
python3 job_os.py record <id> --status applied --note "<quote the confirmation email>"
python3 job_os.py schedule <id> --action "1次面接" --due 2026-10-03T14:00 --kind interview   # JST
python3 job_os.py due | list | verify | prep <id>
python3 job_os.py api today|pipeline|readiness|job <id>|prep <id>   # JSON for the dashboard
```

## Deploying on the Hermes machine

1. **Data:** `JOB_OS_DIR` outside the repo, `chmod 700`. Put your reviewed `profile.json` and the other config there.
2. **Users:** run the dashboard and Hermes as **different OS users**. Otherwise the socket permissions below mean nothing.
3. **Hermes:** the API server stays on `127.0.0.1:8642`. Copy `skill/SKILL.md` into Hermes' skills. Leave dangerous-command approval on its default, **deny**. Never enable unattended auto-approval.
4. **Dashboard:**
   ```bash
   cd web && cp .env.example .env.local   # fill it in
   npm ci && npm run build && npm start
   ```
5. **Tailscale Serve** (never Funnel):
   ```bash
   tailscale serve --bg unix:/run/job-os/web.sock   # only if your version accepts a unix: target
   tailscale serve --bg http://127.0.0.1:3000       # otherwise (option 2)
   tailscale funnel status                          # must show nothing
   ```
   Check whether your Tailscale version can proxy to a Unix socket. If it can't, use loopback and see [the local-forgery boundary](#local-forgery-boundary).
6. **Access rules:** in the tailnet policy, let only your user reach this machine's Serve port. For example:
   ```json
   { "grants": [ { "src": ["you@example.com"], "dst": ["tag:job-os-host"], "ip": ["tcp:443"] } ] }
   ```
   Keep the **iPhone and PC untagged**. Tagged devices get no `Tailscale-User-Login`, so they get a 403.
7. **iPhone:** open the Serve URL in Safari → Share → Add to Home Screen.

## Security boundaries

| Layer | Control |
|---|---|
| Network | `server.mjs` refuses any non-loopback bind. Only `tailscale serve` reaches it. Hermes stays on 127.0.0.1. No Funnel. |
| Identity | `proxy.ts` requires `Tailscale-User-Login` in `ALLOWED_TAILSCALE_LOGINS`. Trustworthy **only through Serve**, which sets the header and strips spoofed copies. |
| CSRF | Every write route checks `Origin` against the host or `DASHBOARD_ORIGIN`. |
| Commands | `execFile` with fixed argument arrays. Ids, statuses, lengths and dates are validated before the CLI is called. |
| Agent | SKILL.md hard rules plus per-request instructions. Web pages and emails are treated as data. |
| Phone | The service worker caches only hashed JS/CSS, icons and `offline.html`. Pages and API responses are `no-store`. Chat history lives on the server. Offline shows a panel, never stale data. |
| Headers | `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, `noindex`. |

### Local-forgery boundary

Any process on the server can call the dashboard directly and set `Tailscale-User-Login` to anything, including Hermes' own terminal tool. Serve's guarantee doesn't cover those requests.

- **Option 1 (preferred): Unix socket.** `LISTEN=unix:/run/job-os/web.sock` with `SOCKET_MODE=660`, and a group that contains only the dashboard user and `tailscaled`. Other OS users get "permission denied".
- **Option 2: loopback.** Keep `127.0.0.1` and record the gap. Hermes can already run `job_os.py`, so it gains no write power, but it does bypass the identity and CSRF checks.

Test it as the Hermes user:

```bash
sudo -u <hermes-user> scripts/check-local-forgery.sh unix:/run/job-os/web.sock you@example.com   # expect REFUSED
```

## Hermes chat contract

**Not validated yet.** `web/lib/sse.ts` assumes the `/v1/responses` SSE shape. The first live session must record a real stream (see `web/test/fixtures/README.md`) and make it the test fixture.

- Every message carries a `clientMsgId`. A repeat returns `409 duplicate` and never makes a second Hermes request.
- Each conversation allows one turn at a time. A second send returns `409 busy`.
- The server reads Hermes to the end even if the phone drops. The phone resumes with `GET /api/hermes/turns/<id>?after=<seq>`. The server never re-sends the prompt.
- Stop reads **"Stop showing"** until the live test proves an abort cancels the run. After that, set `HERMES_STOP_CANCELS=true`.
- Conversations are `job-os` or `job-os:<job-id>`. If named conversations don't work live, set `HERMES_CONTINUATION=previous_response_id`.
- **Chat is for questions** until these checks pass. Statuses and deadlines go through the dashboard forms.

## Live smoke test

Run it in order and stop at the first failure. Nothing counts as *Live* until it passes with the iPhone on **cellular (Wi-Fi off)**.

*Network and identity*

- [ ] `curl 127.0.0.1:8642/health` works on the server. From another tailnet device, ports 8642 and 3000 are unreachable.
- [ ] `tailscale funnel status` shows nothing.
- [ ] On cellular, the Serve URL opens Today in under 2 s.
- [ ] A second tailnet account gets a 403 that names it. A tagged device gets the "no identity" 403.
- [ ] `check-local-forgery.sh`, run as the Hermes user, prints REFUSED (option 1) or the result is documented (option 2).

*The chain*

- [ ] On cellular, ask "What's due this week?" You should see streamed text, a `job_os.py` tool event, and an answer that matches `job_os.py due`.
- [ ] Record that stream as the fixture.
- [ ] Record a status from a job's form, then check `job_os.py list`.

*Chat contract*

- [ ] Two messages in `job-os:<id>` keep context. Another id doesn't see it.
- [ ] Sending the same message twice makes one Hermes request.
- [ ] Airplane mode mid-answer, then back on: the turn resumes, and Hermes logs show no second request.
- [ ] Stop: check the Hermes logs to see whether the run was cancelled, then set `HERMES_STOP_CANCELS`.

*Safety*

- [ ] "Submit my application": Hermes refuses and cites the hard rule.
- [ ] A dangerous command is denied, and the phone shows the denial row.
- [ ] A posting containing 「日本語ネイティブ」 is BLOCKed by prescreen.

*Phone storage*

- [ ] After using chat and prep, Safari Web Inspector shows no personal data in localStorage, IndexedDB or Cache Storage.
- [ ] Airplane mode shows the Offline panel and no deadlines.
