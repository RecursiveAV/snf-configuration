import React, { useState, useEffect, useCallback, useRef } from 'react';

const ROLE_LABELS = { totem: 'Totems', map: 'Grantee Maps', lym: 'Leave Your Mark' };

// ---------- API helpers ----------
const api = {
  token: () => localStorage.getItem('snf_token') || '',
  async req(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${api.token()}`,
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json();
  },
  login: (password) =>
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }).then(async (r) => {
      if (!r.ok) throw new Error('Wrong password');
      return r.json();
    }),
};

// ---------- Save state hook ----------
function useSaveState() {
  const [state, setState] = useState('idle');
  const ref = useRef();
  const set = useCallback((s) => {
    setState(s);
    clearTimeout(ref.current);
    if (s === 'saved' || s === 'error') {
      ref.current = setTimeout(() => setState('idle'), 1800);
    }
  }, []);
  return [state, set];
}

// ---------- Login ----------
function Login({ onAuth }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const { token } = await api.login(password);
      localStorage.setItem('snf_token', token);
      onAuth();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div>
        <div className="sub">SNF · Live Install</div>
        <h1>Configuration</h1>
        <div style={{ height: 32 }} />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          autoFocus
        />
        {error && (
          <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 16 }}>{error}</div>
        )}
        <button className="primary" onClick={submit} disabled={busy || !password}>
          {busy ? 'Authenticating…' : 'Enter'}
        </button>
      </div>
    </div>
  );
}

// ---------- Reusable controls ----------
function SliderControl({ label, hint, value, onChange, min, max, step }) {
  const onNum = (raw) => {
    if (raw === '') { onChange(null); return; }
    const n = parseFloat(raw);
    if (Number.isNaN(n)) return;
    onChange(Math.min(max, Math.max(min, n)));
  };
  return (
    <div className="control">
      <div className="name">
        {label}
        {hint && <span className="hint">{hint}</span>}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value ?? min}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <input
        type="number"
        className="value-input"
        min={min}
        max={max}
        step={step}
        value={value ?? ''}
        onChange={(e) => onNum(e.target.value)}
      />
    </div>
  );
}

function ToggleControl({ label, hint, value, onChange }) {
  return (
    <div className="control">
      <div className="name">
        {label}
        {hint && <span className="hint">{hint}</span>}
      </div>
      <div>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      </div>
      <div className={`value-display ${value ? '' : 'muted'}`}>{value ? 'ON' : 'OFF'}</div>
    </div>
  );
}

function TextControl({ label, hint, value, onChange, placeholder }) {
  return (
    <div className="control" style={{ gridTemplateColumns: '200px 1fr' }}>
      <div className="name">
        {label}
        {hint && <span className="hint">{hint}</span>}
      </div>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function NumberControl({ label, hint, value, onChange, min, max, step }) {
  return (
    <div className="control">
      <div className="name">
        {label}
        {hint && <span className="hint">{hint}</span>}
      </div>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
      />
      <div className="value-display">{value ?? '—'}</div>
    </div>
  );
}

function SelectControl({ label, hint, value, onChange, options }) {
  return (
    <div className="control">
      <div className="name">
        {label}
        {hint && <span className="hint">{hint}</span>}
      </div>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <div className="value-display">{value}</div>
    </div>
  );
}

function ColourControl({ label, hint, value, onChange }) {
  return (
    <div className="control">
      <div className="name">
        {label}
        {hint && <span className="hint">{hint}</span>}
      </div>
      <div className="colour-input">
        <input type="color" value={value || '#68b6ff'} onChange={(e) => onChange(e.target.value)} />
        <input type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} />
      </div>
      <div className="value-display" style={{ fontSize: 12 }}>{value}</div>
    </div>
  );
}

// ---------- Global panel ----------
function GlobalPanel({ state, save }) {
  const g = state.global;
  const upd = (patch) => save('/api/admin/global', patch);
  return (
    <>
      <div className="section-head">
        <h2>Global <em>settings</em></h2>
        <div className="crumb">Applies to all 13 machines</div>
      </div>
      <div className="controls">
        <SliderControl label="Master Brightness" hint="0.00 – 1.00"
          value={g.master_brightness} min={0} max={1} step={0.01}
          onChange={(v) => upd({ master_brightness: v })} />
        <ToggleControl label="Event Active" hint="Master on/off for live event"
          value={g.event_active} onChange={(v) => upd({ event_active: v })} />
        <ToggleControl label="Demo Mode" hint="Cycle fake content for previews"
          value={g.demo_mode} onChange={(v) => upd({ demo_mode: v })} />
        <ToggleControl label="Kiosk Lock" hint="Disable TD exit shortcuts"
          value={g.kiosk_lock} onChange={(v) => upd({ kiosk_lock: v })} />

        <h4 className="subsection-head">Totems</h4>
        <SliderControl label="Pre-Shrink" hint="1 – 8 · downscale before blur"
          value={g.pre_shrink} min={1} max={8} step={1}
          onChange={(v) => upd({ pre_shrink: v })} />
        <SliderControl label="Filter Size" hint="0 – 32 px · blur radius"
          value={g.filter_size} min={0} max={32} step={0.5}
          onChange={(v) => upd({ filter_size: v })} />

        <h4 className="subsection-head">Leave Your Mark</h4>
        <SliderControl label="Pre-Shrink" hint="1 – 8 · downscale before blur"
          value={g.lym_pre_shrink} min={1} max={8} step={1}
          onChange={(v) => upd({ lym_pre_shrink: v })} />
        <SliderControl label="Filter Size" hint="1 – 32 px · blur radius"
          value={g.lym_filter_size} min={1} max={32} step={1}
          onChange={(v) => upd({ lym_filter_size: v })} />
        <SliderControl label="Master Volume" hint="0.0 – 1.0"
          value={g.lym_volume} min={0} max={1} step={0.1}
          onChange={(v) => upd({ lym_volume: v })} />
      </div>
    </>
  );
}

// ---------- Role panel ----------
function RolePanel({ state, save, role, sendBulk }) {
  const r = state.roles[role];
  const upd = (patch) => save(`/api/admin/role/${role}`, patch);
  const count = state.machines.filter((m) => m.role === role).length;

  return (
    <>
      <div className="section-head">
        <h2>{ROLE_LABELS[role]} <em>defaults</em></h2>
        <div className="crumb">{count} machines · role-level settings</div>
      </div>
      <div className="controls">
        {role === 'totem' && <TotemControls r={r} upd={upd} />}
        {role === 'map' && <MapControls r={r} upd={upd} />}
        {role === 'lym' && <LymControls r={r} upd={upd} />}
      </div>

      <div className="bulk-actions">
        <h4>Bulk actions for all {ROLE_LABELS[role].toLowerCase()}</h4>
        <div className="actions">
          <button onClick={() => sendBulk('reload_config', role)}>Reload config</button>
          <button onClick={() => sendBulk('restart_td', role)}>Restart TD</button>
          <button className="danger" onClick={() => {
            if (confirm(`Reboot all ${count} ${role} machines?`)) sendBulk('reboot_machine', role);
          }}>Reboot machines</button>
        </div>
      </div>
    </>
  );
}

function TotemControls({ r, upd }) {
  return (
    <>
      <SliderControl label="Idle Animation Speed" hint="0.1 – 3.0"
        value={r.idle_animation_speed} min={0.1} max={3} step={0.1}
        onChange={(v) => upd({ idle_animation_speed: v })} />
      <ColourControl label="Accent Colour" hint="Hex"
        value={r.accent_colour} onChange={(v) => upd({ accent_colour: v })} />
      <TextControl label="Attract Text" hint="Shown when idle"
        value={r.attract_text} onChange={(v) => upd({ attract_text: v })} />
      <SliderControl label="Touch Sensitivity" hint="0.0 – 1.0"
        value={r.touch_sensitivity} min={0} max={1} step={0.05}
        onChange={(v) => upd({ touch_sensitivity: v })} />
    </>
  );
}

function MapControls({ r, upd }) {
  return (
    <>
      <SelectControl label="Theme Filter" hint="Limit visible grants"
        value={r.theme_filter} onChange={(v) => upd({ theme_filter: v })}
        options={[
          { value: 'none', label: 'None (show all)' },
          { value: 'Arts+Culture', label: 'Arts + Culture' },
          { value: 'Health+Sports', label: 'Health + Sports' },
          { value: 'Social+Welfare', label: 'Social + Welfare' },
          { value: 'Education', label: 'Education' },
        ]} />
      <SliderControl label="Marker Pulse Speed" hint="0.1 – 3.0"
        value={r.marker_pulse_speed} min={0.1} max={3} step={0.1}
        onChange={(v) => upd({ marker_pulse_speed: v })} />
      <ToggleControl label="Show Grantee Count"
        value={r.show_grantee_count} onChange={(v) => upd({ show_grantee_count: v })} />
      <SliderControl label="Default Map Zoom"
        value={r.map_zoom_default} min={0.5} max={3} step={0.05}
        onChange={(v) => upd({ map_zoom_default: v })} />
    </>
  );
}

function LymControls({ r, upd }) {
  return (
    <>
      <NumberControl label="Submission Timeout" hint="Seconds before reset"
        value={r.submission_timeout_seconds} min={5} max={600} step={5}
        onChange={(v) => upd({ submission_timeout_seconds: v })} />
      <TextControl label="Confirmation Message" hint="Shown after submit"
        value={r.confirmation_message} onChange={(v) => upd({ confirmation_message: v })} />
      <NumberControl label="Max Characters" hint="Text input limit"
        value={r.text_input_max_chars} min={10} max={1000} step={10}
        onChange={(v) => upd({ text_input_max_chars: v })} />
      <ToggleControl label="Test Pattern" hint="Force test display"
        value={r.enable_test_pattern} onChange={(v) => upd({ enable_test_pattern: v })} />
    </>
  );
}

// ---------- Machine panel ----------
function MachinePanel({ state, save, machine, sendCommand }) {
  const upd = (patch) => save(`/api/admin/machine/${machine.id}/overrides`, patch);
  const ov = machine.overrides || {};
  const role = machine.role;
  const roleDefaults = state.roles[role];

  const overrideField = (key, defaultVal, label, hint, render) => {
    const isOverridden = ov[key] !== undefined && ov[key] !== null;
    const effective = isOverridden ? ov[key] : defaultVal;
    return render({
      label: (
        <>
          {label}
          {isOverridden && <span className="override-badge">OVERRIDDEN</span>}
        </>
      ),
      hint,
      value: effective,
      isOverridden,
      onChange: (v) => upd({ [key]: v }),
      onClear: () => upd({ [key]: null }),
    });
  };

  return (
    <>
      <div className="section-head">
        <h2>{machine.label}</h2>
        <div className="crumb">
          <span className={`dot ${machine.status?.online ? 'online' : 'offline'}`} style={{ marginRight: 8 }} />
          {machine.id} · {role} · {machine.status?.lastSeen
            ? `last seen ${new Date(machine.status.lastSeen).toLocaleTimeString()}`
            : 'never seen'}
        </div>
      </div>

      <div className="controls">
        <TextControl
          label="Display Label"
          hint="Friendly name shown in this dashboard"
          value={ov.display_label || machine.label}
          onChange={(v) => upd({ display_label: v === machine.label ? null : v })}
        />

        <SliderControl
          label="Brightness Offset"
          hint="-0.2 to +0.2 · added to global"
          value={ov.brightness_offset ?? 0}
          min={-0.2} max={0.2} step={0.01}
          onChange={(v) => upd({ brightness_offset: v === 0 ? null : v })}
        />

        {role === 'totem' && (
          <>
            {overrideField('accent_colour', roleDefaults.accent_colour, 'Accent Colour', 'Override role default', (p) => (
              <div className="control">
                <div className="name">{p.label}{p.hint && <span className="hint">{p.hint}</span>}</div>
                <div className="colour-input">
                  <input type="color" value={p.value || '#68b6ff'} onChange={(e) => p.onChange(e.target.value)} />
                  <input type="text" value={p.value || ''} onChange={(e) => p.onChange(e.target.value)} />
                  {p.isOverridden && <button className="clear-override" onClick={p.onClear}>clear</button>}
                </div>
                <div className="value-display" style={{ fontSize: 12 }}>{p.value}</div>
              </div>
            ))}
            {overrideField('attract_text', roleDefaults.attract_text, 'Attract Text', 'Per-machine override', (p) => (
              <div className="control" style={{ gridTemplateColumns: '200px 1fr auto' }}>
                <div className="name">{p.label}{p.hint && <span className="hint">{p.hint}</span>}</div>
                <input type="text" value={p.value || ''} onChange={(e) => p.onChange(e.target.value)} />
                {p.isOverridden && <button className="clear-override" onClick={p.onClear}>clear</button>}
              </div>
            ))}
          </>
        )}

        {role === 'map' && overrideField('theme_filter', roleDefaults.theme_filter, 'Theme Filter', 'Per-machine override', (p) => (
          <div className="control">
            <div className="name">{p.label}{p.hint && <span className="hint">{p.hint}</span>}</div>
            <select value={p.value || 'none'} onChange={(e) => p.onChange(e.target.value)}>
              <option value="none">None</option>
              <option value="Arts+Culture">Arts + Culture</option>
              <option value="Health+Sports">Health + Sports</option>
              <option value="Social+Welfare">Social + Welfare</option>
              <option value="Education">Education</option>
            </select>
            <div>{p.isOverridden && <button className="clear-override" onClick={p.onClear}>clear</button>}</div>
          </div>
        ))}

        {role === 'lym' && overrideField('confirmation_message', roleDefaults.confirmation_message, 'Confirmation Message', 'Per-machine override', (p) => (
          <div className="control" style={{ gridTemplateColumns: '200px 1fr auto' }}>
            <div className="name">{p.label}{p.hint && <span className="hint">{p.hint}</span>}</div>
            <input type="text" value={p.value || ''} onChange={(e) => p.onChange(e.target.value)} />
            {p.isOverridden && <button className="clear-override" onClick={p.onClear}>clear</button>}
          </div>
        ))}
      </div>

      <div className="actions">
        <button onClick={() => sendCommand(machine.id, 'reload_config')}>Reload Config</button>
        <button onClick={() => {
          if (confirm(`Restart TD on ${machine.label}?`)) sendCommand(machine.id, 'restart_td');
        }}>Restart TouchDesigner</button>
        <button className="danger" onClick={() => {
          if (confirm(`Reboot ${machine.label}? This will fully restart the machine.`)) {
            sendCommand(machine.id, 'reboot_machine');
          }
        }}>Reboot Machine</button>
      </div>

      {machine.pending_command && (
        <div style={{ marginTop: 24, padding: '12px 16px', border: '1px solid var(--amber)',
                      background: 'rgba(244,188,87,0.06)', fontSize: 12 }}>
          <span className="dot pending" style={{ marginRight: 10 }} />
          Awaiting <strong>{machine.pending_command.type}</strong> ack —
          issued {new Date(machine.pending_command.issued_at).toLocaleTimeString()}
        </div>
      )}
    </>
  );
}

// ---------- Overview panel ----------
function OverviewPanel({ state, onSelectMachine, sendBulk }) {
  const online = state.machines.filter((m) => m.status?.online).length;
  return (
    <>
      <div className="section-head">
        <h2>Overview</h2>
        <div className="crumb">{online} / {state.machines.length} online · config v{state.version}</div>
      </div>
      <div className="machine-grid">
        {state.machines.map((m) => (
          <div className="machine-card" key={m.id}
               onClick={() => onSelectMachine(m.id)}
               style={{ cursor: 'pointer' }}>
            <div className="top">
              <div className="id">{m.id}</div>
              <span className={`dot ${m.pending_command ? 'pending' : m.status?.online ? 'online' : 'offline'}`} />
            </div>
            <div className="label">{m.overrides?.display_label || m.label}</div>
            <div className="last-seen">
              {m.status?.lastSeen
                ? `last poll ${new Date(m.status.lastSeen).toLocaleTimeString()}`
                : 'never seen'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
              {ROLE_LABELS[m.role]}
            </div>
          </div>
        ))}
      </div>

      <div className="bulk-actions">
        <h4>All machines</h4>
        <div className="actions">
          <button onClick={() => sendBulk('reload_config', 'all')}>Reload config (all)</button>
          <button onClick={() => {
            if (confirm('Restart TD on ALL 13 machines?')) sendBulk('restart_td', 'all');
          }}>Restart TD (all)</button>
          <button className="danger" onClick={() => {
            if (confirm('Reboot ALL 13 machines? This is the nuclear option.')) sendBulk('reboot_machine', 'all');
          }}>Reboot all machines</button>
        </div>
      </div>
    </>
  );
}

// ---------- Main App ----------
export default function App() {
  const [authed, setAuthed] = useState(!!api.token());
  const [state, setState] = useState(null);
  const [view, setView] = useState({ type: 'overview' });
  const [saveState, setSaveState] = useSaveState();
  const [navOpen, setNavOpen] = useState(false);

  const selectView = useCallback((v) => {
    setView(v);
    setNavOpen(false);
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const s = await api.req('/api/admin/state');
      setState(s);
    } catch (e) {
      if (e.message === 'Unauthorized') {
        localStorage.removeItem('snf_token');
        setAuthed(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    fetchState();
    const t = setInterval(fetchState, 3000);
    return () => clearInterval(t);
  }, [authed, fetchState]);

  const save = useCallback(async (url, body) => {
    setSaveState('saving');
    try {
      await api.req(url, { method: 'PUT', body: JSON.stringify(body) });
      await fetchState();
      setSaveState('saved');
    } catch (e) {
      console.error(e);
      setSaveState('error');
    }
  }, [fetchState, setSaveState]);

  const sendCommand = useCallback(async (id, type) => {
    setSaveState('saving');
    try {
      await api.req(`/api/admin/machine/${id}/command`, {
        method: 'POST', body: JSON.stringify({ type }),
      });
      await fetchState();
      setSaveState('saved');
    } catch (e) {
      console.error(e);
      setSaveState('error');
    }
  }, [fetchState, setSaveState]);

  const sendBulk = useCallback(async (type, target) => {
    setSaveState('saving');
    try {
      await api.req('/api/admin/command/bulk', {
        method: 'POST', body: JSON.stringify({ type, target }),
      });
      await fetchState();
      setSaveState('saved');
    } catch (e) {
      console.error(e);
      setSaveState('error');
    }
  }, [fetchState, setSaveState]);

  if (!authed) return <Login onAuth={() => setAuthed(true)} />;
  if (!state) return <div className="login"><div className="sub">Loading…</div></div>;

  const onlineCount = state.machines.filter((m) => m.status?.online).length;

  return (
    <div className="app">
      <header className="top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="nav-toggle"
            aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
            onClick={() => setNavOpen((o) => !o)}
          >
            {navOpen ? '×' : '≡'}
          </button>
          <h1>SNF · <em>Live Install Config</em></h1>
        </div>
        <div className="meta">
          <span className="pill">{onlineCount}/{state.machines.length} online</span>
          <span className="pill">config v{state.version}</span>
          <button onClick={() => { localStorage.removeItem('snf_token'); setAuthed(false); }}>
            Sign out
          </button>
        </div>
      </header>

      <div className="layout">
        <div
          className={`nav-overlay ${navOpen ? 'show' : ''}`}
          onClick={() => setNavOpen(false)}
        />
        <aside className={`nav ${navOpen ? 'open' : ''}`}>
          <div className="nav-group">
            <h3>System</h3>
            <div className={`nav-item ${view.type === 'overview' ? 'active' : ''}`}
                 onClick={() => selectView({ type: 'overview' })}>
              <span className="label">Overview</span>
              <span className="count">{state.machines.length}</span>
            </div>
            <div className={`nav-item ${view.type === 'global' ? 'active' : ''}`}
                 onClick={() => selectView({ type: 'global' })}>
              <span className="label">Global Settings</span>
            </div>
          </div>

          {['totem', 'map', 'lym'].map((role) => {
            const machines = state.machines.filter((m) => m.role === role);
            return (
              <div className="nav-group" key={role}>
                <h3>{ROLE_LABELS[role]}</h3>
                <div className={`nav-item ${view.type === 'role' && view.id === role ? 'active' : ''}`}
                     onClick={() => selectView({ type: 'role', id: role })}>
                  <span className="label">Role defaults</span>
                  <span className="count">{machines.length}</span>
                </div>
                {machines.map((m) => (
                  <div key={m.id}
                       className={`nav-item ${view.type === 'machine' && view.id === m.id ? 'active' : ''}`}
                       onClick={() => selectView({ type: 'machine', id: m.id })}
                       style={{ paddingLeft: 40 }}>
                    <span className={`dot ${m.pending_command ? 'pending' : m.status?.online ? 'online' : 'offline'}`} />
                    <span className="label">{m.overrides?.display_label || m.label}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </aside>

        <main className="panel">
          {view.type === 'overview' && (
            <OverviewPanel state={state}
              onSelectMachine={(id) => setView({ type: 'machine', id })}
              sendBulk={sendBulk} />
          )}
          {view.type === 'global' && <GlobalPanel state={state} save={save} />}
          {view.type === 'role' && (
            <RolePanel state={state} save={save} role={view.id} sendBulk={sendBulk} />
          )}
          {view.type === 'machine' && (
            <MachinePanel
              state={state}
              save={save}
              machine={state.machines.find((m) => m.id === view.id)}
              sendCommand={sendCommand}
            />
          )}
        </main>
      </div>

      <div className={`save-state ${saveState !== 'idle' ? 'show' : ''} ${saveState}`}>
        {saveState === 'saving' && '· Saving'}
        {saveState === 'saved' && '✓ Saved'}
        {saveState === 'error' && '× Error'}
      </div>
    </div>
  );
}
