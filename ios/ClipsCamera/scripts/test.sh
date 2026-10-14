#!/bin/bash
# Run Clips Camera's tests in tiers, from ios/ClipsCamera:
#
#   scripts/test.sh            fast: logic only, about a minute with the build — use this while working
#   scripts/test.sh render     the tests that render and encode real video
#   scripts/test.sh full       everything (fast + render + UI) — before a release
#   scripts/test.sh fast -only-testing:ClipsCameraTests/ReelTests   extra xcodebuild flags pass through
#
# SIM picks the simulator (default "iPhone 17 Pro"); use your own if another
# session may be running tests on the shared one.
#
# A test that renders or encodes video belongs in RENDER below, so the fast
# tier stays fast.
set -euo pipefail
cd "$(dirname "$0")/.."

RENDER=(
  ClipsCameraTests/EditRendererTests/testRendersPlanFromA240fpsRecording
  ClipsCameraTests/FieldViewRendererTests/testAppendsTheTrimmedFieldViewAfterTheCloseUp
  ClipsCameraTests/FieldViewRendererTests/testFieldViewAloneOpensOnTheTitleCard
  ClipsCameraTests/ReelStitcherTests/testPutsAtBatsTogether
  ClipsCameraTests/ReelTests/testBuildsAReel
  ClipsCameraTests/ReelTests/testSharesWithReplays
  ClipsCameraTests/ReelTests/testShareContentChoices
  ClipsCameraTests/ReelTests/testVerticalShares
  ClipsCameraTests/VerticalTests/testVerticalVideoEndToEnd
)
UI=(ClipsCameraUITests)
# A one-time migration tool, not a test (it runs only when asked: see the file).
NEVER=(ClipsCameraTests/MigrationRenderTests)

tier=${1:-fast}
[[ $# -gt 0 ]] && shift
flags=()
case "$tier" in
  fast)   for t in "${RENDER[@]}" "${UI[@]}" "${NEVER[@]}"; do flags+=("-skip-testing:$t"); done ;;
  render) for t in "${RENDER[@]}"; do flags+=("-only-testing:$t"); done
          ;;
  full)   for t in "${NEVER[@]}"; do flags+=("-skip-testing:$t"); done
          ;;
  *) echo "usage: scripts/test.sh [fast|render|full] [xcodebuild flags…]" >&2; exit 2 ;;
esac

[[ -d ClipsCamera.xcodeproj ]] || xcodegen generate --quiet
start=$SECONDS
set +e
xcodebuild test -project ClipsCamera.xcodeproj -scheme ClipsCamera \
  -destination "platform=iOS Simulator,name=${SIM:-iPhone 17 Pro}" -derivedDataPath build/dd \
  "${flags[@]}" "$@" 2>&1 | grep -E "^Test (Case|Suite).*(passed|failed|skipped)|error:|\*\* TEST"
status=${PIPESTATUS[0]}
echo "$tier tier: $((SECONDS - start))s"
exit "$status"
