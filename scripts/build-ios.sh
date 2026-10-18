#!/usr/bin/env bash
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "iOS archive requires macOS with Xcode installed." >&2
  exit 2
fi
if [[ -z "${DEVELOPMENT_TEAM:-}" ]]; then
  echo "Set DEVELOPMENT_TEAM to the Apple Developer Team ID shown in Xcode." >&2
  exit 2
fi
npm ci
npm run ios:setup
npx cap sync ios
xcodebuild \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/Shuyin.xcarchive \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
  archive
echo "Archive ready at build/Shuyin.xcarchive. Export/sign it with Xcode Organizer."
