#!/bin/bash
# Ship a new MasonOS build to TestFlight (Andrew, and later any family member
# 13 or older). Usage: scripts/release.sh   (from ios/MasonOS)
#
# Signs with Xcode's signed-in account (automatic). The build number is the
# release time, so it always increases. The app record must exist in App Store
# Connect first (bundle id io.mason.masonos).
#
# Sebastian is under 13 and can't use TestFlight. When MasonOS goes to him, add
# the ad hoc install link and in-app updater the way Clips Camera had them (see
# ios/ClipsCamera/scripts/release.sh and Clips/AppUpdate.swift in git history,
# before MasonOS replaced it).
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD=$(date +%Y%m%d%H%M)
ARCHIVE=build/MasonOS.xcarchive

xcodegen generate --quiet
rm -rf "$ARCHIVE" build/export
xcodebuild -project MasonOS.xcodeproj -scheme MasonOS -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD" -quiet archive
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath build/export \
  -exportOptionsPlist scripts/ExportOptions-testflight.plist -allowProvisioningUpdates
echo "TestFlight: uploaded build $BUILD (shows up after Apple's processing, usually 5–15 minutes)."
