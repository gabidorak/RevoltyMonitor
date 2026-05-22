#!/usr/bin/env python3
"""
RevoltyMonitor — Advanced battery monitor for Victron GX devices (Multiplus II GX).

This script:
  1. Maintains a smart SOC/SOH estimation (coulomb counting + OCV recalibration).
  2. Reads rich cell-level data from the JK BMS via D-Bus.
  3. Periodically POSTs all metrics to the RevoltyMonitor backend API.
  4. Buffers data locally when network is unavailable and flushes on reconnect.
  5. Registers a virtual battery service on D-Bus for Venus OS integration.

Configuration: /data/revoltymonitor/config.json
Logs: /data/revoltymonitor/log.txt
State: /data/revoltymonitor/soc_state.json
Buffer: /data/revoltymonitor/offline_buffer.jsonl
"""

import sys
import os
import time
import json
import dbus
import fcntl
import errno
import threading
import signal
import atexit
from datetime import datetime, timezone
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

# Try to import requests (available on Venus OS >= 3.x, or install via opkg/pip)
try:
    import urllib.request
    import urllib.error
    HAS_REQUESTS = False  # Use urllib (no external deps)
except ImportError:
    HAS_REQUESTS = False

sys.path.insert(1, '/opt/victronenergy/dbus-systemcalc-py/ext/velib_python')
from vedbus import VeDbusService, VeDbusItemImport

# ─── DEFAULTS ────────────────────────────────────────────────────────────────
CONFIG_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)))
CONFIG_FILE = os.path.join(CONFIG_DIR, 'config.json')
STATE_FILE  = os.path.join(CONFIG_DIR, 'soc_state.json')
BUFFER_FILE = os.path.join(CONFIG_DIR, 'offline_buffer.jsonl')
LOCK_FILE   = os.path.join(CONFIG_DIR, 'revolty_monitor.lock')

DEFAULT_CONFIG = {
    # Backend
    "api_url":   "https://YOUR-APP.vercel.app/api/v1/ingest",
    "api_key":   "rvm_YOUR_KEY_HERE",
    "send_interval_s": 30,     # POST interval in seconds
    "buffer_max_lines": 2000,  # Max lines to buffer offline

    # D-Bus services
    "bms_service":       "com.victronenergy.battery.socketcan_can0",

    # Smart SOC estimator (same algo as before)
    "rest_power_w":      250,
    "rest_duration_s":   300,
    "charge_efficiency": 1.00,
    "initial_soh":       1.00,
    "soh_min":           0.50,
    "soh_max":           1.30,
    "soh_min_delta_soc": 25.0,
    "soh_ema_alpha":     0.25,
    "ocv_min_delta_pct": 0.1,
    "ocv_max_jump_pct":  100.0,
    "save_interval_s":   60,
    "update_period_ms":  1000,

    # OCV curve for 16S LiFePO4 (V, SOC%)
    "ocv_curve": [
        [44.80,   0.0], [46.40,   2.0], [48.00,   5.0], [49.60,   8.0],
        [50.40,  10.0], [51.20,  13.0], [51.52,  15.0], [51.84,  20.0],
        [52.00,  25.0], [52.08,  30.0], [52.16,  40.0], [52.24,  50.0],
        [52.32,  60.0], [52.48,  70.0], [52.64,  75.0], [52.80,  80.0],
        [53.12,  85.0], [53.44,  88.0], [53.76,  90.0], [54.24,  93.0],
        [54.56,  95.0], [54.88,  98.0], [55.20, 100.0],
    ],
    "ocv_dead_zone_v": [51.1, 53.9],
}

# ─── CONFIG LOADER ────────────────────────────────────────────────────────────

def load_config():
    cfg = dict(DEFAULT_CONFIG)
    try:
        with open(CONFIG_FILE) as f:
            user = json.load(f)
        cfg.update(user)
        print(f"[CONFIG] Loaded from {CONFIG_FILE}")
    except FileNotFoundError:
        print(f"[CONFIG] No config file found at {CONFIG_FILE}, using defaults.")
        print(f"[CONFIG] Create {CONFIG_FILE} with at least 'api_url' and 'api_key'.")
    except Exception as e:
        print(f"[CONFIG] Error reading config: {e}, using defaults.")
    return cfg


