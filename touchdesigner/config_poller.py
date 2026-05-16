# SNF Config Poller
# Place in a Text DAT inside an Engine COMP, run on a 5s timer.
# Module mode: call poll_config() from a Timer CHOP callback.
#
# >>> EDIT THESE VALUES <<<
CONFIG_SERVER = 'https://snf-configuration-production.up.railway.app'
TD_VERSION = '1.0.0'

# All 13 machine endpoints
MACHINES = [
    ('totem-1',  'Totem 1'),
    ('totem-2',  'Totem 2'),
    ('totem-3',  'Totem 3'),
    ('totem-4',  'Totem 4'),
    ('map-1',    'Grantee Map 1'),
    ('map-2',    'Grantee Map 2'),
    ('map-3',    'Grantee Map 3'),
    ('map-4',    'Grantee Map 4'),
    ('map-5',    'Grantee Map 5'),
    ('map-6',    'Grantee Map 6'),
    ('lym-1',    'Leave Your Mark 1'),
    ('lym-2',    'Leave Your Mark 2'),
    ('lym-3',    'Leave Your Mark 3'),
]
#
# Required OPs on the same parent COMP:
#   table_DAT named 'config_state'     — all config as key/value strings
#   table_DAT named 'config_channels'  — numeric values only (for DAT to CHOP)
#   text_DAT named 'log'               — debug log

import json
import urllib.request
import urllib.error
import ssl
import subprocess
import sys
import os

# Bypass SSL verification — TD's bundled Python lacks system CA certs
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

# Runtime state (not persisted, resets on restart)
_last_config_version = 0


def setup_machine_menu():
    """Run once in Textport to add Machine ID and Machine Key to the base COMP.
    Usage:  op('config/config_poller').module.setup_machine_menu()
    """
    comp = parent()
    # Add or reuse a custom parameter page
    page = None
    for p in comp.customPages:
        if p.name == 'SNF':
            page = p
            break
    if page is None:
        page = comp.appendCustomPage('SNF')

    # Machine ID dropdown
    if not hasattr(comp.par, 'Machineid'):
        page.appendMenu('Machineid', label='Machine ID')
    comp.par.Machineid.menuNames = [m[0] for m in MACHINES]
    comp.par.Machineid.menuLabels = [m[1] for m in MACHINES]
    comp.par.Machineid.default = MACHINES[0][0]
    comp.par.Machineid.val = MACHINES[0][0]

    # Machine Key string field
    if not hasattr(comp.par, 'Machinekey'):
        page.appendStr('Machinekey', label='Machine Key')
    comp.par.Machinekey.default = ''
    if not comp.par.Machinekey.eval():
        comp.par.Machinekey.val = ''

    _log(f'SNF parameters created — set Machine ID and Machine Key on the SNF page')


def _get(key, default=None):
    # Read machine_id and machine_key from custom parameters on the parent COMP
    machine_id = ''
    machine_key = ''
    try:
        machine_id = parent().par.Machineid.eval()
    except:
        pass
    try:
        machine_key = parent().par.Machinekey.eval()
    except:
        pass
    CONFIG = {
        'machine_id': machine_id,
        'config_server': CONFIG_SERVER,
        'machine_key': machine_key,
        'td_version': TD_VERSION,
    }
    return CONFIG.get(key, default)


def _log(msg):
    try:
        log = parent().op('log')
        if log is not None:
            log.write(f'{msg}\n')
    except Exception:
        pass
    print(msg)


def _write_config_table(cfg):
    """Write resolved config into config_state Table DAT as key/value pairs."""
    tbl = parent().op('config_state')
    if tbl is None:
        _log('config_state Table DAT not found')
        return
    tbl.clear()
    tbl.appendRow(['key', 'value'])
    # Flatten global + role_settings into the same table
    for k, v in (cfg.get('global') or {}).items():
        tbl.appendRow([f'global.{k}', json.dumps(v) if isinstance(v, (dict, list)) else str(v)])
    for k, v in (cfg.get('role_settings') or {}).items():
        if v is None:
            continue
        tbl.appendRow([f'role.{k}', json.dumps(v) if isinstance(v, (dict, list)) else str(v)])
    tbl.appendRow(['_meta.machine_id', cfg.get('machine_id', '')])
    tbl.appendRow(['_meta.role', cfg.get('role', '')])
    tbl.appendRow(['_meta.label', cfg.get('label', '')])
    tbl.appendRow(['_meta.version', str(cfg.get('version', 0))])

    # Also write numeric values into config_channels for DAT to CHOP
    _write_channels_table(cfg)


