# SNF Config

Reverse-polling configuration & control plane for the SNF live install. The server is the source of truth; machines poll it. No IPs needed.

## Architecture

```
┌─────────────────────┐                    ┌───────────────────────────┐
│  Dashboard (React)  │ ──── PUT/POST ───▶ │                           │
└─────────────────────┘                    │   Express server          │
                                           │   + JSON state file       │
┌─────────────────────┐                    │   (Railway Volume)        │
│  13× TouchDesigner  │ ◀── GET config ─── │                           │
│  machines (totems,  │ ─── POST ack ────▶ │                           │
│  maps, LYM)         │                    └───────────────────────────┘
└─────────────────────┘
```

Three layers of settings merge to produce each machine's effective config:
**global → role → machine override**

## Settings model

| Scope    | Examples                                                       |
| -------- | -------------------------------------------------------------- |
| Global   | master brightness, totem & LYM blur, LYM volume, event_active, demo_mode |
| Role     | totem accent colour, map theme filter, LYM timeout                  |
| Machine  | brightness offset, display label, any field                    |

A machine override of `null` (or empty string) is treated as "clear me, fall back to role/global".

## Commands

Issued per-machine or bulk (per-role / all). Machine polls, sees `pending_command`, executes, acks.

- `reload_config` — force re-pull regardless of version
- `restart_td` — close and relaunch the .toe project
- `reboot_machine` — OS reboot

## Local dev

```bash
# from repo root
npm install --prefix server
npm install --prefix client

# terminal 1
ADMIN_PASSWORD=test MACHINE_KEY=dev npm --prefix server run dev

# terminal 2
npm --prefix client run dev
# → http://localhost:5173 (proxies /api → :3000)
```

## Deploy on Railway

1. Push this repo to GitHub.
2. New Railway service → connect repo.
3. Add a Volume mounted at `/app/data`.
4. Env vars:
   - `ADMIN_PASSWORD` — the shared password for the dashboard.
   - `MACHINE_KEY` — a long random string. Set as Storage on every TD machine.
   - `DATA_DIR` — `/app/data`
5. Deploy. The `postinstall` script builds the React client and the server serves it.

## TouchDesigner setup

For each machine:

1. Create an Engine COMP (or use your existing one).
2. Inside it, add:
   - A **Text DAT** named `config_poller` with the contents of `touchdesigner/config_poller.py`. Set it to **Run** off, **Extension** type — we call it as a module.
   - A **Table DAT** named `config_state` (empty — script fills it).
   - A **Text DAT** named `log`.
   - A **Timer CHOP** named `poll_timer`, length 5s, looping. In its Timer Callbacks DAT, on cycle:
     ```python
     def onCycle(timerOp, segment, interrupt):
         parent().op('config_poller').module.poll_config()
     ```
3. In the COMP's Storage (Common page → Edit Storage), set:
   - `machine_id` → e.g. `totem-1`, `map-3`, `lym-2`
   - `config_server` → `https://your-snf-config.up.railway.app`
   - `machine_key` → matches `MACHINE_KEY` on Railway
   - `td_version` → optional, for tracking
   - `last_config_version` → `0`
4. Wire `config_state` Table DAT values into your project. Recommended pattern:
   - Use a DAT Execute or a Select DAT with a CHOP Execute to extract specific keys into CHOPs/Parameters as values change.
   - Or use a Python expression like:
     ```python
     op('config_state')['global.brightness', 'value'] or 1.0
     ```

### Available config keys in `config_state` table

- `global.brightness` (0–1, includes per-machine offset)
- `global.pre_shrink` (1–8, Totem Blur TOP pre-shrink)
- `global.filter_size` (0–32 px, Totem Blur TOP filter size)
- `global.lym_pre_shrink` (1–8, LYM Blur TOP pre-shrink)
- `global.lym_filter_size` (1–32 px, LYM Blur TOP filter size)
- `global.lym_volume` (0–1, LYM master volume)
- `global.map_lineup_slide` (true/false, show the line-up slide on map screens)
- `global.event_active` (true/false)
- `global.demo_mode` (true/false)
- `global.kiosk_lock` (true/false)
- `role.*` — every role-level setting, after machine overrides applied
- `_meta.machine_id`, `_meta.role`, `_meta.label`, `_meta.version`

## Adding new settings later

To add a new setting (e.g. a `bloom` amount):

1. Add to `DEFAULT_GLOBAL` and/or `DEFAULT_ROLE_SETTINGS` in `server/server.js`.
2. Add a control in the relevant panel in `client/src/App.jsx`.
3. Wire the new key in TD. Old saved state will be merged with defaults on next server start — no migration needed.

## Notes

- State is persisted to `data/state.json`. The Railway Volume keeps this across deploys.
- Machine status (online / last seen) is derived from poll timestamps. Anything not seen in 30s is marked offline.
- The `version` integer increments on every config change. Machines only re-apply when it changes — keeps poll traffic cheap and TD updates clean.
