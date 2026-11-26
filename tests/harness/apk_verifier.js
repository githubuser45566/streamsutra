/**
 * apk_verifier.js
 * Android Manifest, Build Script & APK Signature Verification Harness
 * Validates specifications from Survey E3 and Project Milestones M3.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

class ApkVerifier {
    /**
     * Parse AndroidManifest.xml and extract key configuration attributes
     */
    static parseManifest(manifestPath) {
        if (!fs.existsSync(manifestPath)) {
            throw new Error(`Manifest not found at: ${manifestPath}`);
        }
        const content = fs.readFileSync(manifestPath, 'utf8');

        const vCodeMatch = content.match(/android:versionCode="(\d+)"/);
        const vNameMatch = content.match(/android:versionName="([^"]+)"/);
        const pkgMatch = content.match(/package="([^"]+)"/);
        const minSdkMatch = content.match(/android:minSdkVersion="(\d+)"/);
        const targetSdkMatch = content.match(/android:targetSdkVersion="(\d+)"/);

        const permissions = [];
        const permMatches = content.matchAll(/<uses-permission\s+android:name="([^"]+)"/g);
        for (const m of permMatches) {
            permissions.push(m[1]);
        }

        return {
            versionCode: vCodeMatch ? parseInt(vCodeMatch[1], 10) : null,
            versionName: vNameMatch ? vNameMatch[1] : null,
            package: pkgMatch ? pkgMatch[1] : null,
            minSdkVersion: minSdkMatch ? parseInt(minSdkMatch[1], 10) : null,
            targetSdkVersion: targetSdkMatch ? parseInt(targetSdkMatch[1], 10) : null,
            permissions,
            hasInternetPermission: permissions.includes('android.permission.INTERNET'),
            hasNetworkPermission: permissions.includes('android.permission.ACCESS_NETWORK_STATE'),
            hasWakeLockPermission: permissions.includes('android.permission.WAKE_LOCK'),
            content
        };
    }

    /**
     * Inspect build_apk.sh for required toolchain pipeline steps
     */
    static inspectBuildScript(scriptPath) {
        if (!fs.existsSync(scriptPath)) {
            throw new Error(`Build script not found at: ${scriptPath}`);
        }
        const content = fs.readFileSync(scriptPath, 'utf8');

        return {
            usesAapt: content.includes('aapt package') || content.includes('aapt'),
            usesJavac: content.includes('javac'),
            usesD8: content.includes('d8'),
            usesZipalign: content.includes('zipalign'),
            usesApksigner: content.includes('apksigner sign'),
            usesDynamicVersioning: content.includes('versionName') || content.includes('versionCode'),
            copiesToSdcard: content.includes('/sdcard/Download/StreamSutra.apk') || content.includes('/sdcard/Download/LiveTV.apk'),
            content
        };
    }

    /**
     * Run apksigner verify and zipalign check if APK exists
     */
    static verifyApkFile(apkPath) {
        if (!fs.existsSync(apkPath)) {
            return {
                exists: false,
                verified: false,
                error: `APK does not exist at ${apkPath}`
            };
        }

        try {
            const apksignerOut = execSync(`apksigner verify --verbose "${apkPath}"`, {
                encoding: 'utf8',
                timeout: 10000
            });

            const v1 = /Verified using v1 scheme \(JAR signing\):\s*true/i.test(apksignerOut);
            const v2 = /Verified using v2 scheme \(APK Signature Scheme v2\):\s*true/i.test(apksignerOut);
            const v3 = /Verified using v3 scheme \(APK Signature Scheme v3\):\s*true/i.test(apksignerOut);

            let zipalignOk = false;
            try {
                execSync(`zipalign -c 4 "${apkPath}"`, { timeout: 10000 });
                zipalignOk = true;
            } catch (errZ) {
                zipalignOk = false;
            }

            return {
                exists: true,
                verified: v1 && v2 && v3 && zipalignOk,
                v1Scheme: v1,
                v2Scheme: v2,
                v3Scheme: v3,
                zipalignAligned: zipalignOk,
                rawOutput: apksignerOut
            };
        } catch (err) {
            return {
                exists: true,
                verified: false,
                error: err.message
            };
        }
    }
}

module.exports = ApkVerifier;
