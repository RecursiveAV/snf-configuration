// SNF Config Server
// Single source of truth for machine configuration.
// Machines poll us — we never need to know their IPs.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------- Config / paths ----------
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const MACHINE_KEY = process.env.MACHINE_KEY || 'snf-machines';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Default machine layout ----------
// 4 totems, 6 maps, 3 LYM = 13 machines
const DEFAULT_MACHINES = [
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `totem-${i + 1}`,
    role: 'totem',
    label: `Totem ${i + 1}`,
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `map-${i + 1}`,
    role: 'map',
    label: `Grantee Map ${i + 1}`,
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `lym-${i + 1}`,
    role: 'lym',
    label: `Leave Your Mark ${i + 1}`,
  })),
];

// ---------- Default settings ----------
const DEFAULT_GLOBAL = {
  master_brightness: 1.0,
  pre_shrink: 1,              // Blur TOP pre-shrink (downscale factor), 1–8
  filter_size: 0.0,          // Blur TOP filter size (radius px), 0–32
  demo_mode: false,
  kiosk_lock: true,
  event_active: true,
};

const DEFAULT_ROLE_SETTINGS = {
  totem: {
    pre_shrink: null,          // null = inherit global
    filter_size: null,
    idle_animation_speed: 1.0,
    accent_colour: '#68b6ff',
    attract_text: 'Touch to begin',
    touch_sensitivity: 0.7,
  },
  map: {
    pre_shrink: null,
    filter_size: null,
    theme_filter: 'none',
    marker_pulse_speed: 1.0,
    show_grantee_count: true,
    map_zoom_default: 1.0,
  },
  lym: {
    pre_shrink: null,
    filter_size: null,
    submission_timeout_seconds: 60,
    confirmation_message: 'Thank you — your mark has been left.',
    enable_test_pattern: false,
    text_input_max_chars: 280,
  },
};

const DEFAULT_MACHINE_OVERRIDES = {
  // Empty by default. Each machine can hold any of:
  //   brightness_offset (-0.2..+0.2)
  //   display_label     string
  //   ...and any per-role field to override that role's value
};

// ---------- State ----------
let state = loadState();

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return {
        global: { ...DEFAULT_GLOBAL, ...(raw.global || {}) },
        roles: {
          totem: { ...DEFAULT_ROLE_SETTINGS.totem, ...(raw.roles?.totem || {}) },
          map: { ...DEFAULT_ROLE_SETTINGS.map, ...(raw.roles?.map || {}) },
          lym: { ...DEFAULT_ROLE_SETTINGS.lym, ...(raw.roles?.lym || {}) },
        },
        machines: raw.machines || DEFAULT_MACHINES.map(m => ({
          ...m,
          overrides: {},
          status: { online: false, lastSeen: null, td_version: null },
          pending_command: null,
        })),
        version: raw.version || 1,
      };
    } catch (e) {
      console.error('State load failed, using defaults:', e.message);
    }
  }
  return {
    global: { ...DEFAULT_GLOBAL },
    roles: JSON.parse(JSON.stringify(DEFAULT_ROLE_SETTINGS)),
    machines: DEFAULT_MACHINES.map(m => ({
      ...m,
      overrides: {},
      status: { online: false, lastSeen: null, td_version: null },
      pending_command: null,
    })),
    version: 1,
  };
}

let saveTimer = null;
function saveState() {
  // Debounce writes; we get a lot of status pings
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }, 250);
}

function bumpVersion() {
  state.version += 1;
  saveState();
}

// ---------- Config resolution ----------
// Layer order: global -> role -> machine overrides
function resolveConfig(machineId) {
  const m = state.machines.find(x => x.id === machineId);
  if (!m) return null;

  const roleCfg = state.roles[m.role] || {};
  const overrides = m.overrides || {};

  // Compute effective blur params: role override > global (no machine layer)
  let pre_shrink = state.global.pre_shrink;
  if (roleCfg.pre_shrink !== null && roleCfg.pre_shrink !== undefined) {
    pre_shrink = roleCfg.pre_shrink;
  }
  let filter_size = state.global.filter_size;
  if (roleCfg.filter_size !== null && roleCfg.filter_size !== undefined) {
    filter_size = roleCfg.filter_size;
  }

  // Compute effective brightness
  let brightness = state.global.master_brightness;
  if (typeof overrides.brightness_offset === 'number') {
    brightness = Math.max(0, Math.min(1, brightness + overrides.brightness_offset));
  }

  // Merge role + overrides, replacing nulls with role defaults
  const mergedRole = { ...roleCfg };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== null && v !== undefined && v !== '') {
      mergedRole[k] = v;
    }
  }
  // Blur is resolved into the global block below; don't echo raw role values
  delete mergedRole.pre_shrink;
  delete mergedRole.filter_size;

  return {
    machine_id: m.id,
    role: m.role,
    label: overrides.display_label || m.label,
    version: state.version,
    global: {
      demo_mode: state.global.demo_mode,
      kiosk_lock: state.global.kiosk_lock,
      event_active: state.global.event_active,
      brightness,
      pre_shrink,
      filter_size,
      brightness_offset: overrides.brightness_offset ?? 0,
    },
    role_settings: mergedRole,
    pending_command: m.pending_command,
  };
}

