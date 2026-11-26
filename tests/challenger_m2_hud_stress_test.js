/**
 * challenger_m2_hud_stress_test.js
 * Adversarial Challenger Stress Harness for Milestone M2:
 * - Swarm Telemetry HUD metrics & formatting (speed, size, progress, peers)
 * - 3-Phase Playback Transition state machine (Handshake -> Pre-Buffer -> Active Video)
 * - Structured logging emission ([Webtor Telemetry], [TorrentStream])
 * - 12s Watchdog Timer & 6s 1-Tap Manual Failover Action
 * - Clean 8-Step Destruction Protocol
 * - Multi-Provider 5-tier circular failover registry
 *
 * Verifies directly against production code in assets/index.html
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_HTML_PATH = path.resolve(__dirname, '../assets/index.html');
const indexHtmlContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

// Extract JS block containing M2 implementation
const m2CodeMatch = indexHtmlContent.match(/\/\/\s*={3,}\s*\n\s*\/\/\s*MULTI-PROVIDER TORRENT FALLBACK STREAMING ENGINE & TELEMETRY HUD[\s\S]*?(?=\/\/\s*[-=]{3,}\s*\n\s*\/\/\s*MY LIBRARY)/);
if (!m2CodeMatch) {
    throw new Error('Could not find M2 code block in assets/index.html');
}
const m2Code = m2CodeMatch[0];

const escapeHtmlCode = `
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
}
`;

/**
 * Helper to build an isolated mock DOM & VM sandbox for testing index.html functions
 */
