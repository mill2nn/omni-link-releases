#!/bin/bash
#
# Omni Link — one-line installer for macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/mill2nn/omni-link-releases/main/install.sh | bash
#
# Downloads the panel straight into Premiere's extensions folder. No zip, no
# unzip, and nothing for macOS to quarantine — which is the whole point: a
# downloaded .command file gets blocked by Gatekeeper, a file written by a script
# you already chose to run does not.
#
# mill2nn/omni-link-releases is public and holds only built panel files.

set -e

OWNER="mill2nn"
REPO="omni-link-releases"
BRANCH="main"
BUNDLE="com.bom.autoimport2"
RAW="https://raw.githubusercontent.com/$OWNER/$REPO/$BRANCH"

# Exactly the files the panel needs to run. Kept in step with the publish script.
FILES=(
    "client/index.html"
    "client/main.js"
    "client/style.css"
    "client/CSInterface.js"
    "jsx/host.jsx"
    "CSXS/manifest.xml"
)

DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/$BUNDLE"

echo ""
echo "======================================"
echo "  Installing Omni Link for Premiere"
echo "======================================"
echo ""

if [ "$(uname)" != "Darwin" ]; then
    echo "  This installer is for macOS. On Windows, run the PowerShell line"
    echo "  from https://github.com/$OWNER/$REPO instead."
    exit 1
fi

VER=$(curl -fsSL "$RAW/latest.json" 2>/dev/null | sed -n 's/.*"version"[^"]*"\([^"]*\)".*/\1/p' | head -1)
if [ -z "$VER" ]; then
    echo "  ERROR: couldn't reach GitHub, or the release file is unreadable."
    echo "         Check your connection and try again."
    exit 1
fi
echo "  Version $VER"

if pgrep -f "Adobe Premiere Pro" > /dev/null 2>&1; then
    echo ""
    echo "  NOTE: Premiere Pro is running. Panels are only loaded at startup, so"
    echo "        quit and reopen it after this finishes."
fi

# ---- 1. let Premiere load unsigned panels --------------------------------
echo ""
echo "  1/2  Enabling unsigned panels…"
echo "       (this lets Premiere load UNSIGNED extensions — all of them, not"
echo "        just this one. The uninstaller switches it back off.)"
for v in 6 7 8 9 10 11 12 13; do
    defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 2>/dev/null || true
done
killall cfprefsd 2>/dev/null || true

# ---- 2. download into a staging folder, then swap ------------------------
# Staged first so a dropped connection halfway through can't leave a
# half-written panel where a working one used to be.
echo "  2/2  Downloading the panel…"
STAGE="$(mktemp -d)/omnilink"
mkdir -p "$STAGE"
for f in "${FILES[@]}"; do
    mkdir -p "$STAGE/$(dirname "$f")"
    if ! curl -fsSL "$RAW/$f" -o "$STAGE/$f"; then
        echo ""
        echo "  ERROR: failed to download $f — nothing was changed."
        rm -rf "$(dirname "$STAGE")"
        exit 1
    fi
    if [ ! -s "$STAGE/$f" ]; then
        echo ""
        echo "  ERROR: $f came back empty — nothing was changed."
        rm -rf "$(dirname "$STAGE")"
        exit 1
    fi
done

# Cheap sanity check: if this isn't the panel, don't install it.
if ! grep -q "var VERSION" "$STAGE/client/main.js"; then
    echo ""
    echo "  ERROR: that download doesn't look like Omni Link. Nothing was changed."
    rm -rf "$(dirname "$STAGE")"
    exit 1
fi

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$STAGE/." "$DEST/"
rm -rf "$(dirname "$STAGE")"

echo ""
echo "  Done — Omni Link $VER installed."
echo ""
echo "  Next:"
echo "   • Restart Premiere Pro."
echo "   • Open it from  Window > Extensions > Omni Link"
echo ""
echo "  After that the panel updates itself: it checks on launch and offers"
echo "  any newer version with a button."
echo ""
echo "  To remove it:"
echo "    rm -rf \"$DEST\""
echo "    for v in 6 7 8 9 10 11 12 13; do defaults write \"com.adobe.CSXS.\$v\" PlayerDebugMode 0; done"
echo ""
