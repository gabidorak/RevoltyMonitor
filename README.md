# RevoltyMonitor

> Battery analytics platform for Victron Multiplus II GX + JK BMS.  
> Aggregate cell-level data, track imbalance, SOC/SOH trends and temperature stats across all your inverters.

## Architecture

```
┌─────────────────────────┐   HTTPS POST (every 30s)   ┌──────────────────────────┐
│  Multiplus II GX #1     │ ─────────────────────────── │  Vercel Backend          │
│  revolty_monitor.py     │         API Key auth        │  (Next.js API routes)    │
├─────────────────────────┤                             │                          │
│  Multiplus II GX #2     │ ───────────────────────────▶│  PostgreSQL (Neon.tech)  │
│  revolty_monitor.py     │                             │                          │
├─────────────────────────┤                             │  Admin panel             │
│  Multiplus II GX #N ... │ ───────────────────────────▶│  - Dashboard             │
└─────────────────────────┘                             │  - Charts & stats        │
                                                         │  - Device/key management │
                                                         └──────────────────────────┘
```

## Project structure

```
RevoltyMonitor/
├── backend/                  # Next.js app (API + admin panel)
│   ├── app/
│   │   ├── (admin)/          # Protected admin pages
│   │   │   ├── dashboard/    # Device overview + detail charts
│   │   │   └── devices/      # API key management
│   │   ├── api/v1/           # REST API
│   │   │   ├── auth/         # Login/logout/me
│   │   │   ├── ingest/       # Data ingestion (device auth)
│   │   │   ├── devices/      # CRUD devices
│   │   │   ├── data/         # Time series data
│   │   │   └── stats/        # Aggregated stats
│   │   └── login/
│   ├── lib/                  # Auth, DB, utils
│   ├── prisma/               # Schema + seed
│   └── vercel.json
└── gx-script/                # Python script for GX devices
    ├── revolty_monitor.py    # Main script
    ├── config.example.json   # Config template
    └── install.sh            # Install/update script
```

## Quick Start

### 1. Deploy the backend to Vercel

#### Prerequisites
- A [Vercel](https://vercel.com) account
- A [Neon.tech](https://neon.tech) free PostgreSQL database

#### Setup

```bash
cd backend

# Copy and fill env vars
cp .env.example .env
# Edit .env with your DATABASE_URL and JWT_SECRET

# Install dependencies
npm install

# Push the database schema
npx prisma db push

# Create admin user
ADMIN_PASSWORD=yourpassword npx tsx prisma/seed.ts

# Deploy to Vercel
npx vercel --prod
```

Set environment variables in the Vercel dashboard:
- `DATABASE_URL` — Neon pooled connection string
- `JWT_SECRET` — Random 32+ char string

### 2. Install the script on each Multiplus II GX

```bash
# SSH into the GX device
ssh root@<gx-ip>

# One-line install
curl -sSL https://raw.githubusercontent.com/gabidorak/RevoltyMonitor/main/gx-script/install.sh | bash
```

Then configure:

```bash
vi /data/revoltymonitor/config.json
```

Minimum required:
```json
{
  "api_url": "https://your-app.vercel.app/api/v1/ingest",
  "api_key": "rvm_..."
}
```

Start:
```bash
cd /data/revoltymonitor && nohup python3 -u revolty_monitor.py > log.txt 2>&1 &
```

### 3. Generate API keys in the admin panel

1. Open `https://your-app.vercel.app`
2. Login with your admin credentials
3. Go to **Devices & Keys** → **New Device**
4. Copy the generated key into `config.json` on the GX device

---

## Data collected per snapshot

| Category | Data |
|---|---|
| **Pack** | Voltage, current, power, temperature |
| **SOC** | BMS SOC + smart estimator SOC (coulomb counting + OCV) |
| **SOH** | BMS SOH + estimator SOH (self-calibrating from OCV anchors) |
| **Cell voltages** | Min/max cell V + cell IDs (from CAN bus JK BMS) |
| **Cell delta** | max − min (mV) — key imbalance indicator |
| **Temperatures** | Min/max cell temp + probe IDs |
| **System** | Modules online/offline, cumulative energy (kWh) |
| **Estimator** | SOC-BMS drift, OCV anchor, rest timer |
| **Alarms** | Cell imbalance, over/under-temp, over-voltage, charge/discharge blocked |

## Charts & analytics

- 📈 **SOC** — estimator vs BMS (drift tracking over time)
- ⚡ **Cell Δ voltage** (mV) — imbalance over time + 50mV alert line
- 🔋 **Min/Max cell voltage** — individual cell health tracking
- 🌡️ **Temperatures** — min/max over time
- ⚡ **Power profile** — charge/discharge patterns
- 🔴 **Most imbalanced cells** — ranked by frequency in min/max position (30 days)
- 📊 **Metrics by SOC zone** — average cell delta per 10% SOC band

## Configuration reference

All settings in `config.json` on the GX device:

| Key | Default | Description |
|---|---|---|
| `api_url` | — | Backend ingest URL |
| `api_key` | — | Device API key (from admin panel) |
| `send_interval_s` | `30` | How often to POST data (seconds) |
| `bms_service` | `com.victronenergy.battery.socketcan_can0` | D-Bus service name |
| `rest_power_w` | `250` | Power threshold for "at rest" detection |
| `rest_duration_s` | `300` | Seconds at rest before OCV recalibration |
| `ocv_curve` | 16S LiFePO4 | OCV→SOC lookup table |
| `ocv_dead_zone_v` | `[51.1, 53.9]` | Flat plateau voltage range |
| `soh_ema_alpha` | `0.25` | SOH smoothing factor |

## API Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/ingest` | API Key | Submit battery snapshot |
| `POST` | `/api/v1/auth/login` | — | Admin login |
| `GET` | `/api/v1/devices` | Session | List devices |
| `POST` | `/api/v1/devices` | Session | Create device + key |
| `PATCH` | `/api/v1/devices/:id` | Session | Update / regen key |
| `DELETE` | `/api/v1/devices/:id` | Session | Delete device |
| `GET` | `/api/v1/data/:deviceId` | Session | Time series data |
| `GET` | `/api/v1/stats/:deviceId` | Session | Aggregated stats |

---

## License

MIT