// ---------- Auth middleware ----------
function adminAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function machineAuth(req, res, next) {
  const key = req.headers['x-machine-key'];
  if (key !== MACHINE_KEY) {
    return res.status(401).json({ error: 'Bad machine key' });
  }
  next();
}

// ---------- Machine endpoints (called by TouchDesigner) ----------

// Machine polls this on a timer. Returns its resolved config.
app.get('/api/machine/:id/config', machineAuth, (req, res) => {
  const cfg = resolveConfig(req.params.id);
  if (!cfg) return res.status(404).json({ error: 'Unknown machine' });

  // Mark online + bump status
  const m = state.machines.find(x => x.id === req.params.id);
  m.status.online = true;
  m.status.lastSeen = new Date().toISOString();
  if (req.query.td_version) m.status.td_version = req.query.td_version;
  saveState();

  res.json(cfg);
});

// Machine acknowledges a command was received & executed.
app.post('/api/machine/:id/ack', machineAuth, (req, res) => {
  const m = state.machines.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Unknown machine' });
  const { command_id, result } = req.body || {};
  if (m.pending_command && m.pending_command.id === command_id) {
    m.pending_command = null;
    m.status.last_command_result = { id: command_id, result, at: new Date().toISOString() };
    saveState();
  }
  res.json({ ok: true });
});

// ---------- Admin endpoints (called by dashboard) ----------

app.post('/api/auth', (req, res) => {
  if (req.body?.password === ADMIN_PASSWORD) {
    return res.json({ token: ADMIN_PASSWORD });
  }
  res.status(401).json({ error: 'Wrong password' });
});

app.get('/api/admin/state', adminAuth, (req, res) => {
  // Mark stale machines offline (no poll in 30s)
  const cutoff = Date.now() - 30000;
  for (const m of state.machines) {
    if (m.status.lastSeen && new Date(m.status.lastSeen).getTime() < cutoff) {
      m.status.online = false;
    }
  }
  res.json(state);
});

app.put('/api/admin/global', adminAuth, (req, res) => {
  state.global = { ...state.global, ...req.body };
  bumpVersion();
  res.json(state.global);
});

app.put('/api/admin/role/:role', adminAuth, (req, res) => {
  const role = req.params.role;
  if (!state.roles[role]) return res.status(404).json({ error: 'Unknown role' });
  state.roles[role] = { ...state.roles[role], ...req.body };
  bumpVersion();
  res.json(state.roles[role]);
});

app.put('/api/admin/machine/:id/overrides', adminAuth, (req, res) => {
  const m = state.machines.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Unknown machine' });
  m.overrides = { ...m.overrides, ...req.body };
  // Strip null/undefined to "clear" an override
  for (const k of Object.keys(m.overrides)) {
    if (m.overrides[k] === null || m.overrides[k] === '') delete m.overrides[k];
  }
  bumpVersion();
  res.json(m);
});

app.post('/api/admin/machine/:id/command', adminAuth, (req, res) => {
  const m = state.machines.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Unknown machine' });
  const valid = ['restart_td', 'reboot_machine', 'reload_config'];
  if (!valid.includes(req.body?.type)) {
    return res.status(400).json({ error: 'Invalid command' });
  }
  m.pending_command = {
    id: crypto.randomUUID(),
    type: req.body.type,
    issued_at: new Date().toISOString(),
  };
  saveState();
  res.json(m.pending_command);
});

// Bulk command — apply to a role or all
app.post('/api/admin/command/bulk', adminAuth, (req, res) => {
  const { type, target } = req.body || {};
  const valid = ['restart_td', 'reboot_machine', 'reload_config'];
  if (!valid.includes(type)) return res.status(400).json({ error: 'Invalid command' });

  const targets = target === 'all'
    ? state.machines
    : state.machines.filter(m => m.role === target);

  const issued = [];
  for (const m of targets) {
    m.pending_command = {
      id: crypto.randomUUID(),
      type,
      issued_at: new Date().toISOString(),
    };
    issued.push(m.id);
  }
  saveState();
  res.json({ issued });
});

// ---------- Static client ----------
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`SNF Config Server listening on ${PORT}`);
  console.log(`Machines: ${state.machines.length}, version: ${state.version}`);
});