# ─── LOCK ─────────────────────────────────────────────────────────────────────

def acquire_lock():
    fp = open(LOCK_FILE, 'w')
    try:
        fcntl.flock(fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as e:
        if e.errno in (errno.EACCES, errno.EAGAIN):
            print("[LOCK] Another instance is already running. Exiting.")
            sys.exit(0)
        raise
    fp.write(str(os.getpid()))
    fp.flush()
    return fp


# ─── OCV / SOC helpers ────────────────────────────────────────────────────────

def ocv_to_soc(voltage, ocv_curve):
    if voltage <= ocv_curve[0][0]:
        return ocv_curve[0][1]
    if voltage >= ocv_curve[-1][0]:
        return ocv_curve[-1][1]
    for i in range(len(ocv_curve) - 1):
        v0, s0 = ocv_curve[i]
        v1, s1 = ocv_curve[i + 1]
        if v0 <= voltage <= v1:
            return s0 + (s1 - s0) * (voltage - v0) / (v1 - v0)
    return ocv_curve[-1][1]


def in_dead_zone(voltage, dead_zone):
    return dead_zone[0] <= voltage <= dead_zone[1]


# ─── STATE PERSISTENCE ────────────────────────────────────────────────────────

def load_state(cfg):
    result = {
        'soc': None, 'soc_age': None,
        'soh': cfg['initial_soh'],
        'anchor_soc': None, 'anchor_ah': 0.0,
    }
    try:
        with open(STATE_FILE) as f:
            data = json.load(f)
        soc = float(data['soc'])
        ts  = float(data.get('timestamp', 0))
        age = max(0.0, time.time() - ts) if ts > 0 else None
        if 0.0 <= soc <= 100.0:
            result['soc'] = soc
            result['soc_age'] = age
            print(f"[STATE] Restored SOC: {soc:.2f}%"
                  + (f" ({age/60:.1f} min ago)" if age is not None else ""))
        if 'soh' in data:
            soh = float(data['soh'])
            if cfg['soh_min'] <= soh <= cfg['soh_max']:
                result['soh'] = soh
                print(f"[STATE] Restored SOH: {soh*100:.1f}%")
        if data.get('anchor_soc') is not None:
            result['anchor_soc'] = float(data['anchor_soc'])
            result['anchor_ah']  = float(data.get('anchor_ah', 0.0))
    except FileNotFoundError:
        print("[STATE] No saved state, will init from BMS.")
    except Exception as e:
        print(f"[STATE] Could not read state: {e}")
    return result


def save_state(soc, soh, anchor_soc, anchor_ah):
    try:
        tmp = STATE_FILE + '.tmp'
        with open(tmp, 'w') as f:
            json.dump({
                'soc': soc, 'soh': soh,
                'anchor_soc': anchor_soc, 'anchor_ah': anchor_ah,
                'timestamp': time.time(),
            }, f)
        os.replace(tmp, STATE_FILE)
    except Exception as e:
        print(f"[STATE] Error saving: {e}")


# ─── OFFLINE BUFFER ────────────────────────────────────────────────────────────

_buffer_lock = threading.Lock()

def buffer_push(payload: dict, max_lines: int):
    """Append payload to the offline buffer JSONL file."""
    with _buffer_lock:
        try:
            with open(BUFFER_FILE, 'a') as f:
                f.write(json.dumps(payload) + '\n')
            # Trim buffer if too large
            _trim_buffer(max_lines)
        except Exception as e:
            print(f"[BUFFER] Write error: {e}")


def _trim_buffer(max_lines: int):
    try:
        with open(BUFFER_FILE, 'r') as f:
            lines = f.readlines()
        if len(lines) > max_lines:
            with open(BUFFER_FILE, 'w') as f:
                f.writelines(lines[-max_lines:])
    except Exception:
        pass


def buffer_pop_all() -> list:
    """Read and clear the buffer. Returns list of dicts."""
    with _buffer_lock:
        try:
            with open(BUFFER_FILE, 'r') as f:
                lines = f.readlines()
            os.remove(BUFFER_FILE)
            result = []
            for line in lines:
                line = line.strip()
                if line:
                    try:
                        result.append(json.loads(line))
                    except Exception:
                        pass
            return result
        except FileNotFoundError:
            return []
        except Exception as e:
            print(f"[BUFFER] Read error: {e}")
            return []


# ─── HTTP CLIENT ──────────────────────────────────────────────────────────────

def http_post(url: str, api_key: str, payload: dict, timeout: int = 10) -> bool:
    """POST JSON payload to the backend. Returns True on success."""
    try:
        body = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}',
                'User-Agent': 'RevoltyMonitor/1.0',
            },
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if 200 <= resp.status < 300:
                return True
            print(f"[HTTP] Server returned {resp.status}")
            return False
    except urllib.error.HTTPError as e:
        print(f"[HTTP] HTTP error {e.code}: {e.reason}")
        return False
    except Exception as e:
        print(f"[HTTP] Post failed: {e}")
        return False


