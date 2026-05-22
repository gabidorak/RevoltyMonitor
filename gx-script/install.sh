#!/bin/bash
# ============================================================
# RevoltyMonitor — Install / Update script for Victron GX
# Run as root on the GX device:
#   bash install.sh
# ============================================================

set -e

INSTALL_DIR="/data/revoltymonitor"
GITHUB_RAW="https://raw.githubusercontent.com/gabidorak/RevoltyMonitorBackend/main/gx-script"
SCRIPT_NAME="revolty_monitor.py"
SERVICE_NAME="revolty_monitor"

echo ""
echo "=== RevoltyMonitor Installer ==="
echo ""

# ── Step 1: Create install dir ───────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
echo "[1/5] Install directory: $INSTALL_DIR"

# ── Step 2: Download script ───────────────────────────────────────────────────
echo "[2/5] Downloading $SCRIPT_NAME..."
if curl -sSL "$GITHUB_RAW/$SCRIPT_NAME" -o "$INSTALL_DIR/$SCRIPT_NAME"; then
    chmod +x "$INSTALL_DIR/$SCRIPT_NAME"
    echo "      ✓ Downloaded $SCRIPT_NAME"
else
    echo "      ✗ Download failed! Check your internet connection."
    exit 1
fi

# Download example config if no config exists yet
if [ ! -f "$INSTALL_DIR/config.json" ]; then
    echo "[2/5] Downloading example config..."
    if curl -sSL "$GITHUB_RAW/config.example.json" -o "$INSTALL_DIR/config.json"; then
        echo "      ✓ Downloaded config.json (you MUST edit it with your API key/URL!)"
    fi
fi

# ── Step 3: Create rc.local entry for auto-start ─────────────────────────────
echo "[3/5] Configuring auto-start in /data/rc.local..."
RC_LOCAL="/data/rc.local"
RC_LINE="cd $INSTALL_DIR && nohup python3 -u $SCRIPT_NAME > $INSTALL_DIR/log.txt 2>&1 &"
RC_MARKER="# RevoltyMonitor"

if [ -f "$RC_LOCAL" ] && grep -q "revoltymonitor" "$RC_LOCAL"; then
    echo "      ✓ rc.local entry already exists."
else
    cat >> "$RC_LOCAL" << EOF

$RC_MARKER
$RC_LINE
EOF
    chmod +x "$RC_LOCAL"
    echo "      ✓ Added to rc.local"
fi

# ── Step 4: Stop old instance if running ─────────────────────────────────────
echo "[4/5] Stopping any running instance..."
pkill -f "$SCRIPT_NAME" 2>/dev/null && echo "      ✓ Stopped old instance." || echo "      ✓ No running instance found."
sleep 1

# ── Step 5: Check config and optionally start ────────────────────────────────
echo "[5/5] Checking configuration..."
CONFIG_FILE="$INSTALL_DIR/config.json"

if grep -q "YOUR_KEY_HERE\|YOUR-APP" "$CONFIG_FILE" 2>/dev/null; then
    echo ""
    echo "  ⚠️  CONFIG NOT SET — Edit your config before starting:"
    echo ""
    echo "     vi $CONFIG_FILE"
    echo ""
    echo "  Required fields:"
    echo "     api_url  — Your Vercel backend URL"
    echo "     api_key  — Your device API key (generated in the admin panel)"
    echo ""
    echo "  Then start manually with:"
    echo "     cd $INSTALL_DIR && nohup python3 -u $SCRIPT_NAME > log.txt 2>&1 &"
else
    echo "      Config looks good. Starting..."
    cd "$INSTALL_DIR"
    nohup python3 -u "$SCRIPT_NAME" > "$INSTALL_DIR/log.txt" 2>&1 &
    echo "      ✓ Started (PID: $!)"
    echo ""
    echo "  View logs:  tail -f $INSTALL_DIR/log.txt"
fi

echo ""
echo "=== Installation complete! ==="
echo ""
