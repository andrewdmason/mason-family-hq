#!/bin/bash
# Build MasonOS and install it on Andrew's iPhone (cable or same Wi-Fi).
# Usage: scripts/install-on-phone.sh   (from ios/MasonOS)
set -euo pipefail
cd "$(dirname "$0")/.."

PHONE="${PHONE:-00008150-00043D561A87801C}" # "iPhone Andrew"

xcodegen generate --quiet
xcodebuild -project MasonOS.xcodeproj -scheme MasonOS \
  -destination "id=$PHONE" -derivedDataPath build/dd \
  -configuration Debug -allowProvisioningUpdates -quiet build
xcrun devicectl device install app --device "$PHONE" \
  build/dd/Build/Products/Debug-iphoneos/MasonOS.app
xcrun devicectl device process launch --device "$PHONE" io.mason.masonos || true
echo "Installed. Open MasonOS on the phone."
