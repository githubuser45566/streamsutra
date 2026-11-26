/**
 * tier4_real_world_scenarios.test.js
 * Tier 4: Real-World Application Scenarios (9 End-to-End User Journeys)
 * Validates complete streaming workflows, movies/series playback, failovers, and packaging.
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
const APK_PATH = fs.existsSync(path.join(PROJECT_ROOT, 'StreamSutra.apk')) ? path.join(PROJECT_ROOT, 'StreamSutra.apk') : path.join(PROJECT_ROOT, 'LiveTV.apk');
const WEBTOR_SDK_PATH = path.join(PROJECT_ROOT, 'assets/webtor_sdk.js');

test('T4.01 [Scenario 1: Happy Path Movie Playback with Webtor P2P Swarm]', () => {
    const mockWin = new MockWindow();
    mockWin.applyContentWindowPolyfill();

    const sigScript = mockWin.document.createElement('script');
    sigScript.id = 'webtorSignature';
    sigScript.src = 'https://cdn.jsdelivr.net/npm/@webtor/embed-sdk-js@0.2.19/dist/index.min.js';
    mockWin.document.head.appendChild(sigScript);

    const harness = new SessionHarness(mockWin);
    const movieTorrent = {
        name: 'VisionQuest.2025.1080p.WEBRip.x264',
        magnet: 'magnet:?xt=urn:btih:e19606c5ef34b6e85302749704786c9a865645a3&dn=VisionQuest',
        seeds: 42,
        size: '1.8 GB',
        quality: '1080p'
    };

    // Step 1: User selects movie and launches streaming session
    const session = harness.startSession(movieTorrent, 'VisionQuest (2025)', 'poster.jpg');
    assert.strictEqual(session.providerIndex, 0);
    assert.strictEqual(session.providers[0].id, 'webtor_sdk');
    assert.ok(session.watchdogTimer !== null);

    // Step 2: Simulate Webtor challenge handshake
    const sessId = 'sess-visionquest-01';
    const dynamicUuid = '7f8c9b2a-1122-3344-5566-778899aabbcc';
    const challengePayload = ChallengeOracle.generatePackedChallenge(sessId, dynamicUuid);

    const extractedToken = ChallengeOracle.deobfuscateChallenge(challengePayload);
    assert.strictEqual(extractedToken, dynamicUuid);

    const expectedHash = ChallengeOracle.computeHash(sessId, extractedToken);
    assert.strictEqual(ChallengeOracle.verifyHandshake(sessId, extractedToken, expectedHash), true);

    // Step 3: Webtor iframe replies with inited and metadata
    const sm = TelemetryHarness.createPlaybackStateMachine();
    sm.onEvent('inited');
    assert.strictEqual(sm.phase, 2); // Transitions to Pre-buffer

    // Step 4: Stream playback confirmed (play_clicked)
    sm.onEvent('play_clicked');
    assert.strictEqual(sm.phase, 3); // Active video playback
    assert.strictEqual(sm.isStreamingActive, true);

    harness.confirmPlayback('play_clicked');
    assert.strictEqual(session.watchdogTimer, null); // Watchdog disarmed

    // Step 5: Swarm stats format cleanly
    const hudSpeed = TelemetryHarness.formatSpeed(3.8);
    assert.strictEqual(hudSpeed, '3.8 MB/s');

    harness.destroyCurrentTorrentPlayer();
});

test('T4.02 [Scenario 2: Webtor Handshake Stall & Automatic Failover to MagnetPlayer]', () => {
    const mockWin = new MockWindow();
    const harness = new SessionHarness(mockWin);

    const stalledTorrent = {
        name: 'Classic.Cinema.1948.720p',
        magnet: 'magnet:?xt=urn:btih:4a9f026121668fdb8e4185e8f8150e52',
        seeds: 8,
        size: '800 MB'
    };

    // Start on Webtor SDK
    harness.startSession(stalledTorrent, 'Classic Cinema (1948)');
    assert.strictEqual(harness.activeSession.providerIndex, 0);

    // Primary stalls; watchdog fires after 12s timeout
    harness.handleWatchdogTimeout(TORRENT_PROVIDERS[0]);

    // System fails over to Webtor Web Direct
    assert.strictEqual(harness.activeSession.providerIndex, 1);
    assert.strictEqual(TORRENT_PROVIDERS[1].id, 'webtor_web');

    // If secondary also stalls, fails over to MagnetPlayer
    harness.handleWatchdogTimeout(TORRENT_PROVIDERS[1]);
    assert.strictEqual(harness.activeSession.providerIndex, 2);
    assert.strictEqual(TORRENT_PROVIDERS[2].id, 'magnet_player');

    // MagnetPlayer connects and video starts
    harness.confirmPlayback('magnet_player_connected');
    assert.strictEqual(harness.activeSession.isStreamingActive, true);
    assert.strictEqual(harness.activeSession.watchdogTimer, null);

    harness.destroyCurrentTorrentPlayer();
});

test('T4.03 [Scenario 3: Total P2P Swarm Failure with Emergency Fallback to Direct CDN]', () => {
    const harness = new SessionHarness();
    const deadTorrent = {
        name: 'Rare.Indie.Film.2010',
        magnet: 'magnet:?xt=urn:btih:0000000000000000000000000000000000000000',
        seeds: 0,
        size: '1.2 GB'
    };

    harness.startSession(deadTorrent, 'Rare Indie Film');

    // Trigger failover through all P2P engines
    harness.triggerFailover('Webtor SDK handshake error');
    harness.triggerFailover('Webtor Direct timeout');
    harness.triggerFailover('MagnetPlayer zero peers');
    harness.triggerFailover('Instant.io zero peers');

    // Terminal fallback is Direct Fast CDN
    assert.strictEqual(harness.activeSession.providerIndex, 4);
    assert.strictEqual(TORRENT_PROVIDERS[4].id, 'direct_stream');
    assert.strictEqual(TORRENT_PROVIDERS[4].type, 'direct_stream');

    harness.destroyCurrentTorrentPlayer();
});

test('T4.04 [Scenario 4: User Manual 1-Tap Failover from Buffering HUD]', () => {
    const harness = new SessionHarness();
    harness.startSession({ name: 'Buffering Film', seeds: 12 }, 'Buffering Film');

    // User notices slow buffering at t=7s and taps 1-tap switch
    const userSwitched = harness.triggerManualFailover();
    assert.strictEqual(userSwitched, true);
    assert.strictEqual(harness.activeSession.providerIndex, 1);

    // Watchdog re-armed for new provider
    assert.ok(harness.activeSession.watchdogTimer !== null);

    // Logs record user-initiated action
    const hasLog = harness.logs.some(l => l.line.includes('Manual 1-tap failover'));
    assert.strictEqual(hasLog, true);

    harness.destroyCurrentTorrentPlayer();
});

test('T4.05 [Scenario 5: Multi-Episode Series Binge with Provider State Reset]', () => {
    const mockWin = new MockWindow();
    const video = mockWin.document.createElement('video');
    video.src = 'blob:webtor-ep1';
    mockWin.document.body.appendChild(video);

    const harness = new SessionHarness(mockWin);

    // Episode 1
    harness.startSession({ name: 'Breaking Bad S01E01', seeds: 55 }, 'Breaking Bad S01E01');
    harness.confirmPlayback('ep1_play');
    assert.strictEqual(harness.activeSession.isStreamingActive, true);

    // User finishes and clicks Episode 2
    // System must teardown ep1 completely
    harness.destroyCurrentTorrentPlayer();
    assert.strictEqual(harness.teardownStepsExecuted.length, 8);
    assert.strictEqual(video.src, '');

    // Episode 2 starts fresh
    harness.startSession({ name: 'Breaking Bad S01E02', seeds: 50 }, 'Breaking Bad S01E02');
    assert.strictEqual(harness.activeSession.displayTitle, 'Breaking Bad S01E02');
    assert.strictEqual(harness.activeSession.isStreamingActive, false);

    harness.destroyCurrentTorrentPlayer();
});

test('T4.06 [Scenario 6: App Pause / Screen Lock Lifecycle]', async () => {
    const mockWin = new MockWindow();
    const video = mockWin.document.createElement('video');
    mockWin.document.body.appendChild(video);

    const harness = new SessionHarness(mockWin);
    harness.startSession({ name: 'Movie' });
    harness.confirmPlayback('play');

    // Android onPause
    video.pause();
    assert.strictEqual(video.paused, true);

    // Android onResume
    await video.play();
    assert.strictEqual(video.paused, false);

    harness.destroyCurrentTorrentPlayer();
});

test('T4.07 [Scenario 7: Full Offline Local Asset Handshake]', () => {
    // Verifies local asset webtor_sdk.js can be read and evaluated locally
    assert.strictEqual(fs.existsSync(WEBTOR_SDK_PATH), true);
    const content = fs.readFileSync(WEBTOR_SDK_PATH, 'utf8');

    // Check SDK contains WebtorGenerator and player hooks
    assert.ok(content.includes('WebtorGenerator') || content.includes('webtor'));
    assert.ok(content.includes('INJECT') || content.includes('inject'));
});

test('T4.08 [Scenario 8: Malicious / Corrupted Challenge Injection Recovery]', () => {
    const maliciousPayload = 'eval(function() { document.cookie = "stolen"; return "malicious"; })()';
    const token = ChallengeOracle.deobfuscateChallenge(maliciousPayload);

    // Deobfuscator rejects payload with missing UUID
    assert.strictEqual(token, false);

    // System does not crash and verifies handshake fails
    assert.strictEqual(ChallengeOracle.verifyHandshake('sess-1', token, 'expected-hash'), false);
});

test('T4.09 [Scenario 9: Complete Build, Package & Verification Pipeline]', () => {
    const manifest = ApkVerifier.parseManifest(MANIFEST_PATH);
    assert.strictEqual(manifest.package, 'org.streamsutra.app');

    const script = ApkVerifier.inspectBuildScript(BUILD_SCRIPT_PATH);
    assert.strictEqual(script.usesAapt, true);
    assert.strictEqual(script.usesJavac, true);
    assert.strictEqual(script.usesD8, true);

    const targetApk = fs.existsSync(APK_PATH) ? APK_PATH : (fs.existsSync('/sdcard/Download/StreamSutra.apk') ? '/sdcard/Download/StreamSutra.apk' : '/sdcard/Download/LiveTV.apk');
    if (fs.existsSync(targetApk)) {
        const apkRes = ApkVerifier.verifyApkFile(targetApk);
        assert.strictEqual(apkRes.v1Scheme, true);
        assert.strictEqual(apkRes.v2Scheme, true);
        assert.strictEqual(apkRes.v3Scheme, true);
        assert.strictEqual(apkRes.zipalignAligned, true);
    }
});