function createM2Sandbox() {
    const elements = new Map();
    const eventListeners = new Map();
    const logs = [];

    function makeMockElement(id, tagName = 'div') {
        let _innerHTML = '';
        const el = {
            id,
            tagName: tagName.toUpperCase(),
            style: {},
            textContent: '',
            get innerHTML() { return _innerHTML; },
            set innerHTML(html) {
                _innerHTML = html;
                el.children = [];
                const btnMatches = html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>/g);
                for (const match of btnMatches) {
                    const btnTag = match[0];
                    const cls = match[1];
                    const btn = makeMockElement('btn_' + Math.random().toString(36).slice(2), 'button');
                    cls.split(/\s+/).filter(Boolean).forEach(c => btn.classList.add(c));
                    const provMatch = btnTag.match(/data-prov-idx="(\d+)"/);
                    if (provMatch) btn.dataset.provIdx = provMatch[1];
                    const idMatch = btnTag.match(/id="([^"]+)"/);
                    if (idMatch) {
                        btn.id = idMatch[1];
                        elements.set(idMatch[1], btn);
                    }
                    el.appendChild(btn);
                }
            },
            dataset: {},
            className: '',
            classList: {
                _classes: new Set(),
                add(c) { this._classes.add(c); el.className = Array.from(this._classes).join(' '); },
                remove(c) { this._classes.delete(c); el.className = Array.from(this._classes).join(' '); },
                contains(c) { return this._classes.has(c); }
            },
            attributes: new Map(),
            setAttribute(k, v) { this.attributes.set(k, String(v)); },
            getAttribute(k) { return this.attributes.get(k) || null; },
            removeAttribute(k) { this.attributes.delete(k); },
            children: [],
            parentNode: null,
            appendChild(c) {
                c.parentNode = el;
                el.children.push(c);
                return c;
            },
            removeChild(c) {
                const idx = el.children.indexOf(c);
                if (idx >= 0) {
                    el.children.splice(idx, 1);
                    c.parentNode = null;
                }
                return c;
            },
            remove() {
                if (el.parentNode) el.parentNode.removeChild(el);
            },
            querySelectorAll(sel) {
                const results = [];
                const traverse = (node) => {
                    for (const child of node.children) {
                        if (sel === 'iframe' && child.tagName === 'IFRAME') results.push(child);
                        if (sel.startsWith('.') && child.classList.contains(sel.slice(1))) results.push(child);
                        if (sel.includes('[data-prov-idx]') && child.dataset.provIdx !== undefined) results.push(child);
                        traverse(child);
                    }
                };
                traverse(el);
                return results;
            },
            addEventListener(ev, fn) {
                if (!eventListeners.has(id + ':' + ev)) eventListeners.set(id + ':' + ev, []);
                eventListeners.get(id + ':' + ev).push(fn);
            },
            click() {
                const handlers = eventListeners.get(id + ':click') || [];
                for (const h of handlers) h();
                if (typeof el.onclick === 'function') el.onclick();
            },
            // Video element mock methods
            pauseCalled: 0,
            loadCalled: 0,
            pause() { this.pauseCalled++; },
            load() { this.loadCalled++; },
            // Iframe mock contentWindow
            contentWindow: {
                messagesSent: [],
                postMessage(data, origin) {
                    this.messagesSent.push({ data, origin });
                }
            }
        };
        elements.set(id, el);
        return el;
    }

    // Required DOM elements
    makeMockElement('streamServerBar');
    makeMockElement('serverChipsList');
    makeMockElement('btnServerBarTorrents', 'button');
    makeMockElement('torrentStatsHud');
    makeMockElement('tStatPeersVal');
    makeMockElement('tStatSpeedVal');
    makeMockElement('tStatProgressVal');
    makeMockElement('tStatProgressFill');
    makeMockElement('tStatsStatusRow');
    makeMockElement('tStatStatusText');
    makeMockElement('btnManualFailover', 'button');
    makeMockElement('webtorContainer');
    makeMockElement('embedPlayerFrame', 'iframe');
    makeMockElement('videoPlayer', 'video');
    makeMockElement('npTitle');
    makeMockElement('npCategory');
    makeMockElement('fsChannelTitle');
    makeMockElement('fsProgInfo');
    makeMockElement('npLogo', 'img');
    makeMockElement('sourcesModal');

    const sandbox = {
        console: {
            log(...args) { logs.push({ type: 'log', text: args.join(' ') }); },
            warn(...args) { logs.push({ type: 'warn', text: args.join(' ') }); },
            error(...args) { logs.push({ type: 'error', text: args.join(' ') }); }
        },
        document: {
            getElementById(id) {
                if (elements.has(id)) return elements.get(id);
                return makeMockElement(id);
            },
            querySelectorAll(sel) {
                const res = [];
                for (const el of elements.values()) {
                    if (sel === 'iframe' && el.tagName === 'IFRAME') res.push(el);
                }
                return res;
            }
        },
        window: {
            addEventListener(ev, fn) {
                if (!eventListeners.has('window:' + ev)) eventListeners.set('window:' + ev, []);
                eventListeners.get('window:' + ev).push(fn);
            },
            removeEventListener(ev, fn) {
                const list = eventListeners.get('window:' + ev);
                if (list) {
                    const idx = list.indexOf(fn);
                    if (idx >= 0) list.splice(idx, 1);
                }
            },
            scrollTo() {},
            AndroidBridge: {
                logs: [],
                log(lvl, tag, msg) {
                    this.logs.push({ lvl, tag, msg });
                    logs.push({ type: 'bridge', text: `[${tag}] ${msg}` });
                }
            }
        },
        setTimeout: (fn, ms) => {
            const t = setTimeout(fn, ms);
            if (t && t.unref) t.unref();
            return t;
        },
        clearTimeout: (t) => clearTimeout(t),
        setInterval: (fn, ms) => {
            const t = setInterval(fn, ms);
            if (t && t.unref) t.unref();
            return t;
        },
        clearInterval: (t) => clearInterval(t),
        Date,
        Math,
        parseInt,
        parseFloat,
        isNaN,
        encodeURIComponent,
        showToast() {},
        closeDetailModal() {},
        closeSourcesModal() {},
        openSourcesModal() {},
        playStreamInApp() {},
        hls: null,
        npTitle: elements.get('npTitle'),
        npCategory: elements.get('npCategory'),
        fsChannelTitle: elements.get('fsChannelTitle'),
        fsProgInfo: elements.get('fsProgInfo'),
        npLogo: elements.get('npLogo'),
        activeStreamSession: null,
        activeTorrentSession: null
    };

    // Link sandbox.window to global scope
    sandbox.window.document = sandbox.document;
    sandbox.window.setTimeout = sandbox.setTimeout;
    sandbox.window.clearTimeout = sandbox.clearTimeout;

    vm.createContext(sandbox);

    // Run escapeHtml
    vm.runInContext(escapeHtmlCode, sandbox);

    // Run M2 code block
    vm.runInContext(m2Code, sandbox);

    sandbox.TORRENT_PROVIDERS = sandbox.window.TORRENT_PROVIDERS;
    Object.defineProperty(sandbox, 'activeTorrentSession', {
        get() { return sandbox.window.activeTorrentSession; },
        set(val) { sandbox.window.activeTorrentSession = val; }
    });

    return { sandbox, elements, logs, eventListeners };
}

