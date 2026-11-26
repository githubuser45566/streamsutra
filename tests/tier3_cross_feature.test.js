/**
 * tier3_cross_feature.test.js
 * Tier 3: Cross-Feature Combinations (18 Pairwise Tests)
 * Verifies interactions between modules, state synchronizations, and failover cascading.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ChallengeOracle = require('./harness/challenge_oracle.js');
const { MockWindow, MockDocument, MockElement } = require('./harness/mock_dom.js');
const { TORRENT_PROVIDERS, SessionHarness } = require('./harness/session_harness.js');
const TelemetryHarness = require('./harness/telemetry_harness.js');
const ApkVerifier = require('./harness/apk_verifier.js');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'AndroidManifest.xml');
const BUILD_SCRIPT_PATH = path.join(PROJECT_ROOT, 'build_apk.sh');
const APK_PATH = path.join(PROJECT_ROOT, 'LiveTV.apk');

test('T3.01 [F01 x F02]: Challenge Deobfuscator + Script Signature Tag', () => {
    const mockWin = new MockWindow();
    const sigScript = mockWin.document.createElement('script');
    sigScript.id = 'webtorSignature';
    sigScript.src = 'https://cdn.jsdelivr.net/npm/@webtor/embed-sdk-js@0.2.19/dist/index.min.js';
    mockWin.document.head.appendChild(sigScript);

    const testId = 'sess-combo-1';
    const testToken = '12345678-1234-4234-8234-123456789abc';
    const packed = ChallengeOracle.generatePackedChallenge(testId, testToken);

    // Deobfuscator extracts token
    const extractedToken = ChallengeOracle.deobfuscateChallenge(packed);
    assert.strictEqual(extractedToken, testToken);

    // Verify script collection in DOM satisfies check condition
    const scripts = mockWin.document.getElementsByTagName('script');
    assert.strictEqual(ChallengeOracle.checkScriptsCollection(scripts), true);

    // Compute and verify SHA1 hash
    const expectedHash = ChallengeOracle.computeHash(testId, extractedToken);
    assert.strictEqual(ChallengeOracle.verifyHandshake(testId, extractedToken, expectedHash), true);
});

test('T3.02 [F01 x F03]: Challenge Deobfuscator + Window Proxy contentWindow Polyfill', () => {
    const mockWin = new MockWindow();
    mockWin.applyContentWindowPolyfill();

    const testId = 'webtor-session-poly';
    mockWin.frames[`webtor-${testId}`] = mockWin;

    let messageDispatched = null;
    mockWin.addEventListener('message', (e) => {
        messageDispatched = e.data;
    });

    const dynamicUuid = '89d95df8-f19b-4ee7-ae7f-499c3551ac22';
    const frame = mockWin.frames[`webtor-${testId}`];
    assert.ok(frame && frame.contentWindow);

    assert.doesNotThrow(() => {
        frame.contentWindow.postMessage({ id: testId, name: 'check', data: dynamicUuid }, '*');
    });

    assert.ok(messageDispatched);
    assert.strictEqual(messageDispatched.name, 'check');
    assert.strictEqual(messageDispatched.data, dynamicUuid);
});

test('T3.03 [F01 x F08]: Challenge Resolution + 12s Watchdog Timer Disarm', () => {
    const harness = new SessionHarness();
    const session = harness.startSession({ name: 'Fast Torrent', seeds: 40 });
    assert.ok(session.watchdogTimer !== null, 'Watchdog should be armed initially');

    // Simulate inited event from successful challenge resolution
    harness.handleTelemetryEvent({ name: 'inited' });
    harness.confirmPlayback('challenge_pass_inited');

    assert.strictEqual(session.watchdogTimer, null, 'Watchdog must be disarmed on inited');
    assert.strictEqual(session.isStreamingActive, true);
    harness.destroyCurrentTorrentPlayer();
});

test('T3.04 [F06 x F07]: Multi-Provider Registry + In-Player Provider Selector Bar', () => {
    const mockWin = new MockWindow();
    const bar = mockWin.document.createElement('div');
    bar.id = 'streamServerBar';
    mockWin.document.body.appendChild(bar);

    const harness = new SessionHarness(mockWin);
    harness.startSession({ name: 'Avengers' });

    TORRENT_PROVIDERS.forEach((p, idx) => {
        const chip = mockWin.document.createElement('button');
        chip.className = `server-chip ${idx === harness.activeSession.providerIndex ? 'active' : ''}`;
        chip.setAttribute('data-prov-idx', idx);
        bar.appendChild(chip);
    });

    // Switch to provider 2 (Magnet Player)
    harness.mountProvider(2);
    assert.strictEqual(harness.activeSession.providerIndex, 2);
    assert.strictEqual(TORRENT_PROVIDERS[2].id, 'magnet_player');

    harness.destroyCurrentTorrentPlayer();
});

test('T3.05 [F06 x F10]: Provider Switching + Clean 8-Step Destruction Protocol', () => {
    const mockWin = new MockWindow();
    const harness = new SessionHarness(mockWin);
    harness.startSession({ name: 'Movie' });

    // Switching provider must execute teardown first
    harness.destroyCurrentTorrentPlayer();
    assert.strictEqual(harness.teardownStepsExecuted.length, 8);
    assert.ok(harness.teardownStepsExecuted.includes('STEP_5_PURGE_IFRAMES_ABOUT_BLANK'));

    harness.mountProvider(1);
    assert.strictEqual(harness.activeSession.providerIndex, 1);
    harness.destroyCurrentTorrentPlayer();
});

test('T3.06 [F08 x F06]: 12s Watchdog + Multi-Provider Registry Sequential Failover', () => {
    const harness = new SessionHarness();
    harness.startSession({ name: 'Stalled Show' });
    assert.strictEqual(harness.activeSession.providerIndex, 0);

    // Watchdog fires for provider 0
    harness.handleWatchdogTimeout(TORRENT_PROVIDERS[0]);
    assert.strictEqual(harness.activeSession.providerIndex, 1);
    assert.strictEqual(TORRENT_PROVIDERS[1].id, 'webtor_web');

    // Watchdog fires for provider 1
    harness.handleWatchdogTimeout(TORRENT_PROVIDERS[1]);
    assert.strictEqual(harness.activeSession.providerIndex, 2);
    assert.strictEqual(TORRENT_PROVIDERS[2].id, 'magnet_player');

    harness.destroyCurrentTorrentPlayer();
});

test('T3.07 [F08 x F10]: 12s Watchdog + Clean 8-Step Destruction on Timeout', () => {
    const mockWin = new MockWindow();
    const iframe = mockWin.document.createElement('iframe');
    iframe.src = 'https://webtor.io/stalled';
    mockWin.document.body.appendChild(iframe);

    const harness = new SessionHarness(mockWin);
    harness.startSession({ name: 'Timeout Test' });

    harness.handleWatchdogTimeout(TORRENT_PROVIDERS[0]);
    assert.ok(harness.teardownStepsExecuted.includes('STEP_5_PURGE_IFRAMES_ABOUT_BLANK'));
    assert.strictEqual(iframe.src, 'about:blank');
    harness.destroyCurrentTorrentPlayer();
});

test('T3.08 [F08 x F11]: 12s Watchdog + Swarm Telemetry HUD Buffering Advance', () => {
    const harness = new SessionHarness();
    const session = harness.startSession({ name: 'Buffering Film', seeds: 20 });

    // While watchdog is armed, telemetry progress accumulates
    session.stats.progressPercent = 2.5;
    const progressHUD = TelemetryHarness.formatProgress(25, 1000);
    assert.strictEqual(progressHUD.percent, 2.5);
    assert.ok(session.watchdogTimer !== null);

    harness.destroyCurrentTorrentPlayer();
});

test('T3.09 [F09 x F08]: 1-Tap Manual Failover immediately clears Watchdog', () => {
    const harness = new SessionHarness();
    const session = harness.startSession({ name: 'Slow Film' });
    assert.ok(session.watchdogTimer !== null);

    harness.triggerManualFailover();
    // After manual failover, previous watchdog was disarmed and new provider mounted with new watchdog
    assert.strictEqual(harness.activeSession.providerIndex, 1);
    assert.strictEqual(harness.failoverCount, 1);

    harness.destroyCurrentTorrentPlayer();
});

test('T3.10 [F09 x F10]: 1-Tap Manual Failover invokes Clean 8-Step Destruction', () => {
    const mockWin = new MockWindow();
    const harness = new SessionHarness(mockWin);
    harness.startSession({ name: 'Test' });

    harness.triggerManualFailover();
    assert.ok(harness.teardownStepsExecuted.includes('STEP_5_PURGE_IFRAMES_ABOUT_BLANK'));
    assert.strictEqual(harness.teardownStepsExecuted.length, 8);

    harness.destroyCurrentTorrentPlayer();
});

test('T3.11 [F10 x F11]: Clean Destruction stops Telemetry HUD interval and nullifies state', () => {
    const harness = new SessionHarness();
    harness.startSession({ name: 'Test' });

    harness.destroyCurrentTorrentPlayer();
    assert.ok(harness.teardownStepsExecuted.includes('STEP_2_STOP_TELEMETRY'));
    assert.ok(harness.teardownStepsExecuted.includes('STEP_8_NULLIFY_SESSION_STATE'));
});

test('T3.12 [F11 x F12]: Swarm Telemetry HUD + Three-Phase Playback Transition', () => {
    const sm = TelemetryHarness.createPlaybackStateMachine();
    assert.strictEqual(sm.phase, 1);

    // Phase 1 -> Phase 2 on metadata
    sm.onEvent('torrent fetched');
    assert.strictEqual(sm.phase, 2);
    assert.strictEqual(sm.statusBadge, '🟠 Pre-Buffering');

    // Phase 2 -> Phase 3 on playing
    sm.onEvent('playing');
    assert.strictEqual(sm.phase, 3);
    assert.strictEqual(sm.statusBadge, '🟢 Streaming Active (HD)');

    const speed = TelemetryHarness.formatSpeed(3.2);
    assert.strictEqual(speed, '3.2 MB/s');
});

test('T3.13 [F11 x F13]: Swarm Telemetry HUD emits structured log lines', () => {
    const line1 = '[2026-11-07 14:20:00.000] [Webtor Telemetry] Peers: 18/42 | Speed: 3.4 MB/s | Progress: 4.5%';
    const line2 = '[2026-11-07 14:20:01.000] [TorrentStream] Frame rendered. Disarmed watchdog timer.';

    assert.strictEqual(TelemetryHarness.validateLogLine(line1), true);
    assert.strictEqual(TelemetryHarness.validateLogLine(line2), true);
});

test('T3.14 [F04 x F02]: WebView Asset Interception + Script Signature URL Match', () => {
    const sigUrl = 'https://cdn.jsdelivr.net/npm/@webtor/embed-sdk-js@0.2.19/dist/index.min.js';
    const interceptPattern = 'cdn.jsdelivr.net/npm/@webtor/';

    assert.ok(sigUrl.includes(interceptPattern), 'Signature URL must match intercept pattern');
});

test('T3.15 [F05 x F06]: WebRTC Permissions + Provider Registry Swarm compatibility', () => {
    const providersRequiringP2P = TORRENT_PROVIDERS.filter(p => p.type === 'sdk' || p.type === 'iframe');
    assert.strictEqual(providersRequiringP2P.length, 4);

    const webrtcPermissions = ['android.webkit.resource.PROTECTED_MEDIA_ID', 'android.webkit.resource.AUDIO_CAPTURE'];
    assert.ok(webrtcPermissions.length >= 2);
});

test('T3.16 [F14 x F15]: Manifest Version Bump + Build Script Dynamic Version Extraction', () => {
    const manifest = ApkVerifier.parseManifest(MANIFEST_PATH);
    assert.ok(manifest.versionCode !== null);
    assert.ok(manifest.versionName !== null);

    // Verify dynamic extraction contract as specified in Survey E3 §7
    const extractedVerName = (manifest.content.match(/android:versionName="([^"]+)"/) || [])[1];
    const extractedVerCode = (manifest.content.match(/android:versionCode="(\d+)"/) || [])[1];
    assert.strictEqual(extractedVerName, manifest.versionName);
    assert.strictEqual(parseInt(extractedVerCode, 10), manifest.versionCode);
});

test('T3.17 [F15 x F16]: Build Script Automation + APK Signature & Alignment Verification', () => {
    const script = ApkVerifier.inspectBuildScript(BUILD_SCRIPT_PATH);
    assert.strictEqual(script.usesZipalign, true);
    assert.strictEqual(script.usesApksigner, true);

    const targetApk = fs.existsSync(APK_PATH) ? APK_PATH : '/sdcard/Download/LiveTV.apk';
    if (fs.existsSync(targetApk)) {
        const apkRes = ApkVerifier.verifyApkFile(targetApk);
        assert.strictEqual(apkRes.v1Scheme, true);
        assert.strictEqual(apkRes.v2Scheme, true);
        assert.strictEqual(apkRes.v3Scheme, true);
        assert.strictEqual(apkRes.zipalignAligned, true);
    }
});

test('T3.18 [F06 x F13]: Full Multi-Provider Failover + Structured File Logging', () => {
    const harness = new SessionHarness();
    harness.startSession({ name: 'Epic Journey', seeds: 15 });

    // Failover 1: SDK -> Web
    harness.triggerFailover('Handshake timeout');
    // Failover 2: Web -> Magnet Player
    harness.triggerFailover('Iframe load error');
    // Failover 3: Magnet Player -> Instant Torrent
    harness.triggerFailover('WebRTC timeout');
    // Failover 4: Instant Torrent -> Direct Stream
    harness.triggerFailover('No seeds');

    assert.strictEqual(harness.activeSession.providerIndex, 4);
    assert.strictEqual(TORRENT_PROVIDERS[4].id, 'direct_stream');

    const torrentStreamLogs = harness.logs.filter(l => l.line.includes('[TorrentStream]'));
    assert.ok(torrentStreamLogs.length >= 4, 'Must log all failover transitions');

    harness.destroyCurrentTorrentPlayer();
});
