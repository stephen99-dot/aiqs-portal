#!/usr/bin/env bash
# Runs inside the CI emulator (.github/workflows/android.yml): installs the
# test build, opens it, and saves screenshots so a person can see the app
# start without owning an Android phone. Fails if the app crashes on launch.
#
#   scripts/android-smoke.sh <path-to.apk> <output-dir>
set -u
APK="$1"
OUT="$2"
PKG="uk.co.theaiqs.portal"
mkdir -p "$OUT"

shot() { adb exec-out screencap -p > "$OUT/$1.png" && echo "saved $1.png"; }

adb wait-for-device
adb install -r "$APK" || { echo "::error::The app could not be installed"; exit 1; }
adb logcat -c

adb shell am start -W -n "$PKG/.MainActivity" || { echo "::error::The app could not be started"; exit 1; }
sleep 6
shot 01-splash
sleep 24
shot 02-first-screen

# Rotate to landscape and back: layout under the status / navigation bars.
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1
sleep 5
shot 03-landscape
adb shell settings put system user_rotation 0
sleep 3

# Android's back button on the first screen should background the app, not crash it.
adb shell input keyevent KEYCODE_BACK
sleep 3
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null
sleep 5
shot 04-after-back-and-reopen

adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
grep -E "Capacitor/Console|chromium.*CONSOLE" "$OUT/logcat.txt" | tail -80 > "$OUT/web-console.txt" || true

if grep -q "FATAL EXCEPTION" "$OUT/logcat.txt" && grep -A3 "FATAL EXCEPTION" "$OUT/logcat.txt" | grep -q "$PKG"; then
  echo "::error::The app crashed. See logcat.txt in the screenshots artifact."
  grep -A25 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -60
  exit 1
fi
if ! adb shell pidof "$PKG" >/dev/null; then
  echo "::error::The app is not running after launch."
  exit 1
fi
echo "The app installed, started and stayed running."