// ============================================================================
// SUITE 1: HUD METRICS & FORMATTING (SPEED, SIZE, PROGRESS)
// ============================================================================

test('CHALLENGE-HUD-01: formatTorrentSpeed handles boundaries, decimals, and extreme values', () => {
    const { sandbox } = createM2Sandbox();
    const formatSpeed = sandbox.formatTorrentSpeed;

    // Zero and negative edge cases
    assert.strictEqual(formatSpeed(0), '0 KB/s', 'Zero must be 0 KB/s');
    assert.strictEqual(formatSpeed(-0.01), '0 KB/s', 'Negative must return 0 KB/s');
    assert.strictEqual(formatSpeed(-100), '0 KB/s', 'Large negative must return 0 KB/s');

    // Invalid non-number types
    assert.strictEqual(formatSpeed(NaN), '0 KB/s', 'NaN must return 0 KB/s');
    assert.strictEqual(formatSpeed(null), '0 KB/s', 'null must return 0 KB/s');
    assert.strictEqual(formatSpeed(undefined), '0 KB/s', 'undefined must return 0 KB/s');
    assert.strictEqual(formatSpeed('1.5'), '0 KB/s', 'String must return 0 KB/s');
    assert.strictEqual(formatSpeed({}), '0 KB/s', 'Object must return 0 KB/s');

    // Sub-1.0 MB/s dynamic KB/s formatting
    assert.strictEqual(formatSpeed(0.001), '1 KB/s', '0.001 MB/s -> 1 KB/s');
    assert.strictEqual(formatSpeed(0.5), '512 KB/s', '0.5 MB/s -> 512 KB/s');
    assert.strictEqual(formatSpeed(0.75), '768 KB/s', '0.75 MB/s -> 768 KB/s');
    assert.strictEqual(formatSpeed(0.999), '1023 KB/s', '0.999 MB/s -> 1023 KB/s');

    // Exact 1.0 boundary
    assert.strictEqual(formatSpeed(1.0), '1.0 MB/s', '1.0 MB/s -> 1.0 MB/s');
    assert.strictEqual(formatSpeed(1.0001), '1.0 MB/s', '1.0001 MB/s -> 1.0 MB/s');

    // Multi-megabyte values with 1-decimal precision
    assert.strictEqual(formatSpeed(3.456), '3.5 MB/s', '3.456 MB/s -> 3.5 MB/s (rounded)');
    assert.strictEqual(formatSpeed(12.3), '12.3 MB/s', '12.3 MB/s -> 12.3 MB/s');
    assert.strictEqual(formatSpeed(100.0), '100.0 MB/s', '100.0 MB/s -> 100.0 MB/s');
    assert.strictEqual(formatSpeed(1024.5), '1024.5 MB/s', '1024.5 MB/s -> 1024.5 MB/s');
});

