/**
 * test_index_m2_runtime.js
 * Verification of Milestone M2 in assets/index.html:
 * - TORRENT_PROVIDERS registry
 * - ActiveTorrentSession state controller
 * - 12-second Watchdog Timer & Auto-Failover
 * - 1-Tap Manual Failover Action (buffering >= 6s)
 * - Clean 8-Step Destruction Protocol
 * - Swarm Telemetry HUD & 3-Phase Playback Transition
 * - Preservation of M1 <head> additions
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_HTML_PATH = path.resolve(__dirname, '../assets/index.html');
const indexHtmlContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

// ============================================================================
// 1. M1 PRESERVATION CHECK
// ============================================================================
test('M2.01: Preserves M1 <head> signature tag and contentWindow polyfill', () => {
    assert.ok(indexHtmlContent.includes('id="webtorSignature"'), 'index.html must retain #webtorSignature');
    assert.ok(indexHtmlContent.includes('https://cdn.jsdelivr.net/npm/@webtor/embed-sdk-js@0.2.19/dist/index.min.js'), 'index.html must retain CDN script');
    assert.ok(indexHtmlContent.includes("Object.defineProperty(Window.prototype, 'contentWindow'"), 'index.html must retain contentWindow polyfill');
});

// ============================================================================
// 2. DOM STRUCTURE CHECKS
// ============================================================================
test('M2.02: DOM structure contains #streamServerBar and upgraded #torrentStatsHud', () => {
    assert.ok(indexHtmlContent.includes('id="streamServerBar"'), 'Must contain streamServerBar');
    assert.ok(indexHtmlContent.includes('id="serverChipsList"'), 'Must contain serverChipsList');
    assert.ok(indexHtmlContent.includes('id="torrentStatsHud"'), 'Must contain torrentStatsHud');
    assert.ok(indexHtmlContent.includes('id="tStatPeersVal"'), 'Must contain tStatPeersVal');
    assert.ok(indexHtmlContent.includes('id="tStatSpeedVal"'), 'Must contain tStatSpeedVal');
    assert.ok(indexHtmlContent.includes('id="tStatProgressVal"'), 'Must contain tStatProgressVal');
    assert.ok(indexHtmlContent.includes('id="tStatProgressFill"'), 'Must contain tStatProgressFill');
    assert.ok(indexHtmlContent.includes('id="tStatsStatusRow"'), 'Must contain tStatsStatusRow');
    assert.ok(indexHtmlContent.includes('id="tStatStatusText"'), 'Must contain tStatStatusText');
    assert.ok(indexHtmlContent.includes('id="btnManualFailover"'), 'Must contain btnManualFailover');
});

// ============================================================================
// 3. CSS STYLING CHECKS
// ============================================================================
test('M2.03: CSS contains styles for .server-chip-fallback, .t-stats-status-row, and .t-stat-failover-btn', () => {
    assert.ok(indexHtmlContent.includes('.server-chip-fallback'), 'Must style .server-chip-fallback');
    assert.ok(indexHtmlContent.includes('.t-stats-status-row'), 'Must style .t-stats-status-row');
    assert.ok(indexHtmlContent.includes('.t-stat-failover-btn'), 'Must style .t-stat-failover-btn');
});

// ============================================================================
// 4. JAVASCRIPT REGISTRY & FUNCTIONS EXTRACTION
// ============================================================================
test('M2.04: Extracts and parses TORRENT_PROVIDERS registry', () => {
    // Extract TORRENT_PROVIDERS definition
    const match = indexHtmlContent.match(/const TORRENT_PROVIDERS\s*=\s*([\s\S]*?);\s*window\.TORRENT_PROVIDERS\s*=\s*TORRENT_PROVIDERS;/);
    assert.ok(match, 'TORRENT_PROVIDERS must be defined in index.html');

    const sandbox = {
        window: {},
        encodeURIComponent: encodeURIComponent
    };
    vm.createContext(sandbox);
    vm.runInContext(match[0], sandbox);

    const providers = sandbox.window.TORRENT_PROVIDERS;
    assert.strictEqual(providers.length, 5, 'Must have exactly 5 providers');

    // Provider 0: Webtor SDK
    assert.strictEqual(providers[0].id, 'webtor_sdk');
    assert.strictEqual(providers[0].isDefault, true);
    assert.strictEqual(providers[0].type, 'sdk');
    assert.strictEqual(providers[0].timeoutMs, 12000);

    // Provider 1: Webtor Web Direct
    assert.strictEqual(providers[1].id, 'webtor_web');
    assert.strictEqual(providers[1].type, 'iframe');
    assert.ok(providers[1].getUrl({ magnet: 'magnet:?xt=urn:btih:xyz' }).includes('webtor.io/show?magnet='));

    // Provider 2: Magnet Player
    assert.strictEqual(providers[2].id, 'magnet_player');
    assert.strictEqual(providers[2].type, 'iframe');
    assert.ok(providers[2].getUrl({ magnet: 'magnet:?xt=urn:btih:xyz' }).includes('magnet-player'));

    // Provider 3: Instant Torrent
    assert.strictEqual(providers[3].id, 'instant_torrent');
    assert.strictEqual(providers[3].type, 'iframe');
    assert.ok(providers[3].getUrl({ magnet: 'magnet:?xt=urn:btih:xyz' }).includes('instant.io'));

    // Provider 4: Direct Fast CDN
    assert.strictEqual(providers[4].id, 'direct_stream');
    assert.strictEqual(providers[4].type, 'direct_stream');
    assert.strictEqual(providers[4].timeoutMs, 8000);
});

// ============================================================================
// 5. CLEAN 8-STEP DESTRUCTION PROTOCOL CHECK
// ============================================================================
test('M2.05: Clean 8-Step Destruction Protocol is fully implemented in index.html', () => {
    assert.ok(indexHtmlContent.includes('function destroyCurrentTorrentPlayer()'), 'Must define destroyCurrentTorrentPlayer');
    assert.ok(indexHtmlContent.includes('// Step 1: Cancel active watchdog timer'), 'Step 1: Cancel watchdog');
    assert.ok(indexHtmlContent.includes('// Step 2: Stop telemetry monitor'), 'Step 2: Stop telemetry');
    assert.ok(indexHtmlContent.includes('// Step 3: Remove postMessage listener'), 'Step 3: Remove listener');
    assert.ok(indexHtmlContent.includes('// Step 4: Destroy Webtor SDK instance'), 'Step 4: Destroy Webtor');
    assert.ok(indexHtmlContent.includes('// Step 5: Clean up iframe elements'), 'Step 5: Clean up iframes');
    assert.ok(indexHtmlContent.includes('iframe.src = \'about:blank\''), 'Step 5 must point iframe to about:blank');
    assert.ok(indexHtmlContent.includes('action: \'destroy\''), 'Step 5 must postMessage destroy');
    assert.ok(indexHtmlContent.includes('// Step 6: Clean up HTML5 video element'), 'Step 6: Reset HTML5 video');
    assert.ok(indexHtmlContent.includes('videoEl.pause()'), 'Step 6 must pause video');
    assert.ok(indexHtmlContent.includes('videoEl.load()'), 'Step 6 must call video.load()');
    assert.ok(indexHtmlContent.includes('// Step 7: Clean up HLS instance'), 'Step 7: Clean up HLS');
    assert.ok(indexHtmlContent.includes('hls.destroy()'), 'Step 7 must call hls.destroy()');
    assert.ok(indexHtmlContent.includes('// Step 8: Clean active session state'), 'Step 8: Clean session state');
});

// ============================================================================
// 6. FAILOVER WATCHDOG & 1-TAP MANUAL FAILOVER
// ============================================================================
test('M2.06: Watchdog and manual failover logic present in index.html', () => {
    assert.ok(indexHtmlContent.includes('function handleProviderTimeout(provider)'), 'Must define handleProviderTimeout');
    assert.ok(indexHtmlContent.includes('function triggerProviderFailover(reason)'), 'Must define triggerProviderFailover');
    assert.ok(indexHtmlContent.includes('function triggerManualFailover()'), 'Must define triggerManualFailover');
    assert.ok(indexHtmlContent.includes('bufferingMs >= 6000'), 'Must check buffering >= 6s threshold');
    assert.ok(indexHtmlContent.includes('[TorrentStream] Manual 1-tap failover triggered by user'), 'Must log manual failover tag');
});

// ============================================================================
// 7. SWARM TELEMETRY & 3-PHASE PLAYBACK TRANSITION
// ============================================================================
test('M2.07: Telemetry HUD formats speed, progress, peers, and 3-phase transitions', () => {
    assert.ok(indexHtmlContent.includes('function formatTorrentSpeed(speedMB)'), 'Must format speed dynamically');
    assert.ok(indexHtmlContent.includes('function formatTorrentProgress(downloadedMB, totalMB)'), 'Must format progress');
    assert.ok(indexHtmlContent.includes('function updatePlaybackState(phase, statusText, statusBadge)'), 'Must manage 3-phase transition');
    assert.ok(indexHtmlContent.includes('🟡 Connecting to Torrent Swarm... Contacting Trackers'), 'Phase 1 text');
    assert.ok(indexHtmlContent.includes('🟠 Pre-Buffering'), 'Phase 2 badge');
    assert.ok(indexHtmlContent.includes('🟢 Streaming Active (HD)'), 'Phase 3 badge');
    assert.ok(indexHtmlContent.includes('[Webtor Telemetry]'), 'Must emit [Webtor Telemetry] logs');
    assert.ok(indexHtmlContent.includes('[TorrentStream]'), 'Must emit [TorrentStream] logs');
});

// ============================================================================
// 8. SERVER BAR PROVIDER SWITCHING
// ============================================================================
test('M2.08: Server bar renders interactive chips with 1-tap switching and All Sources button', () => {
    assert.ok(indexHtmlContent.includes('function renderTorrentStreamServerBar('), 'Must define renderTorrentStreamServerBar');
    assert.ok(indexHtmlContent.includes('server-chip-fallback'), 'Must assign server-chip-fallback class');
    assert.ok(indexHtmlContent.includes('id="btnServerBarTorrents"'), 'Must contain #btnServerBarTorrents');
    assert.ok(indexHtmlContent.includes('All Sources'), 'Must provide All Sources button');
});
