#!/bin/bash
# Build Clips Camera and install it on Andrew's iPhone (cable or same Wi-Fi).
# Usage: scripts/install-on-phone.sh   (from ios/ClipsCamera)
set -euo pipefail
cd "$(dirname "$0")/.."

PHONE="${PHONE:-00008150-00043D561A87801C}" # "iPhone Andrew"

xcodegen generate --quiet
xcodebuild -project ClipsCamera.xcodeproj -scheme ClipsCamera \
  -destination "id=$PHONE" -derivedDataPath build/dd \
  -configuration Debug -allowProvisioningUpdates -quiet build
xcrun devicectl device install app --device "$PHONE" \
  build/dd/Build/Products/Debug-iphoneos/ClipsCamera.app
xcrun devicectl device process launch --device "$PHONE" io.mason.clipscamera || true
echo "Installed. Open Clips Camera on the phone."