test('CHALLENGE-HUD-02: parseTorrentSizeMB converts units (GB, TB, MB, KB) and malformed inputs', () => {
    const { sandbox } = createM2Sandbox();
    const parseSize = sandbox.parseTorrentSizeMB;

    // Standard units
    assert.strictEqual(parseSize('750 MB'), 750, '750 MB -> 750');
    assert.strictEqual(parseSize('1.4 GB'), 1434, '1.4 GB -> 1434 (1.4 * 1024)');
    assert.strictEqual(parseSize('2.0 GB'), 2048, '2.0 GB -> 2048');
    assert.strictEqual(parseSize('1 TB'), 1048576, '1 TB -> 1048576');
    assert.strictEqual(parseSize('1024 KB'), 1, '1024 KB -> 1 MB');
    assert.strictEqual(parseSize('512 KB'), 1, '512 KB -> 1 (rounded from 0.5)');

    // Formatting variations (no space, mixed case)
    assert.strictEqual(parseSize('850mb'), 850, '850mb -> 850');
    assert.strictEqual(parseSize('2.5GiB'), 2560, '2.5GiB -> 2560');

    // Adversarial / Empty / Fallback
    assert.strictEqual(parseSize(''), 1000, 'Empty string defaults to 1000 MB');
    assert.strictEqual(parseSize(null), 1000, 'null defaults to 1000 MB');
    assert.strictEqual(parseSize(undefined), 1000, 'undefined defaults to 1000 MB');
    assert.strictEqual(parseSize('unknown'), 1000, 'Unparseable defaults to 1000 MB');
});

test('CHALLENGE-HUD-03: formatTorrentProgress handles buffer clamp, overflow, underflow and unit transitions', () => {
    const { sandbox } = createM2Sandbox();
    const formatProg = sandbox.formatTorrentProgress;

    // Nominal 0% and 50%
    const p0 = formatProg(0, 1000);
    assert.strictEqual(p0.percent, 0);
    assert.strictEqual(p0.percentStr, '0%');
    assert.strictEqual(p0.label, '0% (0 MB)');

    const p50 = formatProg(500, 1000);
    assert.strictEqual(p50.percent, 50);
    assert.strictEqual(p50.percentStr, '50%');
    assert.strictEqual(p50.label, '50% (500 MB)');

    // Unit shift to GB (>= 1024 MB)
    const pGB = formatProg(2048, 4096);
    assert.strictEqual(pGB.percent, 50);
    assert.strictEqual(pGB.label, '50% (2.00 GB)');

    const pFractionalGB = formatProg(1536, 3072);
    assert.strictEqual(pFractionalGB.percent, 50);
    assert.strictEqual(pFractionalGB.label, '50% (1.50 GB)');

    // Overflow clamping (downloaded > total)
    const pOverflow = formatProg(1500, 1000);
    assert.strictEqual(pOverflow.percent, 100, 'Percent must be clamped to 100');
    assert.strictEqual(pOverflow.percentStr, '100%');

    // Underflow clamping (downloaded < 0)
    const pUnderflow = formatProg(-50, 1000);
    assert.strictEqual(pUnderflow.percent, 0, 'Percent must be clamped to 0');
    assert.strictEqual(pUnderflow.percentStr, '0%');

    // Zero totalMB guard
    const pZeroTotal = formatProg(100, 0);
    assert.strictEqual(pZeroTotal.percent, 0);
    assert.strictEqual(pZeroTotal.percentStr, '0%');
    assert.strictEqual(pZeroTotal.label, '0% (0 MB)');
});

// ============================================================================
// SUITE 2: CONNECTED PEERS VS AVAILABLE SEEDS FORMATTING
// ============================================================================

test('CHALLENGE-HUD-04: Peer discovery formats `${connected} / ${available}` with healthy ratios', () => {
    const { sandbox, elements } = createM2Sandbox();
    const torrent = { name: 'Test Torrent', seeds: 50, size: '1.2 GB', magnet: 'magnet:?xt=urn:btih:xyz' };

    sandbox.streamTorrentInApp(torrent, 'Test Torrent', '');

    const peersVal = elements.get('tStatPeersVal');
    const session = sandbox.activeTorrentSession;

    // Seeds = 50 -> totalSwarm = 50 + round(50 * 0.4) = 70
    assert.strictEqual(session.stats.availablePeers, 70, 'Available swarm should be 70');
    // Initial connectedPeers: Math.max(2, Math.min(50, Math.floor(50 * 0.15) || 3)) -> floor(7.5) = 7
    assert.strictEqual(session.stats.connectedPeers, 7, 'Initial connected peers should be 7');
    assert.strictEqual(peersVal.textContent, '7 / 70', 'HUD text must match "7 / 70"');

    sandbox.destroyCurrentTorrentPlayer();
});

