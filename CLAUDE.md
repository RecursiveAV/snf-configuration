# SNF Config — Project Context for Claude Code

## What this is

A configuration & control plane for the **SNF "Leave Your Mark" live event installation**. The server is the source of truth; 13 TouchDesigner machines poll it every 5 seconds. No machine IPs are ever needed.

Sister project: **SNF Grant Moderator** (separate Railway service) handles the public-facing grant submission flow. This config app is operator-facing only.

## The 13 machines

| Role  | Count | ID format            | Purpose                                  |
| ----- | ----- | -------------------- | ---------------------------------------- |
| totem | 4     | `totem-1`..`totem-4` | Floor-standing interactive towers        |
| map   | 6     | `map-1`..`map-6`     | Grantee map displays                     |
| lym   | 3     | `lym-1`..`lym-3`     | "Leave Your Mark" submission stations    |

## Architecture

```
Dashboard (React)  ──PUT/POST──▶  Express server (Railway)
                                        ▲
                                  GET /config every 5s
                                        │
                          13× TouchDesigner machines
```

**Settings model — three layers, merged server-side:**
1. **Global** — applies to all 13 (master brightness, master blur, demo mode, event_active, kiosk_lock)
2. **Per-role** — applies to all of one role (e.g. totem accent colour, map theme filter)
3. **Per-machine override** — final say (brightness_offset, blur_offset, display_label, any role field)

A null/empty override means "fall back to role/global". This is how setting `blur_offset` to `0` clears it on save.

**Commands** are separate from settings: `restart_td`, `reboot_machine`, `reload_config`. Server queues one per machine; machine acks on next poll.

## Repo layout

```
server/server.js          Express, three-layer config resolver, command queue
client/src/App.jsx        Whole React app — login, nav, all panels
client/src/styles.css     Fraunces + JetBrains Mono, brand colours
touchdesigner/config_poller.py    Drop into Text DAT in Engine COMP on each machine
README.md                 Deployment + TD setup
railway.json              Railway build config
```

State persists to `data/state.json` (Railway Volume in production, gitignored locally).

## Deployment

- Hosted on **Railway**, auto-deploys from `main`
- Volume mounted at `/app/data`
- Env vars: `ADMIN_PASSWORD`, `MACHINE_KEY`, `DATA_DIR=/app/data`
- The `postinstall` script builds the React client; server serves it from `client/dist/`

## Brand & visual conventions

- Dark navy background: `rgb(17, 33, 50)`
- Blue accent: `rgb(104, 182, 255)` — the SNF house blue
- Reds for rejection/danger only
- Display font: **Fraunces** (italic emphasis for personality)
- Body/mono font: **JetBrains Mono**
- Themes have specific RGB brand colours: Arts+Culture, Health+Sports, Social+Welfare, Education

## Working preferences

- **Pragmatic over clever.** Prefer minimal changes; mounting a volume beats refactoring persistence logic.
- **Test the loop end-to-end before scaling.** Wire one TD machine before all 13.
- **Engine COMP isolation in TD.** Never use synchronous network calls on the main timeline — they freeze it. Polling lives in an Engine COMP.
- **Tag stable deploys** (`git tag v1.0-event-ready`) before the live event so rollback is one command.
- **Never push directly to `main` during the event.** Branch, test, merge calmly.
- Discuss meaningful changes before editing files. Don't refactor without being asked.

## Known patterns established in sister project

- API keys via env vars (survives restarts; session tokens don't)
- Railway Volumes at `/app/data` for JSON persistence
- ngrok for Railway → TouchDesigner callbacks (when needed)
- Schema-migration awareness: old persisted records won't auto-gain new fields

## TD-side wiring reminder

Each machine needs Storage on the parent COMP of `config_poller`:
- `machine_id` — unique, matches server (`totem-1` etc.)
- `config_server` — Railway URL
- `machine_key` — matches `MACHINE_KEY` env var on Railway
- `last_config_version` — starts at 0

A Timer CHOP fires every 5s and calls `parent().op('config_poller').module.poll_config()`.
The `config_state` Table DAT gets populated with key/value rows that the TD project reads from via expressions.

## Things not to do

- Don't commit `data/` or `.env` (already gitignored, but worth a glance)
- Don't reproduce song lyrics or copyrighted text in any UI strings (event-facing content)
- Don't add IP-address-based logic — the whole point of this architecture is the machines poll out
- Don't introduce a database; lowdb-style JSON on the volume is sufficient for 13 machines
