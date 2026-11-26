#!/data/data/com.termux/files/usr/bin/bash
set -e

APP_DIR="/data/data/com.termux/files/home/streamsutra"
cd "$APP_DIR"

echo "=========================================================="
echo "🚀 Building StreamSutra Standalone Android APK (v1.2.0)"
echo "   Open Bring-Your-Own-Content Media Player"
echo "=========================================================="

echo "=== STEP 1: Generating R.java with aapt ==="
aapt package -f -m \
  -J src/ \
  -M AndroidManifest.xml \
  -S res/ \
  -I android.jar

echo "=== STEP 2: Compiling Java with javac ==="
rm -rf build
mkdir -p build/classes
javac -cp android.jar -d build/classes src/org/streamsutra/app/*.java

echo "=== STEP 3: Converting bytecode to classes.dex with d8 ==="
d8 --lib android.jar --output build/ build/classes/org/streamsutra/app/*.class

echo "=== STEP 4: Packaging resource APK with In-App Assets & Engines ==="
aapt package -f \
  -M AndroidManifest.xml \
  -S res/ \
  -A assets/ \
  -I android.jar \
  -F build/unaligned.apk

echo "=== STEP 5: Adding classes.dex to APK ==="
(cd build && aapt add unaligned.apk classes.dex)

echo "=== STEP 6: Zip-aligning APK (4-byte alignment) ==="
zipalign -p -f 4 build/unaligned.apk build/aligned.apk

echo "=== STEP 7: Ensuring keystore exists ==="
if [ ! -f "debug.keystore" ]; then
  keytool -genkey -v \
    -keystore debug.keystore \
    -storepass android \
    -alias androiddebugkey \
    -keypass android \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=StreamSutra,O=StreamSutra,C=IN"
fi

echo "=== STEP 8: Signing APK with apksigner ==="
OUT_APK="$APP_DIR/StreamSutra.apk"
apksigner sign \
  --ks debug.keystore \
  --ks-pass pass:android \
  --ks-key-alias androiddebugkey \
  --key-pass pass:android \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$OUT_APK" \
  build/aligned.apk

echo "=== STEP 9: Verifying APK signature ==="
apksigner verify --verbose "$OUT_APK"
zipalign -c -v 4 "$OUT_APK"

echo "=== STEP 10: Copying APK to /sdcard/Download/ ==="
if [ -d "/sdcard/Download" ]; then
  cp -f "$OUT_APK" /sdcard/Download/StreamSutra.apk
  chmod 644 /sdcard/Download/StreamSutra.apk
  echo "✔ Successfully copied to /sdcard/Download/StreamSutra.apk"
fi

echo "=========================================================="
echo "🎉 SUCCESS: StreamSutra v1.2.0 Built & Signed Successfully!"
echo "📍 App APK: $OUT_APK"
echo "📍 Download Path: /sdcard/Download/StreamSutra.apk"
ls -lh "$OUT_APK"
echo "=========================================================="