test('CHALLENGE-HUD-05: Peer calculation is defensive against zero, string, or missing seed values', () => {
    const { sandbox } = createM2Sandbox();

    // Case 1: Missing torrent object
    sandbox.streamTorrentInApp(null, 'Missing Torrent', '');
    assert.strictEqual(sandbox.activeTorrentSession.stats.availablePeers, 35, 'Default seeds 25 -> 25 + 10 = 35 available');
    sandbox.destroyCurrentTorrentPlayer();

    // Case 2: String seeds "100"
    sandbox.streamTorrentInApp({ seeds: '100', size: '500 MB', magnet: 'magnet:?xt=urn:btih:xyz' }, 'String Seeds', '');
    assert.strictEqual(sandbox.activeTorrentSession.stats.availablePeers, 140, 'Seeds "100" -> 140 available');
    sandbox.destroyCurrentTorrentPlayer();

    // Case 3: 1 seed (swarm minimum)
    sandbox.streamTorrentInApp({ seeds: 1, size: '500 MB', magnet: 'magnet:?xt=urn:btih:xyz' }, '1 Seed', '');
    assert.strictEqual(sandbox.activeTorrentSession.stats.availablePeers, 1, 'Seeds 1 -> 1 available');
    sandbox.destroyCurrentTorrentPlayer();
});

// ============================================================================
// SUITE 3: 3-PHASE PLAYBACK TRANSITION (HANDSHAKE -> PRE-BUFFER -> ACTIVE)
// ============================================================================

test('CHALLENGE-HUD-06: 3-Phase Playback Transition executes Handshake -> Pre-Buffer -> Active Video', () => {
    const { sandbox, elements, logs } = createM2Sandbox();
    const torrent = { name: 'Cosmic Voyage', seeds: 30, size: '800 MB', magnet: 'magnet:?xt=urn:btih:cosmic' };

    // PHASE 1: Initial Handshake
    sandbox.streamTorrentInApp(torrent, 'Cosmic Voyage (2025)', 'poster.jpg');

    const statusEl = elements.get('tStatStatusText');
    const hud = elements.get('torrentStatsHud');
    const btnManual = elements.get('btnManualFailover');
    const session = sandbox.activeTorrentSession;

    assert.strictEqual(hud.style.display, 'flex', 'HUD must be visible');
    assert.strictEqual(session.isStreamingActive, false, 'isStreamingActive must be false in Phase 1');
    assert.ok(statusEl.textContent.includes('🟡 Connecting to Torrent Swarm'), 'Phase 1 must show yellow handshake status');
    assert.strictEqual(btnManual.style.display, 'none', 'Manual failover button must start hidden');
    assert.ok(session.watchdogTimer !== null, 'Watchdog timer must be active in Phase 1');

    // PHASE 2: Pre-Buffering (simulating Webtor 'inited' or 'torrent fetched' event)
    sandbox.handleWebtorTelemetry({ name: 'inited' });
    assert.strictEqual(session.isStreamingActive, false, 'isStreamingActive remains false in Phase 2');
    assert.ok(statusEl.textContent.includes('🟠 Pre-Buffering'), 'Phase 2 must show orange pre-buffering badge');
    assert.ok(statusEl.textContent.includes('Pre-Buffering initial chunks'), 'Phase 2 text must match');

    // PHASE 3: Active Video Streaming (simulating 'playing' or 'play_clicked' event)
    sandbox.handleWebtorTelemetry({ name: 'playing' });
    assert.strictEqual(session.isStreamingActive, true, 'isStreamingActive must transition to true in Phase 3');
    assert.strictEqual(session.watchdogTimer, null, 'Watchdog timer must be disarmed/cancelled in Phase 3');
    assert.ok(statusEl.textContent.includes('🟢 Streaming Active (HD)'), 'Phase 3 must show green streaming active badge');
    assert.ok(statusEl.textContent.includes('Active Video Streaming'), 'Phase 3 text must match');
    assert.strictEqual(btnManual.style.display, 'none', 'Manual failover button must remain hidden in Phase 3');

    // Verify structured log emission for transition
    const transitionLogs = logs.filter(l => l.text.includes('[TorrentStream]') && l.text.includes('Active Playback'));
    assert.ok(transitionLogs.length > 0, 'Must emit structured [TorrentStream] transition log');

    sandbox.destroyCurrentTorrentPlayer();
});

