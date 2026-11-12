#!/bin/bash
# Ship a new build of a family app.
# Usage: scripts/release.sh [App] [--adhoc-only]   (from ios/; App defaults to Practice)
#
#   - TestFlight (Andrew, and any family member 13 or older), uploaded to App
#     Store Connect. The app's record must exist there first (bundle id
#     io.mason.<app>, e.g. io.mason.practice). --adhoc-only skips it.
#   - For apps in INSTALL_LINK_APPS, also an install link at
#     family.mason.io/install/<app> for kids under 13, who can't use TestFlight:
#     an ad hoc build that installs only on iPhones registered on the developer
#     account (plugging a phone into Xcode registers it). Copies installed from
#     the link check for newer builds and show an update banner (MasonKit's
#     AppUpdate), so publishing here is all it takes to update them.
#
# Signs with Xcode's signed-in account (automatic). The build number is the
# release time, so it always increases. Publishing reads the Supabase secret
# key at run time through the Supabase CLI's login; nothing is stored.
set -euo pipefail
cd "$(dirname "$0")/.."

INSTALL_LINK_APPS=(Tuttles)

APP="${1:-Practice}"
ADHOC_ONLY=false
[[ "${2:-}" == "--adhoc-only" ]] && ADHOC_ONLY=true
BUILD=$(date +%Y%m%d%H%M)
ARCHIVE="build/$APP.xcarchive"

INSTALL_LINK=false
for a in "${INSTALL_LINK_APPS[@]}"; do [[ "$a" == "$APP" ]] && INSTALL_LINK=true; done
if $ADHOC_ONLY && ! $INSTALL_LINK; then
  echo "$APP has no install link; add it to INSTALL_LINK_APPS first." >&2
  exit 1
fi

xcodegen generate --quiet
rm -rf "$ARCHIVE" build/export build/adhoc
xcodebuild -project MasonApps.xcodeproj -scheme "$APP" -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD" -quiet archive

# The install link goes first: it doesn't depend on App Store Connect.
if $INSTALL_LINK; then
  PROJECT_REF=evemrivkogdwmrgrdayc
  SUPABASE_URL="https://$PROJECT_REF.supabase.co"
  BUCKET=app-builds
  PREFIX=$(echo "$APP" | tr '[:upper:]' '[:lower:]')

  TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
  TOKEN=$(echo "${TOKEN#go-keyring-base64:}" | base64 -d)
  KEY=$(curl -fsS -H "Authorization: Bearer $TOKEN" "https://api.supabase.com/v1/projects/$PROJECT_REF/api-keys?reveal=true" |
    python3 -c "import json,sys; print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='service_role'))")

  xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath build/adhoc \
    -exportOptionsPlist scripts/ExportOptions-adhoc.plist -allowProvisioningUpdates -quiet
  IPA=$(ls build/adhoc/*.ipa)
  VERSION=$(/usr/libexec/PlistBuddy -c "Print :ApplicationProperties:CFBundleShortVersionString" "$ARCHIVE/Info.plist")
  BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :ApplicationProperties:CFBundleIdentifier" "$ARCHIVE/Info.plist")
  APP_PATH=$(/usr/libexec/PlistBuddy -c "Print :ApplicationProperties:ApplicationPath" "$ARCHIVE/Info.plist")
  TITLE=$(/usr/libexec/PlistBuddy -c "Print :CFBundleDisplayName" "$ARCHIVE/Products/$APP_PATH/Info.plist" 2>/dev/null || echo "$APP")
  ICON="$APP/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png"

  upload() { # <file> <path in bucket> <content type>
    curl -fsS -X POST "$SUPABASE_URL/storage/v1/object/$BUCKET/$2" \
      -H "Authorization: Bearer $KEY" -H "apikey: $KEY" -H "x-upsert: true" \
      -H "Content-Type: $3" -H "cache-control: no-cache" --data-binary "@$1" >/dev/null
  }
  public() { echo "$SUPABASE_URL/storage/v1/object/public/$BUCKET/$1"; }

  mkdir -p build/adhoc/site
  sips -Z 57 "$ICON" --out build/adhoc/site/icon-57.png >/dev/null
  sips -Z 512 "$ICON" --out build/adhoc/site/icon-512.png >/dev/null
  cat > build/adhoc/site/manifest.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>items</key><array><dict>
  <key>assets</key><array>
    <dict><key>kind</key><string>software-package</string><key>url</key><string>$(public "$PREFIX/$BUILD/$APP.ipa")</string></dict>
    <dict><key>kind</key><string>display-image</string><key>url</key><string>$(public "$PREFIX/icon-57.png")</string></dict>
    <dict><key>kind</key><string>full-size-image</string><key>url</key><string>$(public "$PREFIX/icon-512.png")</string></dict>
  </array>
  <key>metadata</key><dict>
    <key>bundle-identifier</key><string>$BUNDLE_ID</string>
    <key>bundle-version</key><string>$VERSION</string>
    <key>kind</key><string>software</string>
    <key>title</key><string>$TITLE</string>
  </dict>
</dict></array></dict></plist>
PLIST
  printf '{"version":"%s (%s)","build":"%s","publishedAt":"%s","manifest":"%s"}\n' \
    "$VERSION" "$BUILD" "$BUILD" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(public "$PREFIX/$BUILD/manifest.plist")" > build/adhoc/site/latest.json

  upload "$IPA" "$PREFIX/$BUILD/$APP.ipa" application/octet-stream
  upload build/adhoc/site/manifest.plist "$PREFIX/$BUILD/manifest.plist" text/xml
  upload build/adhoc/site/icon-57.png "$PREFIX/icon-57.png" image/png
  upload build/adhoc/site/icon-512.png "$PREFIX/icon-512.png" image/png
  # Last, so the app never sees a build whose files aren't all there yet.
  upload build/adhoc/site/latest.json "$PREFIX/latest.json" application/json
  echo "Install link: published $APP build $BUILD — https://family.mason.io/install/$PREFIX"
fi

if ! $ADHOC_ONLY; then
  xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath build/export \
    -exportOptionsPlist scripts/ExportOptions-testflight.plist -allowProvisioningUpdates
  echo "TestFlight: uploaded $APP build $BUILD (shows up after Apple's processing, usually 5–15 minutes)."
fi
