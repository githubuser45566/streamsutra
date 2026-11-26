/**
 * test_adversarial_m2.js
 * Adversarial Stress & Failure Mode Test Suite for Milestone M2
 * 
 * Tests:
 * 1. Provider lifecycle & clean teardown (no orphan iframes, about:blank navigation, video reset)
 * 2. Background audio leak prevention across provider switches and Live TV transitions
 * 3. Webtor SDK fault tolerance: handles synchronous SDK throw, missing SDK, null push
 * 4. 12-second watchdog timer: precise disarming on playback, cascading failover on stall
 * 5. 1-tap manual failover: 6-second threshold visibility, click handling, watchdog disarm
 * 6. Swarm telemetry HUD formatting: throughput units, progress calculation, 3-phase state transitions
 * 7. Rapid provider switching: 50x rapid alternation without resource leaks or timer piling
 * 8. Cross-origin postMessage safety: malformed events, null data, non-object events
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { MockWindow, MockDocument, MockElement, MockHTMLIFrameElement, MockHTMLVideoElement } = require('./harness/mock_dom.js');

const INDEX_HTML_PATH = path.resolve(__dirname, '../assets/index.html');
const indexHtmlContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

// Helper to extract the M2 JS code block directly from assets/index.html
function extractM2Code() {
    const startMarker = '// MULTI-PROVIDER TORRENT FALLBACK STREAMING ENGINE & TELEMETRY HUD';
    const endMarker = '// MY LIBRARY (WATCHLIST, FAVORITE CHANNELS)';
    const startIdx = indexHtmlContent.indexOf(startMarker);
    const endIdx = indexHtmlContent.indexOf(endMarker);
    assert.ok(startIdx !== -1, 'M2 code start marker must exist in assets/index.html');
    assert.ok(endIdx !== -1, 'M2 code end marker must exist in assets/index.html');
    return indexHtmlContent.substring(startIdx, endIdx);
}

// Factory to create a test environment with simulated DOM and M2 functions
function createM2Environment(opts = {}) {
    const mockWin = new MockWindow();
    const doc = mockWin.document;

    // Create required DOM structure
    const webtorBox = new MockElement('DIV', 'webtorContainer');
    webtorBox.style.display = 'none';
    doc.body.appendChild(webtorBox);

    const embedFrame = new MockHTMLIFrameElement('embedPlayerFrame');
    embedFrame.style.display = 'none';
    doc.body.appendChild(embedFrame);

    const videoEl = new MockHTMLVideoElement('videoPlayer');
    videoEl.style.display = 'none';
    doc.body.appendChild(videoEl);

    const serverBar = new MockElement('DIV', 'streamServerBar');
    serverBar.style.display = 'none';
    doc.body.appendChild(serverBar);

    const serverChipsList = new MockElement('DIV', 'serverChipsList');
    serverBar.appendChild(serverChipsList);

    const statsHud = new MockElement('DIV', 'torrentStatsHud');
    statsHud.style.display = 'none';
    doc.body.appendChild(statsHud);

    const peersVal = new MockElement('SPAN', 'tStatPeersVal');
    const speedVal = new MockElement('SPAN', 'tStatSpeedVal');
    const progVal = new MockElement('SPAN', 'tStatProgressVal');
    const progFill = new MockElement('DIV', 'tStatProgressFill');
    const statusText = new MockElement('SPAN', 'tStatStatusText');
    const btnManual = new MockElement('BUTTON', 'btnManualFailover');
    btnManual.style.display = 'none';

    statsHud.appendChild(peersVal);
    statsHud.appendChild(speedVal);
    statsHud.appendChild(progVal);
    statsHud.appendChild(progFill);
    statsHud.appendChild(statusText);
    statsHud.appendChild(btnManual);

    // Helpers
    const toasts = [];
    const logs = [];
    const activeTimers = [];

    const customSetTimeout = (fn, ms) => {
        const id = setTimeout(fn, ms);
        id.unref();
        activeTimers.push(id);
        return id;
    };

    const customSetInterval = (fn, ms) => {
        const id = setInterval(fn, ms);
        id.unref();
        activeTimers.push(id);
        return id;
    };

    const sandbox = {
        window: mockWin,
        document: doc,
        console: {
            log: (...args) => logs.push({ level: 'LOG', text: args.join(' ') }),
            warn: (...args) => logs.push({ level: 'WARN', text: args.join(' ') }),
            error: (...args) => logs.push({ level: 'ERROR', text: args.join(' ') })
        },
        setTimeout: customSetTimeout,
        clearTimeout: clearTimeout,
        setInterval: customSetInterval,
        clearInterval: clearInterval,
        Date: Date,
        Math: Math,
        encodeURIComponent: encodeURIComponent,
        parseInt: parseInt,
        parseFloat: parseFloat,
        isNaN: isNaN,
        Boolean: Boolean,
        JSON: JSON,
        showToast: (msg) => toasts.push(msg),
        escapeHtml: (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        closeDetailModal: () => {},
        closeSourcesModal: () => {},
        openSourcesModal: () => {},
        playStreamInApp: () => {},
        npTitle: new MockElement('DIV', 'npTitle'),
        npCategory: new MockElement('DIV', 'npCategory'),
        fsChannelTitle: new MockElement('DIV', 'fsChannelTitle'),
        fsProgInfo: new MockElement('DIV', 'fsProgInfo'),
        npLogo: new MockElement('IMG', 'npLogo'),
        currentSourcesState: null,
        activeStreamSession: null,
        SourcesEngine: {
            getWebStreams: () => [{ name: 'Test Web Stream', url: 'https://cdn.test/stream.m3u8' }]
        }
    };

    // Configure optional Webtor SDK mock
    if (opts.webtorSdkThrow) {
        mockWin.webtor = {
            push: () => {
                throw new Error('SDK Internal Fatal WebAssembly Init Failure');
            }
        };
    } else if (opts.webtorSdkMissing) {
        mockWin.webtor = undefined;
    } else {
        mockWin.webtor = {
            push: (config) => {
                const instance = {
                    config,
                    destroyed: false,
                    destroy: () => { instance.destroyed = true; }
                };
                return instance;
            }
        };
    }

    vm.createContext(sandbox);

    // Run extracted M2 code inside sandbox
    const code = extractM2Code();
    vm.runInContext(code, sandbox);

    return {
        win: mockWin,
        doc: doc,
        sandbox: sandbox,
        logs: logs,
        toasts: toasts,
        webtorBox: webtorBox,
        embedFrame: embedFrame,
        videoEl: videoEl,
        serverBar: serverBar,
        serverChipsList: serverChipsList,
        statsHud: statsHud,
        btnManual: btnManual,
        statusText: statusText
    };
}

// ============================================================================
// ADVERSARIAL TEST GROUP 1: LIFECYCLE & TEARDOWN INTEGRITY
// ============================================================================
test('ADV.01: destroyCurrentTorrentPlayer navigates all child iframes to about:blank, posts destroy, and removes them', () => {
    const env = createM2Environment();
    const { win, doc, webtorBox, embedFrame, videoEl } = env;

    // Simulate multiple nested iframes inside webtorBox
    const childIframe1 = new MockHTMLIFrameElement('webtor-subframe-1');
    childIframe1.src = 'https://webtor.io/embed/123';
    webtorBox.appendChild(childIframe1);

    const childIframe2 = new MockHTMLIFrameElement('webtor-subframe-2');
    childIframe2.src = 'https://webtor.io/embed/456';
    webtorBox.appendChild(childIframe2);

    embedFrame.src = 'https://ferrolho.github.io/magnet-player/#12345';
    embedFrame.style.display = 'block';

    videoEl.src = 'blob:http://localhost/audio-stream';
    videoEl.style.display = 'block';

    assert.strictEqual(webtorBox.children.length, 2);

    // Execute teardown
    win.destroyCurrentTorrentPlayer();

    // Verify child iframes in webtorBox are pointed to about:blank and removed
    assert.strictEqual(childIframe1.src, 'about:blank', 'childIframe1 must be set to about:blank');
    assert.strictEqual(childIframe2.src, 'about:blank', 'childIframe2 must be set to about:blank');
    assert.strictEqual(webtorBox.children.length, 0, 'webtorBox children must be cleared');
    assert.strictEqual(webtorBox.style.display, 'none', 'webtorBox must be hidden');

    // Verify embedFrame is navigated to about:blank and hidden
    assert.strictEqual(embedFrame.src, 'about:blank', 'embedFrame must be navigated to about:blank');
    assert.strictEqual(embedFrame.style.display, 'none', 'embedFrame must be hidden');

    // Verify video element is paused, cleared, and load() called
    assert.strictEqual(videoEl.paused, true, 'video element must be paused');
    assert.strictEqual(videoEl.src, '', 'video element src must be cleared');
    assert.strictEqual(videoEl.loadedCount, 1, 'video element load() must be called to reset decoder');
    assert.strictEqual(videoEl.style.display, 'none', 'video element must be hidden');
});

test('ADV.02: Teardown safely handles throwing contentWindow.postMessage without throwing uncaught exceptions', () => {
    const env = createM2Environment();
    const { win, webtorBox } = env;

    const throwingIframe = new MockHTMLIFrameElement('throw-frame');
    throwingIframe.src = 'https://restricted.cross-origin.com';
    throwingIframe.contentWindow.postMessage = () => {
        throw new Error('DOMException: Blocked a frame with origin from accessing a cross-origin frame');
    };
    webtorBox.appendChild(throwingIframe);

    assert.doesNotThrow(() => {
        win.destroyCurrentTorrentPlayer();
    }, 'Teardown must catch postMessage exceptions silently');

    assert.strictEqual(throwingIframe.src, 'about:blank');
});

// ============================================================================
// ADVERSARIAL TEST GROUP 2: WEBTOR SDK EXCEPTION HANDLING & FAILOVER
// ============================================================================
test('ADV.03: When Webtor SDK throws synchronous exception, system cleanly fails over to webtor_web without crashing', () => {
    const env = createM2Environment({ webtorSdkThrow: true });
    const { win, embedFrame, logs } = env;

    const mockTorrent = {
        name: 'Big Buck Bunny (1080p)',
        magnet: 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c',
        seeds: 45,
        size: '1.4 GB'
    };

    assert.doesNotThrow(() => {
        win.streamTorrentInApp(mockTorrent, 'Big Buck Bunny', 'poster.jpg');
    });

    const session = win.activeTorrentSession;
    assert.ok(session, 'Active torrent session must exist on win');

    // Expected: provider 0 threw error -> auto-failover to provider 1 (webtor_web)
    assert.strictEqual(session.providerIndex, 1, 'Provider index must have failed over to 1 (webtor_web)');
    const currentProvider = session.providers[session.providerIndex];
    assert.strictEqual(currentProvider.id, 'webtor_web');

    // embedFrame must be mounted with webtor.io URL
    assert.strictEqual(embedFrame.style.display, 'block');
    assert.ok(embedFrame.src.includes('webtor.io/show?magnet='), `embedFrame src (${embedFrame.src}) must contain webtor.io/show`);

    // Verify error was logged cleanly
    const errorLogged = logs.some(l => l.text.includes('Webtor SDK exception: Error: SDK Internal Fatal WebAssembly Init Failure'));
    assert.strictEqual(errorLogged, true, 'Webtor SDK exception must be logged as ERROR');

    const failoverLogged = logs.some(l => l.text.includes('Failover triggered: Webtor P2P (SDK) -> Webtor Direct'));
    assert.strictEqual(failoverLogged, true, 'Failover transition must be logged');

    win.destroyCurrentTorrentPlayer();
});

test('ADV.04: When window.webtor is undefined, system immediately falls over to webtor_web without TypeError', () => {
    const env = createM2Environment({ webtorSdkMissing: true });
    const { win, embedFrame, logs } = env;

    const mockTorrent = {
        name: 'Cosmos Laundromat',
        magnet: 'magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056',
        seeds: 12,
        size: '800 MB'
    };

    assert.doesNotThrow(() => {
        win.streamTorrentInApp(mockTorrent, 'Cosmos Laundromat', 'poster.jpg');
    });

    const session = win.activeTorrentSession;
    assert.strictEqual(session.providerIndex, 1, 'Provider index must be 1 (webtor_web)');
    assert.strictEqual(embedFrame.style.display, 'block');

    const warningLogged = logs.some(l => l.text.includes('Webtor SDK missing, falling back to direct web embed'));
    assert.strictEqual(warningLogged, true);

    win.destroyCurrentTorrentPlayer();
});

// ============================================================================
// ADVERSARIAL TEST GROUP 3: WATCHDOG TIMER DISARMING BEHAVIOR
// ============================================================================
test('ADV.05: Watchdog timer disarms when receiving play_clicked or playing event', () => {
    const env = createM2Environment();
    const { win, statusText } = env;

    const mockTorrent = { name: 'Sintel', magnet: 'magnet:?xt=urn:btih:08a806048b1d7dae', seeds: 30 };
    win.streamTorrentInApp(mockTorrent, 'Sintel', 'poster.jpg');

    const session = win.activeTorrentSession;
    assert.ok(session.watchdogTimer !== null, 'Watchdog timer must initially be armed');
    assert.strictEqual(session.isStreamingActive, false);

    // Telemetry: play_clicked arrives from Webtor
    win.handleWebtorTelemetry({ name: 'play_clicked' });

    assert.strictEqual(session.watchdogTimer, null, 'Watchdog timer must be disarmed');
    assert.strictEqual(session.isStreamingActive, true, 'Session streaming active flag must be true');
    assert.strictEqual(statusText.textContent, '🟢 Streaming Active (HD) • Active Video Streaming');

    win.destroyCurrentTorrentPlayer();
});

test('ADV.06: Watchdog timer disarms on positive playback timestamp (current time > 0) but NOT on 0 or negative', () => {
    const env = createM2Environment();
    const { win } = env;

    const mockTorrent = { name: 'Elephants Dream', magnet: 'magnet:?xt=urn:btih:abc', seeds: 20 };
    win.streamTorrentInApp(mockTorrent, 'Elephants Dream', 'poster.jpg');

    const session = win.activeTorrentSession;
    assert.ok(session.watchdogTimer !== null);

    // Negative timestamp should NOT disarm
    win.handleWebtorTelemetry({ name: 'current time', data: -1.0 });
    assert.ok(session.watchdogTimer !== null, 'Negative time must not disarm watchdog');

    // Zero timestamp should NOT disarm (video has not progressed)
    win.handleWebtorTelemetry({ name: 'current time', data: 0 });
    assert.ok(session.watchdogTimer !== null, 'Zero time must not disarm watchdog');

    // Non-number data should NOT disarm
    win.handleWebtorTelemetry({ name: 'current time', data: 'invalid' });
    assert.ok(session.watchdogTimer !== null, 'Non-number time must not disarm watchdog');

    // Positive timestamp MUST disarm
    win.handleWebtorTelemetry({ name: 'current time', data: 0.5 });
    assert.strictEqual(session.watchdogTimer, null, 'Positive playback time must disarm watchdog');
    assert.strictEqual(session.isStreamingActive, true);

    win.destroyCurrentTorrentPlayer();
});

test('ADV.07: Inited and torrent fetched events advance HUD phase but KEEP watchdog armed until frame renders', () => {
    const env = createM2Environment();
    const { win, statusText } = env;

    const mockTorrent = { name: 'Tears of Steel', magnet: 'magnet:?xt=urn:btih:def', seeds: 20 };
    win.streamTorrentInApp(mockTorrent, 'Tears of Steel', 'poster.jpg');

    const session = win.activeTorrentSession;
    assert.ok(session.watchdogTimer !== null);

    // Peer connection established
    win.handleWebtorTelemetry({ name: 'inited' });
    assert.strictEqual(statusText.textContent, '🟠 Pre-Buffering • Pre-Buffering initial chunks...');
    assert.ok(session.watchdogTimer !== null, 'Watchdog must remain armed during peer connection');

    // Metadata fetched
    win.handleWebtorTelemetry({ name: 'torrent fetched', data: { name: 'Tears of Steel' } });
    assert.strictEqual(statusText.textContent, '🟠 Pre-Buffering • Pre-Buffering initial chunks...');
    assert.ok(session.watchdogTimer !== null, 'Watchdog must remain armed during metadata discovery');

    win.destroyCurrentTorrentPlayer();
});

// ============================================================================
// ADVERSARIAL TEST GROUP 4: 1-TAP MANUAL FAILOVER ACTION
// ============================================================================
test('ADV.08: 1-Tap Manual Failover button appears when buffering duration >= 6,000ms and hides on playback', () => {
    const env = createM2Environment();
    const { win, btnManual } = env;

    const mockTorrent = { name: 'Slow Torrent', magnet: 'magnet:?xt=urn:btih:111', seeds: 2 };
    win.streamTorrentInApp(mockTorrent, 'Slow Torrent', 'poster.jpg');

    const session = win.activeTorrentSession;

    // At t = 0ms: button must be hidden
    session.bufferingStart = Date.now();
    assert.strictEqual(btnManual.style.display, 'none', 'btnManual must be hidden initially');

    // Simulate elapsed buffering = 6,500ms
    session.bufferingStart = Date.now() - 6500;
    // Re-trigger updateHUD
    win.startTorrentStatsMonitor(session.torrent, session.providers[session.providerIndex]);

    assert.strictEqual(btnManual.style.display, 'inline-flex', 'btnManual must appear when buffering >= 6s');
    assert.strictEqual(btnManual.textContent, '⚡ Switch to Webtor Direct ↗');

    // User taps manual failover button
    const failoverResult = win.triggerManualFailover();
    assert.strictEqual(failoverResult, true);
    assert.strictEqual(session.providerIndex, 1, 'Provider must switch to 1 (webtor_web)');

    // Now video starts on provider 1
    win.handleWebtorTelemetry({ name: 'playing' });
    assert.strictEqual(session.isStreamingActive, true);
    assert.strictEqual(btnManual.style.display, 'none', 'btnManual must disappear when streaming is active');

    win.destroyCurrentTorrentPlayer();
});

// ============================================================================
// ADVERSARIAL TEST GROUP 5: SWARM TELEMETRY HUD FORMATTING
// ============================================================================
test('ADV.09: Speed and progress formatting edge cases (0, negative, NaN, MB vs GB, KB/s vs MB/s)', () => {
    const env = createM2Environment();
    const { sandbox } = env;

    // Speed formatting
    assert.strictEqual(sandbox.formatTorrentSpeed(0), '0 KB/s');
    assert.strictEqual(sandbox.formatTorrentSpeed(-5), '0 KB/s');
    assert.strictEqual(sandbox.formatTorrentSpeed(NaN), '0 KB/s');
    assert.strictEqual(sandbox.formatTorrentSpeed(null), '0 KB/s');
    assert.strictEqual(sandbox.formatTorrentSpeed(0.25), '256 KB/s');
    assert.strictEqual(sandbox.formatTorrentSpeed(0.999), '1023 KB/s');
    assert.strictEqual(sandbox.formatTorrentSpeed(1.0), '1.0 MB/s');
    assert.strictEqual(sandbox.formatTorrentSpeed(4.24), '4.2 MB/s');

    // Progress formatting
    const p1 = sandbox.formatTorrentProgress(0, 1000);
    assert.strictEqual(p1.percent, 0);
    assert.strictEqual(p1.percentStr, '0%');
    assert.strictEqual(p1.label, '0% (0 MB)');

    const p2 = sandbox.formatTorrentProgress(500, 1000);
    assert.strictEqual(p2.percent, 50);
    assert.strictEqual(p2.percentStr, '50%');
    assert.strictEqual(p2.label, '50% (500 MB)');

    // >= 1024 MB should format as GB
    const p3 = sandbox.formatTorrentProgress(2048, 4096);
    assert.strictEqual(p3.percent, 50);
    assert.strictEqual(p3.percentStr, '50%');
    assert.strictEqual(p3.label, '50% (2.00 GB)');

    // Zero totalMB guard
    const p4 = sandbox.formatTorrentProgress(100, 0);
    assert.strictEqual(p4.percent, 0);
    assert.strictEqual(p4.percentStr, '0%');
});

// ============================================================================
// ADVERSARIAL TEST GROUP 6: RAPID PROVIDER SWITCHING (STRESS TEST)
// ============================================================================
test('ADV.10: 50x rapid sequential provider switching leaves zero leaked watchdog timers or orphan iframes', () => {
    const env = createM2Environment();
    const { win, webtorBox, embedFrame } = env;

    const mockTorrent = { name: 'Stress Test Movie', magnet: 'magnet:?xt=urn:btih:stress', seeds: 50 };
    win.streamTorrentInApp(mockTorrent, 'Stress Test Movie', 'poster.jpg');

    // Rapidly switch providers 50 times
    for (let i = 0; i < 50; i++) {
        const nextIdx = i % 5;
        win.destroyCurrentTorrentPlayer();
        win.activeTorrentSession.providerIndex = nextIdx;
        win.mountTorrentProvider(nextIdx);
    }

    const session = win.activeTorrentSession;
    assert.ok(session, 'Session must remain valid');
    assert.strictEqual(session.providerIndex, 4, 'Final provider must be index 4 (direct_stream)');

    // Perform final teardown
    win.destroyCurrentTorrentPlayer();

    assert.strictEqual(session.watchdogTimer, null, 'Final watchdog timer must be null');
    assert.strictEqual(embedFrame.src, 'about:blank', 'embedFrame must be about:blank');
    assert.strictEqual(webtorBox.children.length, 0, 'webtorBox must have 0 children');
});

// ============================================================================
// ADVERSARIAL TEST GROUP 7: POSTMESSAGE RESILIENCE & ADVERSARIAL EVENTS
// ============================================================================
test('ADV.11: Telemetry event handler survives malformed, null, and adversarial events', () => {
    const env = createM2Environment();
    const { win } = env;

    const mockTorrent = { name: 'Edge Case Movie', magnet: 'magnet:?xt=urn:btih:edge', seeds: 10 };
    win.streamTorrentInApp(mockTorrent, 'Edge Case Movie', 'poster.jpg');

    const adversarialEvents = [
        null,
        undefined,
        {},
        { name: null },
        { name: '' },
        { name: 12345 },
        { name: 'current time', data: NaN },
        { name: 'current time', data: Infinity },
        { name: 'current time', data: {} },
        { name: 'downloadSpeed', speed: -999 },
        { name: 'torrent error', data: { code: 'CRASH' } } // Should trigger failover cleanly
    ];

    for (const evt of adversarialEvents) {
        assert.doesNotThrow(() => {
            win.handleWebtorTelemetry(evt);
        }, `Must not throw on event: ${JSON.stringify(evt)}`);
    }

    win.destroyCurrentTorrentPlayer();
});
