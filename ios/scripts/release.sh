#!/bin/bash
# Ship a new build of a family app to TestFlight (Andrew, and later any family
# member 13 or older). Usage: scripts/release.sh [App]   (from ios/; App
# defaults to Practice)
#
# Signs with Xcode's signed-in account (automatic). The build number is the
# release time, so it always increases. The app's record must exist in App
# Store Connect first (bundle id io.mason.<app>, e.g. io.mason.practice).
#
# Sebastian is under 13 and can't use TestFlight. When an app goes to him, add
# the ad hoc install link and in-app updater the way Clips Camera had them (see
# ios/ClipsCamera/scripts/release.sh and Clips/AppUpdate.swift in git history),
# with the updater in MasonKit so every app gets it.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:-Practice}"
BUILD=$(date +%Y%m%d%H%M)
ARCHIVE="build/$APP.xcarchive"

xcodegen generate --quiet
rm -rf "$ARCHIVE" build/export
xcodebuild -project MasonApps.xcodeproj -scheme "$APP" -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD" -quiet archive
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath build/export \
  -exportOptionsPlist scripts/ExportOptions-testflight.plist -allowProvisioningUpdates
echo "TestFlight: uploaded $APP build $BUILD (shows up after Apple's processing, usually 5–15 minutes)."
