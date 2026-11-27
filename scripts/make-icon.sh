#!/bin/sh
# Makes assets/icon.icns from assets/icon.svg with the tools that come with macOS: sips draws the SVG and scales it, and iconutil packs the sizes.
set -e
cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
sips -s format png assets/icon.svg --out "$work/icon.png" > /dev/null
mkdir "$work/icon.iconset"
for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$work/icon.png" --out "$work/icon.iconset/icon_${size}x${size}.png" > /dev/null
    double=$((size * 2))
    sips -z "$double" "$double" "$work/icon.png" --out "$work/icon.iconset/icon_${size}x${size}@2x.png" > /dev/null
done
iconutil -c icns -o assets/icon.icns "$work/icon.iconset"
echo "Wrote assets/icon.icns"
