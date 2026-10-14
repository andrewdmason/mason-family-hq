#!/bin/bash
# Ship a new Clips Camera build to everyone:
#   - TestFlight (Andrew), uploaded to App Store Connect
#   - the install link at family.mason.io/clips/install (Sebastian, who's under
#     13 and can't use TestFlight): an ad hoc build that installs only on
#     iPhones registered on the developer account.
# Usage: scripts/release.sh [--adhoc-only]   (from ios/ClipsCamera)
#
# Signs with Xcode's signed-in account (automatic). The build number is the
# release time, so it always increases. Publishing reads the Supabase secret
# key at run time through the Supabase CLI's login; nothing is stored. The
# same key reads the watch-only viewer key (migration 00203) that's built into
# the app, so people who aren't signed in (a coach) can still watch.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_REF=evemrivkogdwmrgrdayc
SUPABASE_URL="https://$PROJECT_REF.supabase.co"
BUCKET=app-builds
PREFIX=clips-camera
BUILD=$(date +%Y%m%d%H%M)
ARCHIVE=build/ClipsCamera.xcarchive

TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
TOKEN=$(echo "${TOKEN#go-keyring-base64:}" | base64 -d)
KEY=$(curl -fsS -H "Authorization: Bearer $TOKEN" "https://api.supabase.com/v1/projects/$PROJECT_REF/api-keys?reveal=true" |
  python3 -c "import json,sys; print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='service_role'))")
VIEWER_KEY=$(curl -fsS "$SUPABASE_URL/rest/v1/clips_viewer_keys?select=key&id=eq.1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" |
  python3 -c "import json,sys; print(json.load(sys.stdin)[0]['key'])")

xcodegen generate --quiet
rm -rf "$ARCHIVE" build/export build/adhoc
xcodebuild -project ClipsCamera.xcodeproj -scheme ClipsCamera -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD" CLIPS_VIEWER_KEY="$VIEWER_KEY" -quiet archive

if [[ "${1:-}" != "--adhoc-only" ]]; then
  xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath build/export \
    -exportOptionsPlist scripts/ExportOptions-testflight.plist -allowProvisioningUpdates
  echo "TestFlight: uploaded build $BUILD (shows up after Apple's processing, usually 5–15 minutes)."
fi

# Ad hoc build for the install link.
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath build/adhoc \
  -exportOptionsPlist scripts/ExportOptions-adhoc.plist -allowProvisioningUpdates -quiet
IPA=$(ls build/adhoc/*.ipa)
VERSION=$(/usr/libexec/PlistBuddy -c "Print :ApplicationProperties:CFBundleShortVersionString" "$ARCHIVE/Info.plist")

upload() { # <file> <path in bucket> <content type>
  curl -fsS -X POST "$SUPABASE_URL/storage/v1/object/$BUCKET/$2" \
    -H "Authorization: Bearer $KEY" -H "apikey: $KEY" -H "x-upsert: true" \
    -H "Content-Type: $3" -H "cache-control: no-cache" --data-binary "@$1" >/dev/null
}
public() { echo "$SUPABASE_URL/storage/v1/object/public/$BUCKET/$1"; }

mkdir -p build/adhoc/site
sips -Z 57 ClipsCamera/Assets.xcassets/AppIcon.appiconset/icon-1024.png --out build/adhoc/site/icon-57.png >/dev/null
sips -Z 512 ClipsCamera/Assets.xcassets/AppIcon.appiconset/icon-1024.png --out build/adhoc/site/icon-512.png >/dev/null
cat > build/adhoc/site/manifest.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>items</key><array><dict>
  <key>assets</key><array>
    <dict><key>kind</key><string>software-package</string><key>url</key><string>$(public "$PREFIX/$BUILD/BaseballClips.ipa")</string></dict>
    <dict><key>kind</key><string>display-image</string><key>url</key><string>$(public "$PREFIX/icon-57.png")</string></dict>
    <dict><key>kind</key><string>full-size-image</string><key>url</key><string>$(public "$PREFIX/icon-512.png")</string></dict>
  </array>
  <key>metadata</key><dict>
    <key>bundle-identifier</key><string>io.mason.clipscamera</string>
    <key>bundle-version</key><string>$VERSION</string>
    <key>kind</key><string>software</string>
    <key>title</key><string>Baseball Clips</string>
  </dict>
</dict></array></dict></plist>
PLIST
printf '{"version":"%s (%s)","build":"%s","publishedAt":"%s","manifest":"%s"}\n' \
  "$VERSION" "$BUILD" "$BUILD" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(public "$PREFIX/$BUILD/manifest.plist")" > build/adhoc/site/latest.json

upload "$IPA" "$PREFIX/$BUILD/BaseballClips.ipa" application/octet-stream
upload build/adhoc/site/manifest.plist "$PREFIX/$BUILD/manifest.plist" text/xml
upload build/adhoc/site/icon-57.png "$PREFIX/icon-57.png" image/png
upload build/adhoc/site/icon-512.png "$PREFIX/icon-512.png" image/png
upload build/adhoc/site/latest.json "$PREFIX/latest.json" application/json
echo "Install link: published build $BUILD — https://family.mason.io/clips/install"
