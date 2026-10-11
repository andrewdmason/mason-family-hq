#!/bin/bash
# Build Clips Camera for release and upload it to TestFlight.
# Usage: scripts/testflight.sh   (from ios/ClipsCamera)
#
# Signs with Xcode's signed-in account (automatic, cloud-managed distribution
# certificate). The build number is the upload time, so it always increases.
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD=$(date +%Y%m%d%H%M)
ARCHIVE=build/ClipsCamera.xcarchive

xcodegen generate --quiet
rm -rf "$ARCHIVE" build/export
xcodebuild -project ClipsCamera.xcodeproj -scheme ClipsCamera -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD" -quiet archive
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath build/export \
  -exportOptionsPlist scripts/ExportOptions.plist -allowProvisioningUpdates
echo "Uploaded build $BUILD. It shows up in TestFlight after Apple finishes processing (usually 5–15 minutes)."
