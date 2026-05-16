# SNF Config Poller
# Place in a Text DAT inside an Engine COMP, run on a 5s timer.
# Module mode: call poll_config() from a Timer CHOP callback.
#
# >>> EDIT THESE VALUES PER MACHINE <<<
MACHINE_ID = 'totem-1'                # change per machine
CONFIG_SERVER = 'https://snf-configuration-production.up.railway.app'
MACHINE_KEY = 'your-machine-key'      # must match MACHINE_KEY env var on Railway
TD_VERSION = '1.0.0'
#
# Required OPs on the same parent COMP:
#   table_DAT named 'config_state'  — stores current resolved config (key/value)
#   text_DAT named 'log'            — debug log

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


def _get(key, default=None):
    CONFIG = {
        'machine_id': MACHINE_ID,
        'config_server': CONFIG_SERVER,
        'machine_key': MACHINE_KEY,
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
