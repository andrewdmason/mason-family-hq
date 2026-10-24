#!/bin/bash
# Build a family app and install it on Andrew's iPhone (cable or same Wi-Fi).
# Usage: scripts/install-on-phone.sh [App]   (from ios/; App defaults to Practice)
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:-Practice}"
BUNDLE="io.mason.$(echo "$APP" | tr '[:upper:]' '[:lower:]')"
PHONE="${PHONE:-00008150-00043D561A87801C}" # "iPhone Andrew"

xcodegen generate --quiet
xcodebuild -project MasonApps.xcodeproj -scheme "$APP" \
  -destination "id=$PHONE" -derivedDataPath build/dd \
  -configuration Debug -allowProvisioningUpdates -quiet build
xcrun devicectl device install app --device "$PHONE" \
  "build/dd/Build/Products/Debug-iphoneos/$APP.app"
xcrun devicectl device process launch --device "$PHONE" "$BUNDLE" || true
echo "Installed. Open $APP on the phone."