# ─── SEND WORKER ──────────────────────────────────────────────────────────────

def make_send_worker(cfg: dict, state: dict):
    """
    Returns a function that is called every send_interval_s seconds in a
    separate daemon thread. It flushes the buffer and sends live data.
    """
    def worker():
        while True:
            time.sleep(cfg['send_interval_s'])
            try:
                _send_cycle(cfg, state)
            except Exception as e:
                print(f"[SEND] Unhandled error: {e}")

    def _send_cycle(cfg, state):
        api_url = cfg['api_url']
        api_key = cfg['api_key']

        if 'YOUR_KEY' in api_key or 'YOUR-APP' in api_url:
            print("[SEND] API key/URL not configured. Skipping send.")
            return

        # First, try to flush the offline buffer
        buffered = buffer_pop_all()
        if buffered:
            print(f"[SEND] Flushing {len(buffered)} buffered snapshots...")
            success_count = 0
            failed = []
            for payload in buffered:
                if http_post(api_url, api_key, payload, timeout=8):
                    success_count += 1
                else:
                    failed.append(payload)
                    time.sleep(0.5)
            print(f"[SEND] Flushed {success_count}/{len(buffered)} buffered snapshots.")
            # Re-buffer failed ones
            for p in failed:
                buffer_push(p, cfg['buffer_max_lines'])

        # Now send the current live snapshot
        live = state.get('last_payload')
        if live:
            ok = http_post(api_url, api_key, live, timeout=10)
            if not ok:
                print("[SEND] Live send failed, buffering.")
                buffer_push(live, cfg['buffer_max_lines'])

    return worker


# ─── SAFE GETTERS ────────────────────────────────────────────────────────────

def safe_float(value, default=0.0):
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def safe_str(value, default=None):
    try:
        return str(value) if value is not None else default
    except Exception:
        return default


def safe_bool(value, default=False):
    try:
        v = int(value) if value is not None else 0
        return bool(v)
    except Exception:
        return default


# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)

    cfg = load_config()
    _lock = acquire_lock()

    DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()

    JK = cfg['bms_service']

    # ── D-Bus imports from JK BMS ─────────────────────────────────────────
    imp = {
        'voltage':    VeDbusItemImport(bus, JK, '/Dc/0/Voltage'),
        'current':    VeDbusItemImport(bus, JK, '/Dc/0/Current'),
        'power':      VeDbusItemImport(bus, JK, '/Dc/0/Power'),
        'temperature':VeDbusItemImport(bus, JK, '/Dc/0/Temperature'),
        'soc_bms':    VeDbusItemImport(bus, JK, '/Soc'),
        'soh_bms':    VeDbusItemImport(bus, JK, '/Soh'),
        'capacity':   VeDbusItemImport(bus, JK, '/InstalledCapacity'),
        'cap_rem':    VeDbusItemImport(bus, JK, '/Capacity'),
        # Cell-level data (CAN bus aggregates)
        'max_cell_v':       VeDbusItemImport(bus, JK, '/System/MaxCellVoltage'),
        'min_cell_v':       VeDbusItemImport(bus, JK, '/System/MinCellVoltage'),
        'max_cell_v_id':    VeDbusItemImport(bus, JK, '/System/MaxVoltageCellId'),
        'min_cell_v_id':    VeDbusItemImport(bus, JK, '/System/MinVoltageCellId'),
        'max_cell_temp':    VeDbusItemImport(bus, JK, '/System/MaxCellTemperature'),
        'min_cell_temp':    VeDbusItemImport(bus, JK, '/System/MinCellTemperature'),
        'max_temp_id':      VeDbusItemImport(bus, JK, '/System/MaxTemperatureCellId'),
        'min_temp_id':      VeDbusItemImport(bus, JK, '/System/MinTemperatureCellId'),
        'modules_online':   VeDbusItemImport(bus, JK, '/System/NrOfModulesOnline'),
        'modules_offline':  VeDbusItemImport(bus, JK, '/System/NrOfModulesOffline'),
        'charged_energy':   VeDbusItemImport(bus, JK, '/History/ChargedEnergy'),
        'discharged_energy':VeDbusItemImport(bus, JK, '/History/DischargedEnergy'),
        'serial':           VeDbusItemImport(bus, JK, '/Serial'),
        # Alarms
        'alarm_cell_imbalance':   VeDbusItemImport(bus, JK, '/Alarms/CellImbalance'),
        'alarm_high_temp':        VeDbusItemImport(bus, JK, '/Alarms/HighTemperature'),
        'alarm_low_temp':         VeDbusItemImport(bus, JK, '/Alarms/LowTemperature'),
        'alarm_high_cell_v':      VeDbusItemImport(bus, JK, '/Alarms/HighCellVoltage'),
        'alarm_low_v':            VeDbusItemImport(bus, JK, '/Alarms/LowVoltage'),
        'alarm_charge_blocked':   VeDbusItemImport(bus, JK, '/Alarms/ChargeBlocked'),
        'alarm_discharge_blocked':VeDbusItemImport(bus, JK, '/Alarms/DischargeBlocked'),
        'alarm_internal':         VeDbusItemImport(bus, JK, '/Alarms/InternalFailure'),
    }

    # ── Virtual battery service (Venus OS integration) ────────────────────
    svc = VeDbusService('com.victronenergy.battery.virtual_revolty', bus=bus, register=False)
    svc.add_path('/Mgmt/ProcessName',    __file__)
    svc.add_path('/Mgmt/ProcessVersion', '1.0')
    svc.add_path('/Mgmt/Connection',     'Virtual (RevoltyMonitor)')
    svc.add_path('/DeviceInstance',      98)
    svc.add_path('/ProductId',           0)
    svc.add_path('/ProductName',         'RevoltyMonitorGX')
    svc.add_path('/FirmwareVersion',     1)
    svc.add_path('/HardwareVersion',     1)
    svc.add_path('/Connected',           1)
    svc.add_path('/Soc',                 50.0)
    svc.add_path('/Soh',                 100.0)
    svc.add_path('/Dc/0/Voltage',        0.0)
    svc.add_path('/Dc/0/Current',        0.0)
    svc.add_path('/Dc/0/Power',          0.0)
    svc.add_path('/Dc/0/Temperature',    None)
    svc.add_path('/Capacity',            None)
    svc.add_path('/InstalledCapacity',   None)
    svc.add_path('/ConsumedAmphours',    None)
    svc.add_path('/Alarms/LowVoltage',   0)
    svc.add_path('/Alarms/HighVoltage',  0)
    svc.add_path('/Alarms/LowSoc',       0)
    svc.add_path('/Info/RestTimer',      0)
    svc.add_path('/Info/InDeadZone',     0)
    svc.add_path('/Info/SocBmsDelta',    0.0)
    svc.add_path('/Info/LastCorrection', 'none')
    svc.add_path('/Info/AnchorSoc',      None)
    svc.add_path('/Info/AnchorAh',       0.0)
    svc.add_path('/Info/LastSohSample',  None)

    # Register (with retry)
    for attempt in range(1, 11):
        try:
            svc.register()
            print(f"[DBUS] Virtual battery service registered.")
            break
        except dbus.exceptions.NameExistsException:
            if attempt == 10:
                raise
            print(f"[DBUS] Name busy (attempt {attempt}/10), retrying...")
            time.sleep(1.5)

    # ── SOC/SOH state ─────────────────────────────────────────────────────
    persisted = load_state(cfg)
    if persisted['soc'] is None:
        soc = safe_float(imp['soc_bms'].get_value(), 50.0)
        print(f"[SOC] Initialized from BMS: {soc:.2f}%")
    else:
        soc = persisted['soc']

    ocv_curve = [tuple(p) for p in cfg['ocv_curve']]
    dead_zone = cfg['ocv_dead_zone_v']

    state = {
        'soc':            soc,
        'soh':            persisted['soh'],
        'anchor_soc':     persisted['anchor_soc'],
        'anchor_ah':      persisted['anchor_ah'],
        'rest_timer':     0.0,
        'last_update':    time.monotonic(),
        'last_save':      time.monotonic(),
        'last_save_soc':  soc,
        'last_payload':   None,
        'last_send_ts':   0.0,
    }

    # ── Start send worker thread ───────────────────────────────────────────
    worker_fn = make_send_worker(cfg, state)
    send_thread = threading.Thread(target=worker_fn, daemon=True, name="send-worker")
    send_thread.start()
    print(f"[NET] Send worker started (interval: {cfg['send_interval_s']}s)")

    def persist_now():
        save_state(state['soc'], state['soh'], state['anchor_soc'], state['anchor_ah'])

    # ── Main update loop (runs every UPDATE_PERIOD_MS) ────────────────────
    def update():
        now = time.monotonic()
        dt  = now - state['last_update']
        state['last_update'] = now
        if dt < 0 or dt > 10.0:
            dt = cfg['update_period_ms'] / 1000.0

        # ── Read all BMS data ─────────────────────────────────────────────
        voltage   = safe_float(imp['voltage'].get_value())
        current   = safe_float(imp['current'].get_value())
        power_raw = imp['power'].get_value()
        power     = safe_float(power_raw) if power_raw is not None else voltage * current
        temp      = imp['temperature'].get_value()
        soc_bms   = safe_float(imp['soc_bms'].get_value(), state['soc'])
        soh_bms   = safe_float(imp['soh_bms'].get_value(), 100.0)
        capacity  = safe_float(imp['capacity'].get_value())

        min_cell_v   = imp['min_cell_v'].get_value()
        max_cell_v   = imp['max_cell_v'].get_value()
        min_cell_v_id = safe_str(imp['min_cell_v_id'].get_value())
        max_cell_v_id = safe_str(imp['max_cell_v_id'].get_value())
        min_cell_temp = imp['min_cell_temp'].get_value()
        max_cell_temp = imp['max_cell_temp'].get_value()
        min_temp_id   = safe_str(imp['min_temp_id'].get_value())
        max_temp_id   = safe_str(imp['max_temp_id'].get_value())
        modules_online  = imp['modules_online'].get_value()
        modules_offline = imp['modules_offline'].get_value()
        charged_energy   = imp['charged_energy'].get_value()
        discharged_energy = imp['discharged_energy'].get_value()
        serial = safe_str(imp['serial'].get_value())

        # Cell delta
        min_v_f = safe_float(min_cell_v) if min_cell_v is not None else None
        max_v_f = safe_float(max_cell_v) if max_cell_v is not None else None

        eff_capacity = capacity * state['soh'] if capacity > 0 else 0.0

        # ── Coulomb counting ──────────────────────────────────────────────
        if capacity > 0:
            eff = cfg['charge_efficiency'] if current > 0 else 1.0
            delta_ah_raw = current * eff * dt / 3600.0
            delta_soc = delta_ah_raw / eff_capacity * 100.0
            state['soc'] = max(0.0, min(100.0, state['soc'] + delta_soc))
            if state['anchor_soc'] is not None:
                state['anchor_ah'] += delta_ah_raw
        else:
            delta_ah_raw = 0.0

        # ── Rest detection ────────────────────────────────────────────────
        if abs(power) < cfg['rest_power_w']:
            state['rest_timer'] += dt
        else:
            state['rest_timer'] = 0.0

        dead = in_dead_zone(voltage, dead_zone)

        # ── OCV recalibration ─────────────────────────────────────────────
        last_correction = svc['/Info/LastCorrection'] or 'none'
        last_soh_sample = svc['/Info/LastSohSample']

        if state['rest_timer'] >= cfg['rest_duration_s'] and not dead and voltage > 0:
            ocv_soc = ocv_to_soc(voltage, ocv_curve)
            delta = ocv_soc - state['soc']

            if abs(delta) > cfg['ocv_min_delta_pct']:
                if abs(delta) > cfg['ocv_max_jump_pct']:
                    last_correction = f"REJECTED OCV@{voltage:.2f}V => {ocv_soc:.1f}%"
                    print(f"[OCV] Jump rejected: {delta:+.2f}%")
                else:
                    old_soc = state['soc']
                    state['soc'] = ocv_soc
                    last_correction = f"OCV@{voltage:.2f}V => {ocv_soc:.1f}%"
                    print(f"[OCV] Recal: {old_soc:.2f}% -> {ocv_soc:.2f}% (Δ={delta:+.2f}%)")

            # SOH update
            if capacity > 0 and state['anchor_soc'] is not None:
                delta_soc_real = ocv_soc - state['anchor_soc']
                if abs(delta_soc_real) >= cfg['soh_min_delta_soc']:
                    measured_cap = state['anchor_ah'] / (delta_soc_real / 100.0)
                    if measured_cap > 0:
                        new_soh = measured_cap / capacity
                        last_soh_sample = round(new_soh * 100.0, 1)
                        if cfg['soh_min'] <= new_soh <= cfg['soh_max']:
                            alpha = cfg['soh_ema_alpha']
                            state['soh'] = (1.0 - alpha) * state['soh'] + alpha * new_soh
                            print(f"[SOH] Updated: raw={new_soh*100:.1f}% EMA={state['soh']*100:.2f}%")

            state['anchor_soc'] = ocv_soc
            state['anchor_ah']  = 0.0
            persist_now()
            state['last_save']     = now
            state['last_save_soc'] = state['soc']
            state['rest_timer']    = 0.0

        # Periodic save
        if (now - state['last_save']) >= cfg['save_interval_s'] and \
           abs(state['soc'] - state['last_save_soc']) > 0.05:
            persist_now()
            state['last_save']     = now
            state['last_save_soc'] = state['soc']

        # ── Publish to D-Bus ──────────────────────────────────────────────
        soc_out = round(state['soc'], 1)
        svc['/Soc']               = soc_out
        svc['/Soh']               = round(state['soh'] * 100.0, 1)
        svc['/Dc/0/Voltage']      = round(voltage, 2)
        svc['/Dc/0/Current']      = round(current, 2)
        svc['/Dc/0/Power']        = round(power, 1)
        svc['/Dc/0/Temperature']  = safe_float(temp) if temp is not None else None
        svc['/InstalledCapacity'] = capacity if capacity > 0 else None
        svc['/Capacity']          = (round(eff_capacity * state['soc'] / 100.0, 2)
                                      if eff_capacity > 0 else None)
        svc['/ConsumedAmphours']  = (round(-eff_capacity * (100.0 - state['soc']) / 100.0, 2)
                                      if eff_capacity > 0 else None)
        svc['/Info/RestTimer']    = int(state['rest_timer'])
        svc['/Info/InDeadZone']   = 1 if dead else 0
        svc['/Info/SocBmsDelta']  = round(state['soc'] - soc_bms, 2)
        svc['/Info/LastCorrection'] = last_correction
        svc['/Info/AnchorSoc']    = (round(state['anchor_soc'], 2)
                                      if state['anchor_soc'] is not None else None)
        svc['/Info/AnchorAh']     = round(state['anchor_ah'], 3)
        if last_soh_sample is not None:
            svc['/Info/LastSohSample'] = last_soh_sample

        # ── Build API payload ─────────────────────────────────────────────
        ts_iso = datetime.now(timezone.utc).isoformat()

        payload = {
            "timestamp":     ts_iso,
            "serial":        serial,
            # Pack
            "voltage":       round(voltage, 3),
            "current":       round(current, 3),
            "power":         round(power, 1),
            "temperature":   round(safe_float(temp), 1) if temp is not None else None,
            # SOC
            "socBms":        round(soc_bms, 2),
            "socEstimated":  round(state['soc'], 2),
            # SOH
            "sohBms":        round(soh_bms, 2),
            "sohEstimated":  round(state['soh'] * 100.0, 2),
            # Capacity
            "installedCapacity": capacity if capacity > 0 else None,
            "capacity":       round(eff_capacity * state['soc'] / 100.0, 2) if eff_capacity > 0 else None,
            "consumedAmphours": round(-eff_capacity * (100.0 - state['soc']) / 100.0, 2) if eff_capacity > 0 else None,
            # Cell voltages
            "minCellVoltage":   round(min_v_f, 4) if min_v_f is not None else None,
            "maxCellVoltage":   round(max_v_f, 4) if max_v_f is not None else None,
            "minCellVoltageId": min_cell_v_id,
            "maxCellVoltageId": max_cell_v_id,
            # Temperatures
            "minCellTemperature": round(safe_float(min_cell_temp), 1) if min_cell_temp is not None else None,
            "maxCellTemperature": round(safe_float(max_cell_temp), 1) if max_cell_temp is not None else None,
            "minTempCellId":  min_temp_id,
            "maxTempCellId":  max_temp_id,
            # System
            "modulesOnline":  int(safe_float(modules_online)) if modules_online is not None else None,
            "modulesOffline": int(safe_float(modules_offline)) if modules_offline is not None else None,
            "chargedEnergy":  round(safe_float(charged_energy), 2) if charged_energy is not None else None,
            "dischargedEnergy": round(safe_float(discharged_energy), 2) if discharged_energy is not None else None,
            # Estimator extras
            "socBmsDelta":   round(state['soc'] - soc_bms, 2),
            "inDeadZone":    dead,
            "restTimer":     int(state['rest_timer']),
            "anchorSoc":     round(state['anchor_soc'], 2) if state['anchor_soc'] is not None else None,
            "anchorAh":      round(state['anchor_ah'], 3),
            "lastSohSample": last_soh_sample,
            # Alarms
            "alarmCellImbalance":   safe_bool(imp['alarm_cell_imbalance'].get_value()),
            "alarmHighTemperature": safe_bool(imp['alarm_high_temp'].get_value()),
            "alarmLowTemperature":  safe_bool(imp['alarm_low_temp'].get_value()),
            "alarmHighCellVoltage": safe_bool(imp['alarm_high_cell_v'].get_value()),
            "alarmLowVoltage":      safe_bool(imp['alarm_low_v'].get_value()),
            "alarmChargeBlocked":   safe_bool(imp['alarm_charge_blocked'].get_value()),
            "alarmDischargeBlocked":safe_bool(imp['alarm_discharge_blocked'].get_value()),
            "alarmInternalFailure": safe_bool(imp['alarm_internal'].get_value()),
        }
        state['last_payload'] = payload

        return True  # keep GLib timer running

    # ── Shutdown handler ──────────────────────────────────────────────────
    def on_shutdown():
        try:
            persist_now()
            print(f"[EXIT] Saved state: SOC={state['soc']:.2f}% SOH={state['soh']*100:.2f}%")
        except Exception as e:
            print(f"[EXIT] Save failed: {e}")

    atexit.register(on_shutdown)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: sys.exit(0))

    GLib.timeout_add(cfg['update_period_ms'], update)
    print("[MAIN] Starting main loop...")
    GLib.MainLoop().run()


if __name__ == '__main__':
    main()