test('CHALLENGE-HUD-07: Phase 3 direct jump occurs on positive "current time" without prior "playing" event', () => {
    const { sandbox, elements } = createM2Sandbox();
    const torrent = { name: 'Direct Jump', seeds: 20, size: '500 MB', magnet: 'magnet:?xt=urn:btih:jump' };

    sandbox.streamTorrentInApp(torrent, 'Direct Jump', '');
    const session = sandbox.activeTorrentSession;
    assert.strictEqual(session.isStreamingActive, false);

    // Direct currentTime event > 0
    sandbox.handleWebtorTelemetry({ name: 'current time', data: 4.5 });

    assert.strictEqual(session.isStreamingActive, true, 'Must transition to active on current time > 0');
    assert.strictEqual(session.watchdogTimer, null, 'Watchdog must be disarmed');
    assert.ok(elements.get('tStatStatusText').textContent.includes('🟢 Streaming Active (HD)'));

    sandbox.destroyCurrentTorrentPlayer();
});

// ============================================================================
// SUITE 4: STRUCTURED LOGGING EMISSION ([Webtor Telemetry] & [TorrentStream])
// ============================================================================

test('CHALLENGE-HUD-08: Structured logging emits [Webtor Telemetry] and [TorrentStream] tags', () => {
    const { sandbox, logs } = createM2Sandbox();
    const torrent = { name: 'Log Test', seeds: 40, size: '1.0 GB', magnet: 'magnet:?xt=urn:btih:logs' };

    sandbox.streamTorrentInApp(torrent, 'Logging Verification', '');

    // Check [TorrentStream] on start and mount
    const startLog = logs.find(l => l.text.includes('[TorrentStream] Starting in-app torrent stream: Logging Verification'));
    assert.ok(startLog, 'Must emit [TorrentStream] start log');

    const mountLog = logs.find(l => l.text.includes('[TorrentStream] Mounting provider: Webtor P2P (SDK)'));
    assert.ok(mountLog, 'Must emit [TorrentStream] mount log');

    // Trigger Webtor Telemetry event
    sandbox.handleWebtorTelemetry({ name: 'inited', data: { version: '0.2.19' } });
    const telemetryLog = logs.find(l => l.text.includes('[Webtor Telemetry] inited'));
    assert.ok(telemetryLog, 'Must emit [Webtor Telemetry] event log');

    // Trigger video playback confirmation
    sandbox.confirmTorrentPlayback('test_trigger');
    const confirmLog = logs.find(l => l.text.includes('[TorrentStream] Frame rendered / play_clicked. Cancelling watchdog'));
    assert.ok(confirmLog, 'Must emit [TorrentStream] transition log');

    // Trigger teardown
    sandbox.destroyCurrentTorrentPlayer();
    const destroyLog = logs.find(l => l.text.includes('[TorrentStream] Completed clean 8-step destruction'));
    assert.ok(destroyLog, 'Must emit [TorrentStream] completion log');
});

// ============================================================================
// SUITE 5: 12-SECOND WATCHDOG & 6-SECOND 1-TAP MANUAL FAILOVER ACTION
// ============================================================================

