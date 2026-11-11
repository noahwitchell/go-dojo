#!/bin/zsh
# Renders icons/icon.svg to the PNG sizes phones need, using headless Chrome.
cd "${0:A:h}/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP=$(mktemp -d)
for s in 180 192 512; do
  cat > "$TMP/i.html" <<H
<html><body style="margin:0;background:#e4c792"><img src="file://$PWD/icons/icon.svg" width="$s" height="$s" style="display:block"></body></html>
H
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=$s,$s --screenshot="$PWD/icons/icon-$s.png" "file://$TMP/i.html" >/dev/null 2>&1
done
cp icons/icon-180.png icons/apple-touch-icon.png
rm -rf "$TMP"; ls -la icons
