#!/bin/bash
set -euo pipefail
if [[ $# != 2 ]]; then echo 'Usage: build.sh PREPARED_PAYLOAD OUTPUT_DIRECTORY' >&2; exit 2; fi
src="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$src/../../.." && pwd)"
payload="$(cd "$1" && pwd)"
mkdir -p "$2"
output="$(cd "$2" && pwd)"
build="$(mktemp -d "${TMPDIR:-/tmp}/holdem.dmg.XXXXXX")"
trap 'rm -rf "$build"' EXIT
arch="$(uname -m)"
case "$arch" in
  arm64) asset_arch=arm64 ;;
  x86_64) asset_arch=x64 ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac
for exe in "$payload/node" "$payload/kernel-worker/kernel-worker"; do
  lipo "$exe" -verify_arch "$arch"
done
app="$build/image/Holdem on the Clock.app"
resources="$app/Contents/Resources"
mkdir -p "$app/Contents/MacOS" "$resources" "$build/Folio.iconset"
ditto --noextattr --norsrc --noqtn "$payload" "$resources/runtime"
cp "$src/Info.plist" "$app/Contents/Info.plist"
version="$("$payload/node" -p "require(process.argv[1]).version" "$repo/package.json")"
plutil -replace CFBundleShortVersionString -string "$version" "$app/Contents/Info.plist"
plutil -replace CFBundleVersion -string "$version" "$app/Contents/Info.plist"
clang -O2 -fobjc-arc -framework Cocoa -mmacosx-version-min=14.0 "$src/launcher.m" -o "$app/Contents/MacOS/HoldemClock"
clang -O2 -fobjc-arc -framework Cocoa "$src/icon.m" -o "$build/icon"
"$build/icon" "$repo/public/folio.svg" "$build/master.png"
for size in 16 32 128 256 512; do
  sips -s format png -z "$size" "$size" "$build/master.png" --out "$build/Folio.iconset/icon_${size}x${size}.png" >/dev/null
  sips -s format png -z "$((size * 2))" "$((size * 2))" "$build/master.png" --out "$build/Folio.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$build/Folio.iconset" -o "$resources/Folio.icns"
codesign --force --sign - --timestamp=none --identifier io.github.lrrong2020.holdem-on-the-clock "$app"
codesign --verify --deep --strict "$app"
ln -s /Applications "$build/image/Applications"
disk_image="$output/Holdem-on-the-Clock-macOS-$asset_arch.dmg"
hdiutil create -quiet -ov -fs HFS+ -format UDZO -volname 'Holdem on the Clock' -srcfolder "$build/image" "$disk_image"
hdiutil verify -quiet "$disk_image"
echo "$disk_image"