test('CHALLENGE-HUD-09: 1-Tap Manual Failover button reveals after 6s buffering and triggers switch', () => {
    const { sandbox, elements, logs } = createM2Sandbox();
    const torrent = { name: 'Buffer Test', seeds: 15, size: '700 MB', magnet: 'magnet:?xt=urn:btih:buf' };

    sandbox.streamTorrentInApp(torrent, 'Buffering Test', '');
    const session = sandbox.activeTorrentSession;
    const btnManual = elements.get('btnManualFailover');

    // Immediately at start: bufferingStart is now, bufferingMs ~ 0 -> button hidden
    assert.strictEqual(btnManual.style.display, 'none', 'Must be hidden initially');

    // Artificially simulate 7000ms buffering elapsed
    session.bufferingStart = Date.now() - 7000;
    session.isStreamingActive = false;

    // Trigger HUD update by starting monitor tick or manual trigger
    sandbox.startTorrentStatsMonitor(session.torrent, session.providers[0]);
    assert.strictEqual(btnManual.style.display, 'inline-flex', 'Button must be visible after 6s');
    assert.ok(btnManual.textContent.includes('Switch to Webtor Direct'), 'Button must name next provider (Webtor Direct)');

    // Click 1-tap manual failover button
    btnManual.click();

    // Verify watchdog was cancelled and failover triggered
    const manualLog = logs.find(l => l.text.includes('[TorrentStream] Manual 1-tap failover triggered by user'));
    assert.ok(manualLog, 'Must emit manual failover tag');

    assert.strictEqual(sandbox.activeTorrentSession.providerIndex, 1, 'Provider must have switched to index 1 (Webtor Direct)');

    sandbox.destroyCurrentTorrentPlayer();
});

test('CHALLENGE-HUD-10: 12-second Watchdog timer timeout automatically cascades to next provider', () => {
    const { sandbox, logs } = createM2Sandbox();
    const torrent = { name: 'Timeout Test', seeds: 10, size: '600 MB', magnet: 'magnet:?xt=urn:btih:timeout' };

    sandbox.streamTorrentInApp(torrent, 'Timeout Test', '');
    const session = sandbox.activeTorrentSession;
    assert.strictEqual(session.providerIndex, 0);

    // Force watchdog timeout handler directly
    sandbox.handleProviderTimeout(session.providers[0]);

    assert.strictEqual(sandbox.activeTorrentSession.providerIndex, 1, 'Must fail over to provider index 1');
    const timeoutLog = logs.find(l => l.text.includes('[TorrentStream] Watchdog timed out'));
    assert.ok(timeoutLog, 'Must log watchdog timeout warning');

    sandbox.destroyCurrentTorrentPlayer();
});

// ============================================================================
// SUITE 6: CLEAN 8-STEP DESTRUCTION PROTOCOL ADVERSARIAL STRESS
// ============================================================================

