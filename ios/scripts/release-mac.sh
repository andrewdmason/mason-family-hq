#!/bin/bash
# Ship a new build of Tuttles for the family Mac.
# Usage: scripts/release-mac.sh   (from ios/)
#
# Builds the Mac app, signs it with the family Developer ID, has Apple notarize
# it (so it opens on another Mac without a warning), and publishes it to
# family.mason.io/install/tuttles. Copies already installed notice the new
# build and offer it in the sidebar (Tuttles/Mac/MacUpdate.swift), so
# publishing here is all it takes to update them.
#
# One-time setup on the Mac that releases:
#   - A "Developer ID Application" certificate: Xcode › Settings › Accounts ›
#     Manage Certificates › + › Developer ID Application (the account holder
#     only).
#   - Notarization sign-in, kept in the keychain under the name family-notary:
#       xcrun notarytool store-credentials family-notary --team-id S4AV4J8F99
#     (it asks for the Apple ID and an app-specific password from
#     account.apple.com).
#
# The build number is the release time, so it always increases. Publishing
# reads the Supabase secret key at run time through the Supabase CLI's login;
# nothing is stored.
set -euo pipefail
cd "$(dirname "$0")/.."

SCHEME=TuttlesMac
NAME=Tuttles
PREFIX=tuttles-mac
TEAM=S4AV4J8F99
NOTARY_PROFILE=family-notary
BUILD=$(date +%Y%m%d%H%M)
ARCHIVE="build/$SCHEME.xcarchive"
OUT=build/mac

if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "No Developer ID Application certificate on this Mac. Create one in Xcode ›" >&2
  echo "Settings › Accounts › Manage Certificates › + › Developer ID Application." >&2
  exit 1
fi
if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  echo "No notarization sign-in saved. Run once:" >&2
  echo "  xcrun notarytool store-credentials $NOTARY_PROFILE --team-id $TEAM" >&2
  exit 1
fi

xcodegen generate --quiet
rm -rf "$ARCHIVE" "$OUT"
mkdir -p "$OUT"
xcodebuild -project MasonApps.xcodeproj -scheme "$SCHEME" -configuration Release \
  -destination 'generic/platform=macOS' -archivePath "$ARCHIVE" \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="Developer ID Application" DEVELOPMENT_TEAM="$TEAM" \
  OTHER_CODE_SIGN_FLAGS="--timestamp" CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO \
  CURRENT_PROJECT_VERSION="$BUILD" -quiet archive

APP="$ARCHIVE/Products/Applications/$NAME.app"
codesign --verify --deep --strict "$APP"

# Apple checks the app and issues a ticket; stapling it to the app lets it open
# on a Mac that's offline. The zip that's published is made after stapling.
ditto -c -k --keepParent "$APP" "$OUT/notarize.zip"
xcrun notarytool submit "$OUT/notarize.zip" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$APP"
spctl --assess --type execute "$APP"
ditto -c -k --keepParent "$APP" "$OUT/$NAME.zip"

PROJECT_REF=evemrivkogdwmrgrdayc
SUPABASE_URL="https://$PROJECT_REF.supabase.co"
BUCKET=app-builds
TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
# Older Supabase CLIs stored it base64-encoded behind a prefix; newer ones plain.
[[ "$TOKEN" == go-keyring-base64:* ]] && TOKEN=$(echo "${TOKEN#go-keyring-base64:}" | base64 -d)
KEY=$(curl -fsS -H "Authorization: Bearer $TOKEN" "https://api.supabase.com/v1/projects/$PROJECT_REF/api-keys?reveal=true" |
  python3 -c "import json,sys; print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='service_role'))")

upload() { # <file> <path in bucket> <content type>
  curl -fsS -X POST "$SUPABASE_URL/storage/v1/object/$BUCKET/$2" \
    -H "Authorization: Bearer $KEY" -H "apikey: $KEY" -H "x-upsert: true" \
    -H "Content-Type: $3" -H "cache-control: no-cache" --data-binary "@$1" >/dev/null
}
public() { echo "$SUPABASE_URL/storage/v1/object/public/$BUCKET/$1"; }

VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist")
printf '{"version":"%s (%s)","build":"%s","publishedAt":"%s","download":"%s"}\n' \
  "$VERSION" "$BUILD" "$BUILD" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(public "$PREFIX/$BUILD/$NAME.zip")" > "$OUT/latest.json"

upload "$OUT/$NAME.zip" "$PREFIX/$BUILD/$NAME.zip" application/zip
# Last, so a Mac never sees a build whose file isn't there yet.
upload "$OUT/latest.json" "$PREFIX/latest.json" application/json
echo "Published $NAME for Mac, build $BUILD — https://family.mason.io/install/tuttles"