def _hex_to_rgb(hex_str):
    """Convert '#rrggbb' to (r, g, b) floats 0–1. Returns None on bad input."""
    h = (hex_str or '').lstrip('#')
    if len(h) != 6:
        return None
    try:
        return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)
    except ValueError:
        return None


def _to_numeric(v):
    """Convert a value to float if possible. Bools become 0/1. Returns None if not numeric."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        if v.lower() == 'true':
            return 1.0
        if v.lower() == 'false':
            return 0.0
        try:
            return float(v)
        except ValueError:
            return None
    return None


def _write_channels_table(cfg):
    """Write numeric config values into config_channels Table DAT for DAT to CHOP."""
    tbl = parent().op('config_channels')
    if tbl is None:
        return
    tbl.clear()
    tbl.appendRow(['name', 'value'])

    # Fields that are hex colours — expand to r/g/b channels
    colour_fields = {'accent_colour'}

    for section, prefix in [('global', 'global'), ('role_settings', 'role')]:
        for k, v in (cfg.get(section) or {}).items():
            if k in colour_fields:
                rgb = _hex_to_rgb(v)
                if rgb:
                    base = k.replace('_colour', '').replace('_color', '')
                    tbl.appendRow([f'{prefix}/{base}_r', rgb[0]])
                    tbl.appendRow([f'{prefix}/{base}_g', rgb[1]])
                    tbl.appendRow([f'{prefix}/{base}_b', rgb[2]])
                continue
            n = _to_numeric(v)
            if n is not None:
                tbl.appendRow([f'{prefix}/{k}', n])

    tbl.appendRow(['meta/version', float(cfg.get('version', 0))])


def _ack_command(command_id, result):
    server = _get('config_server')
    machine_id = _get('machine_id')
    key = _get('machine_key')
    url = f'{server}/api/machine/{machine_id}/ack'
    body = json.dumps({'command_id': command_id, 'result': result}).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=body,
        headers={'Content-Type': 'application/json', 'X-Machine-Key': key},
        method='POST',
    )
    try:
        urllib.request.urlopen(req, timeout=5, context=_ssl_ctx).read()
    except Exception as e:
        _log(f'ack failed: {e}')


def _handle_command(cmd):
    """Run the requested command. Always ack, even on failure."""
    if not cmd:
        return
    cmd_id = cmd.get('id')
    cmd_type = cmd.get('type')
    _log(f'Executing command: {cmd_type} ({cmd_id})')

    result = 'ok'
    try:
        if cmd_type == 'reload_config':
            # Force a re-pull by zeroing the version counter
            global _last_config_version
            _last_config_version = 0

        elif cmd_type == 'restart_td':
            # Ack first so the server clears the command before we go away
            _ack_command(cmd_id, 'restarting')
            # Relaunch the .toe file. project.file is the current project path.
            toe_path = project.file
            if sys.platform == 'win32':
                subprocess.Popen(['cmd', '/c', 'start', '', toe_path], shell=False)
            else:
                subprocess.Popen(['open', toe_path])
            project.quit(force=True)
            return  # We're going down

        elif cmd_type == 'reboot_machine':
            _ack_command(cmd_id, 'rebooting')
            if sys.platform == 'win32':
                subprocess.Popen(['shutdown', '/r', '/t', '5'])
            else:
                subprocess.Popen(['sudo', 'shutdown', '-r', '+1'])
            return

        else:
            result = f'unknown command: {cmd_type}'
            _log(result)
    except Exception as e:
        result = f'error: {e}'
        _log(result)

    _ack_command(cmd_id, result)


def poll_config():
    """Main entry — call from Timer CHOP callback every ~5s."""
    server = _get('config_server')
    machine_id = _get('machine_id')
    key = _get('machine_key')
    td_version = _get('td_version', '1.0.0')

    if not server or not machine_id or not key:
        _log('Missing required Storage: config_server / machine_id / machine_key')
        return

    url = f'{server}/api/machine/{machine_id}/config?td_version={td_version}'
    req = urllib.request.Request(url, headers={'X-Machine-Key': key})

    try:
        with urllib.request.urlopen(req, timeout=5, context=_ssl_ctx) as r:
            cfg = json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        _log(f'HTTP {e.code} polling config')
        return
    except Exception as e:
        _log(f'Poll failed: {e}')
        return

    # Apply config only when version changes
    global _last_config_version
    new_version = int(cfg.get('version', 0))
    if new_version != _last_config_version:
        _write_config_table(cfg)
        _last_config_version = new_version
        _log(f'Config updated -> version {new_version}')

    # Always check for pending command
    pending = cfg.get('pending_command')
    if pending:
        _handle_command(pending)
