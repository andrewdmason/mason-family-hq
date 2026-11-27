#!/bin/bash
# Build Calendar for the Mac and put it in Applications as "Family Calendar",
# replacing the copy that's there and reopening it. It's signed to run on this
# Mac only (see CalendarMac in project.yml).
# Usage: scripts/install-calendar-mac.sh   (from ios/)
set -euo pipefail
cd "$(dirname "$0")/.."

xcodegen generate --quiet
xcodebuild -project MasonApps.xcodeproj -scheme CalendarMac \
  -destination "platform=macOS" -derivedDataPath build/dd \
  -configuration Release -quiet build
BUILT="build/dd/Build/Products/Release/Family Calendar.app"
DEST="/Applications/Family Calendar.app"

# The copy that's running holds ⌃⌥Space and the menubar item: stop it first.
# (⌘Q would leave it in the menubar; this is the whole app.)
pkill -x "Family Calendar" 2>/dev/null || true
sleep 1
rm -rf "$DEST"
ditto "$BUILT" "$DEST"
# So the Dock and Finder pick up a changed icon.
touch "$DEST"
open "$DEST"
echo "Installed. Family Calendar is in Applications and in the menu bar (⌃⌥Space)."