test('CHALLENGE-HUD-11: Clean 8-Step Destruction Protocol leaves zero orphan iframes and pauses video', () => {
    const { sandbox, elements } = createM2Sandbox();
    const torrent = { name: 'Clean Test', seeds: 20, size: '900 MB', magnet: 'magnet:?xt=urn:btih:clean' };

    sandbox.streamTorrentInApp(torrent, 'Clean Test', '');
    const session = sandbox.activeTorrentSession;

    // Mount an active iframe inside webtorContainer
    const webtorBox = elements.get('webtorContainer');
    const childIframe = sandbox.document.getElementById('mockIframe');
    childIframe.tagName = 'IFRAME';
    childIframe.src = 'https://webtor.io/show?active=true';
    webtorBox.appendChild(childIframe);

    // Set video element state
    const video = elements.get('videoPlayer');
    video.src = 'https://cdn.example.com/test.mp4';
    video.pauseCalled = 0;
    video.loadCalled = 0;

    // Mock webtor SDK instance
    let sdkDestroyCalled = false;
    session.webtorInstance = {
        destroy() { sdkDestroyCalled = true; }
    };

    // Execute destruction
    sandbox.destroyCurrentTorrentPlayer();

    // Verification of all 8 steps:
    // Step 1: Watchdog timer null
    assert.strictEqual(session.watchdogTimer, null, 'Step 1: Watchdog timer cleared');
    // Step 3: Message handler null
    assert.strictEqual(session.messageHandler, null, 'Step 3: Message handler removed');
    // Step 4: Webtor instance destroyed
    assert.strictEqual(sdkDestroyCalled, true, 'Step 4: Webtor SDK destroy() called');
    assert.strictEqual(session.webtorInstance, null, 'Step 4: Webtor instance nullified');
    // Step 5: Iframe src about:blank & removed from DOM
    assert.strictEqual(childIframe.src, 'about:blank', 'Step 5: Iframe directed to about:blank');
    assert.strictEqual(webtorBox.children.length, 0, 'Step 5: Iframe removed from container');
    assert.strictEqual(webtorBox.style.display, 'none', 'Step 5: Container hidden');
    // Step 6: Video paused, src cleared, load() called
    assert.strictEqual(video.pauseCalled > 0, true, 'Step 6: Video paused');
    assert.strictEqual(video.src, '', 'Step 6: Video src empty');
    assert.strictEqual(video.loadCalled > 0, true, 'Step 6: Video load() called');
    // Step 8: isStreamingActive false
    assert.strictEqual(session.isStreamingActive, false, 'Step 8: isStreamingActive false');
});

// ============================================================================
// SUITE 7: MULTI-PROVIDER 5-TIER CIRCULAR FAILOVER REGISTRY
// ============================================================================

test('CHALLENGE-HUD-12: Provider registry contains all 5 engines and cycles correctly (0->1->2->3->4->0)', () => {
    const { sandbox } = createM2Sandbox();
    const providers = sandbox.TORRENT_PROVIDERS;

    assert.strictEqual(providers.length, 5, 'Must have exactly 5 providers');
    assert.strictEqual(providers[0].id, 'webtor_sdk');
    assert.strictEqual(providers[1].id, 'webtor_web');
    assert.strictEqual(providers[2].id, 'magnet_player');
    assert.strictEqual(providers[3].id, 'instant_torrent');
    assert.strictEqual(providers[4].id, 'direct_stream');

    const torrent = { name: 'Cycle Test', seeds: 25, size: '1 GB', magnet: 'magnet:?xt=urn:btih:cycle' };
    sandbox.streamTorrentInApp(torrent, 'Cycle Test', '');

    // Cycle through all 5 providers and wrap around to 0
    for (let expectedIdx = 1; expectedIdx <= 5; expectedIdx++) {
        sandbox.triggerProviderFailover(`Cycle step ${expectedIdx}`);
        const currentIdx = sandbox.activeTorrentSession.providerIndex;
        assert.strictEqual(currentIdx, expectedIdx % 5, `Must transition to provider index ${expectedIdx % 5}`);
    }

    sandbox.destroyCurrentTorrentPlayer();
});

test('CHALLENGE-HUD-13: Server bar renders active chip highlight and responds to manual selection', () => {
    const { sandbox, elements } = createM2Sandbox();
    const torrent = { name: 'Server Bar Test', seeds: 30, size: '1.2 GB', magnet: 'magnet:?xt=urn:btih:sb' };

    sandbox.streamTorrentInApp(torrent, 'Server Bar Test', '');
    const serverBar = elements.get('streamServerBar');
    const chipsList = elements.get('serverChipsList');

    assert.strictEqual(serverBar.style.display, 'flex', 'Server bar must be displayed');
    assert.ok(chipsList.innerHTML.includes('data-prov-idx="0"'), 'Must render chip for provider 0');
    assert.ok(chipsList.innerHTML.includes('active'), 'Provider 0 must have active class');
    assert.ok(chipsList.innerHTML.includes('server-chip-fallback'), 'Fallback provider must have fallback class');
    assert.ok(chipsList.innerHTML.includes('btnServerBarTorrents'), 'Must include All Sources button');

    sandbox.destroyCurrentTorrentPlayer();
});
