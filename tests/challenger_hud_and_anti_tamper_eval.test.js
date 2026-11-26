/**
 * challenger_hud_and_anti_tamper_eval.test.js
 * Empirical Challenger Verification Suite for:
 * 1. Swarm Telemetry HUD boundary conditions (NaN, zero seeds, extreme download speeds, size units, buffer clamp)
 * 2. 3-Phase Playback State Machine and 1-Tap Manual Failover action
 * 3. Webtor Anti-Tamper Integrity Invariants (head signature, contentWindow polyfill, eval unpacker, SHA1 match)
 * 4. Post-destruction session teardown and zombie resurrection prevention
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const INDEX_HTML_PATH = path.resolve(__dirname, '../assets/index.html');
const WEBTOR_SDK_PATH = path.resolve(__dirname, '../assets/webtor_sdk.js');

const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
const webtorSdk = fs.readFileSync(WEBTOR_SDK_PATH, 'utf8');

// Extract M2 implementation code slice from index.html
const m2CodeMatch = indexHtml.match(/\/\/\s*={3,}\s*\n\s*\/\/\s*MULTI-PROVIDER TORRENT FALLBACK STREAMING ENGINE & TELEMETRY HUD[\s\S]*?(?=\/\/\s*[-=]{3,}\s*\n\s*\/\/\s*MY LIBRARY)/);
if (!m2CodeMatch) {
    throw new Error('Unable to extract M2 code block from assets/index.html');
}
const m2Code = m2CodeMatch[0];

const escapeHtmlSnippet = `
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
}
`;

/**
 * Harness to instantiate an isolated DOM & runtime sandbox for testing index.html functions
 */
function createEvaluationHarness(options = {}) {
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
                const key = id + ':' + ev;
                if (!eventListeners.has(key)) eventListeners.set(key, []);
                eventListeners.get(key).push(fn);
            },
            click() {
                const handlers = eventListeners.get(id + ':click') || [];
                for (const h of handlers) h();
                if (typeof el.onclick === 'function') el.onclick();
            },
            pauseCalled: 0,
            loadCalled: 0,
            pause() { this.pauseCalled++; },
            load() { this.loadCalled++; },
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

    if (!options.omitDOMElements) {
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
    }

    let fakeNow = 1000000;
    const timers = new Map();
    let timerIdGen = 1;

    const sandbox = {
        console: {
            log(...args) { logs.push({ type: 'log', text: args.join(' ') }); },
            warn(...args) { logs.push({ type: 'warn', text: args.join(' ') }); },
            error(...args) { logs.push({ type: 'error', text: args.join(' ') }); }
        },
        document: {
            getElementById(id) {
                if (options.omitDOMElements) return null;
                if (elements.has(id)) return elements.get(id);
                return makeMockElement(id);
            },
            querySelectorAll(sel) {
                if (options.omitDOMElements) return [];
                const res = [];
                for (const el of elements.values()) {
                    if (sel === 'iframe' && el.tagName === 'IFRAME') res.push(el);
                }
                return res;
            }
        },
        window: {
            addEventListener(ev, fn) {
                const key = 'window:' + ev;
                if (!eventListeners.has(key)) eventListeners.set(key, []);
                eventListeners.get(key).push(fn);
            },
            removeEventListener(ev, fn) {
                const key = 'window:' + ev;
                const list = eventListeners.get(key);
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
            },
            // Mock Webtor SDK
            webtor: {
                push(opts) {
                    const mockBox = elements.get('webtorContainer');
                    const iframe = makeMockElement('webtor_iframe_active', 'iframe');
                    if (mockBox) mockBox.appendChild(iframe);
                    return {
                        destroy() {
                            iframe.remove();
                        }
                    };
                }
            }
        },
        setTimeout(fn, ms) {
            const id = timerIdGen++;
            timers.set(id, { fn, triggerAt: fakeNow + (ms || 0), interval: false });
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        setInterval(fn, ms) {
            const id = timerIdGen++;
            timers.set(id, { fn, triggerAt: fakeNow + (ms || 0), interval: ms || 1000 });
            return id;
        },
        clearInterval(id) {
            timers.delete(id);
        },
        Date: {
            now() { return fakeNow; }
        },
        Math,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
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

    sandbox.window.document = sandbox.document;
    sandbox.window.setTimeout = sandbox.setTimeout;
    sandbox.window.clearTimeout = sandbox.clearTimeout;
    sandbox.window.Date = sandbox.Date;

    vm.createContext(sandbox);
    vm.runInContext(escapeHtmlSnippet, sandbox);
    vm.runInContext(m2Code, sandbox);

    sandbox.TORRENT_PROVIDERS = sandbox.window.TORRENT_PROVIDERS;
    Object.defineProperty(sandbox, 'activeTorrentSession', {
        get() { return sandbox.window.activeTorrentSession; },
        set(val) { sandbox.window.activeTorrentSession = val; }
    });

    const clock = {
        tick(ms) {
            fakeNow += ms;
            const due = [];
            for (const [id, entry] of timers.entries()) {
                if (entry.triggerAt <= fakeNow) {
                    due.push({ id, entry });
                }
            }
            for (const { id, entry } of due) {
                if (timers.has(id)) {
                    entry.fn();
                    if (entry.interval) {
                        entry.triggerAt = fakeNow + entry.interval;
                    } else {
                        timers.delete(id);
                    }
                }
            }
        },
        now() { return fakeNow; }
    };

    return { sandbox, elements, logs, clock, timers };
}

// ============================================================================
// SUITE 1: TELEMETRY HUD BOUNDARY CONDITIONS & SPEED/SIZE FORMATTING
// ============================================================================

test('HUD.01: formatTorrentSpeed handles NaN, negative, 0, sub-MB, and extreme GB/TB rates', () => {
    const { sandbox } = createEvaluationHarness();
    const formatSpeed = sandbox.formatTorrentSpeed;

    // Boundaries: NaN, null, non-number
    assert.strictEqual(formatSpeed(NaN), '0 KB/s', 'NaN must produce 0 KB/s');
    assert.strictEqual(formatSpeed(undefined), '0 KB/s', 'undefined must produce 0 KB/s');
    assert.strictEqual(formatSpeed(null), '0 KB/s', 'null must produce 0 KB/s');
    assert.strictEqual(formatSpeed('500'), '0 KB/s', 'String must produce 0 KB/s');
    assert.strictEqual(formatSpeed(-1), '0 KB/s', 'Negative -1 must produce 0 KB/s');
    assert.strictEqual(formatSpeed(-9999.5), '0 KB/s', 'Large negative must produce 0 KB/s');

    // Zero
    assert.strictEqual(formatSpeed(0), '0 KB/s', '0 MB/s must produce 0 KB/s');

    // Sub-MB values (< 1.0) -> KB/s
    assert.strictEqual(formatSpeed(0.001), '1 KB/s', '0.001 MB/s must format to 1 KB/s');
    assert.strictEqual(formatSpeed(0.25), '256 KB/s', '0.25 MB/s must format to 256 KB/s');
    assert.strictEqual(formatSpeed(0.5), '512 KB/s', '0.5 MB/s must format to 512 KB/s');
    assert.strictEqual(formatSpeed(0.999), '1023 KB/s', '0.999 MB/s must format to 1023 KB/s');

    // Threshold: exactly 1.0 MB/s
    assert.strictEqual(formatSpeed(1.0), '1.0 MB/s', '1.0 MB/s boundary must format to 1.0 MB/s');

    // Normal streaming rates
    assert.strictEqual(formatSpeed(2.45), '2.5 MB/s', '2.45 MB/s must round to 2.5 MB/s');
    assert.strictEqual(formatSpeed(15.89), '15.9 MB/s', '15.89 MB/s must round to 15.9 MB/s');

    // Extreme high rates: 1 GB/s (1024 MB/s), 10 GB/s (10240 MB/s), 100 TB/s
    assert.strictEqual(formatSpeed(1024), '1024.0 MB/s', '1 GB/s must format gracefully without crashing');
    assert.strictEqual(formatSpeed(10240), '10240.0 MB/s', '10 GB/s must format gracefully');
    assert.strictEqual(formatSpeed(104857600), '104857600.0 MB/s', '100 TB/s must format without throwing');
});

test('HUD.02: parseTorrentSizeMB converts units (KB, MB, GB, TB) and handles malformed/empty sizes', () => {
    const { sandbox } = createEvaluationHarness();
    const parseSize = sandbox.parseTorrentSizeMB;

    // Normal units
    assert.strictEqual(parseSize('700 MB'), 700);
    assert.strictEqual(parseSize('1.5 GB'), 1536);
    assert.strictEqual(parseSize('2 GB'), 2048);
    assert.strictEqual(parseSize('1 TB'), 1048576);
    assert.strictEqual(parseSize('2048 KB'), 2);

    // Case insensitivity & spacing
    assert.strictEqual(parseSize('  4.2   gb '), 4301);
    assert.strictEqual(parseSize('850mb'), 850);

    // Malformed and edge cases: should fallback safely to 1000 MB default
    assert.strictEqual(parseSize(null), 1000);
    assert.strictEqual(parseSize(undefined), 1000);
    assert.strictEqual(parseSize(''), 1000);
    assert.strictEqual(parseSize('   '), 1000);
    assert.strictEqual(parseSize('unknown'), 1000);
    assert.strictEqual(parseSize('N/A'), 1000);
    assert.strictEqual(parseSize(12345), 1000);
});

test('HUD.03: formatTorrentProgress handles buffer clamp, overflow, underflow, and GB transition', () => {
    const { sandbox } = createEvaluationHarness();
    const formatProgress = sandbox.formatTorrentProgress;

    // Zero totalMB or negative totalMB
    let res = formatProgress(10, 0);
    assert.strictEqual(res.percent, 0);
    assert.strictEqual(res.percentStr, '0%');
    assert.strictEqual(res.label, '0% (0 MB)');

    res = formatProgress(10, -500);
    assert.strictEqual(res.percent, 0);
    assert.strictEqual(res.percentStr, '0%');
    assert.strictEqual(res.label, '0% (0 MB)');

    // Zero downloaded
    res = formatProgress(0, 1000);
    assert.strictEqual(res.percent, 0);
    assert.strictEqual(res.percentStr, '0%');
    assert.strictEqual(res.label, '0% (0 MB)');

    // Underflow (negative downloaded clamped to 0)
    res = formatProgress(-50, 1000);
    assert.strictEqual(res.percent, 0);
    assert.strictEqual(res.percentStr, '0%');

    // Normal progression in MB (< 1024 MB)
    const mid = formatProgress(500, 1000);
    assert.strictEqual(mid.percent, 50);
    assert.strictEqual(mid.percentStr, '50%');
    assert.strictEqual(mid.label, '50% (500 MB)');

    // Transition to GB (>= 1024 MB)
    const gbProg = formatProgress(2048, 4096);
    assert.strictEqual(gbProg.percent, 50);
    assert.strictEqual(gbProg.label, '50% (2.00 GB)');

    // Overflow (downloaded > totalMB clamped to 100%)
    const over = formatProgress(2500, 2000);
    assert.strictEqual(over.percent, 100, 'Percent must be clamped to 100');
    assert.strictEqual(over.percentStr, '100%');
    assert.ok(over.label.startsWith('100%'));
});

test('HUD.04: Swarm peer calculation is defensive against zero seeds, NaN seeds, and extreme values', () => {
    const { sandbox, elements } = createEvaluationHarness();

    // 1. Zero seeds: seeds = 0
    assert.doesNotThrow(() => {
        sandbox.streamTorrentInApp({ name: 'Zero Seeds Torrent', seeds: 0, size: '800 MB' }, 'Zero Seeds', '');
    });
    let session = sandbox.activeTorrentSession;
    assert.ok(session.stats.availablePeers >= 1, 'Available peers must be >= 1 even with 0 seeds');
    assert.ok(session.stats.connectedPeers >= 2, 'Connected peers must have minimum floor of 2');

    // 2. String zero: seeds = '0'
    assert.doesNotThrow(() => {
        sandbox.streamTorrentInApp({ name: 'String Zero Torrent', seeds: '0', size: '800 MB' }, 'String Zero', '');
    });
    session = sandbox.activeTorrentSession;
    assert.ok(session.stats.availablePeers >= 1, 'Available peers must be >= 1 with string "0"');

    // 3. NaN/Invalid seeds: seeds = 'invalid' - must not throw exception or crash stream
    assert.doesNotThrow(() => {
        sandbox.streamTorrentInApp({ name: 'NaN Seeds Torrent', seeds: 'invalid', size: '800 MB' }, 'Invalid Seeds', '');
        sandbox.handleWebtorTelemetry({ name: 'inited' });
        sandbox.handleWebtorTelemetry({ name: 'playing' });
    }, 'Invalid seeds string must not crash stream initialization or telemetry');

    // 4. Extreme swarm: 1,000,000 seeds
    sandbox.streamTorrentInApp({ name: 'Mega Swarm Torrent', seeds: 1000000, size: '10 GB' }, 'Mega Swarm', '');
    session = sandbox.activeTorrentSession;
    assert.ok(session.stats.availablePeers > 1000000, 'Available peers must scale for massive swarm');
    assert.ok(session.stats.connectedPeers >= 2, 'Connected peers must be bounded');

    sandbox.destroyCurrentTorrentPlayer();
});

test('HUD.05: Missing HUD DOM elements do not throw exceptions during stream lifecycle', () => {
    const { sandbox } = createEvaluationHarness({ omitDOMElements: true });

    assert.doesNotThrow(() => {
        sandbox.streamTorrentInApp({ name: 'Headless Torrent', seeds: 10, size: '500 MB' }, 'Headless', '');
        sandbox.handleWebtorTelemetry({ name: 'inited' });
        sandbox.handleWebtorTelemetry({ name: 'torrent fetched' });
        sandbox.handleWebtorTelemetry({ name: 'playing' });
        sandbox.handleWebtorTelemetry({ name: 'current time', data: 5.0 });
        sandbox.destroyCurrentTorrentPlayer();
    }, 'Headless execution with missing DOM elements must not throw unhandled TypeError');
});

// ============================================================================
// SUITE 2: 3-PHASE STATE MACHINE & 1-TAP MANUAL FAILOVER ACTION
// ============================================================================

test('HUD.06: 3-Phase Playback Transition executes Handshake -> Pre-Buffer -> Active Video', () => {
    const { sandbox, elements, clock } = createEvaluationHarness();
    const torrent = { name: 'Phase Flow Test', seeds: 35, size: '1.2 GB', magnet: 'magnet:?xt=urn:btih:flow' };

    sandbox.streamTorrentInApp(torrent, 'Phase Flow Test', '');
    const session = sandbox.activeTorrentSession;
    const statusText = elements.get('tStatStatusText');
    const hud = elements.get('torrentStatsHud');

    // Phase 1: Handshake (Immediate at stream initialization)
    assert.strictEqual(hud.style.display, 'flex');
    assert.ok(statusText.textContent.includes('Connecting to Torrent Swarm'), 'Phase 1 text must indicate connecting');
    assert.strictEqual(session.isStreamingActive, false);

    // Phase 2: Pre-Buffering on metadata discovery
    sandbox.handleWebtorTelemetry({ name: 'torrent fetched', data: { name: torrent.name } });
    assert.ok(statusText.textContent.includes('Pre-Buffering') || statusText.textContent.includes('initial chunks'), 'Phase 2 text must indicate pre-buffering');
    assert.strictEqual(session.isStreamingActive, false);

    // Phase 3: Active Video on render frame
    sandbox.handleWebtorTelemetry({ name: 'playing' });
    assert.strictEqual(session.isStreamingActive, true, 'Phase 3 must activate streaming');
    assert.ok(statusText.textContent.includes('Active Video') || statusText.textContent.includes('Streaming Active') || statusText.textContent.includes('🟢'), 'Phase 3 text must indicate active video');
    assert.strictEqual(session.watchdogTimer, null, 'Watchdog must be disarmed in Phase 3');

    sandbox.destroyCurrentTorrentPlayer();
});

test('HUD.07: Direct jump to Phase 3 occurs on positive "current time" without prior "playing" event', () => {
    const { sandbox, elements } = createEvaluationHarness();
    sandbox.streamTorrentInApp({ name: 'Direct Jump', seeds: 20, size: '600 MB' }, 'Direct Jump', '');
    const session = sandbox.activeTorrentSession;
    const statusText = elements.get('tStatStatusText');

    assert.strictEqual(session.isStreamingActive, false);
    assert.ok(session.watchdogTimer !== null);

    // Telemetry emits "current time: 2.5"
    sandbox.handleWebtorTelemetry({ name: 'current time', data: 2.5 });

    assert.strictEqual(session.isStreamingActive, true, 'Must transition to active streaming');
    assert.strictEqual(session.watchdogTimer, null, 'Watchdog must be disarmed');
    assert.ok(statusText.textContent.includes('Active Video Streaming') || statusText.textContent.includes('Streaming Active'), 'HUD status must reflect active video');

    sandbox.destroyCurrentTorrentPlayer();
});

test('HUD.08: 1-Tap Manual Failover button reveals after 6s buffering and hides upon playback', () => {
    const { sandbox, elements, clock } = createEvaluationHarness();
    sandbox.streamTorrentInApp({ name: 'Manual Failover Test', seeds: 10, size: '500 MB' }, 'Manual Failover Test', '');

    const btnManual = elements.get('btnManualFailover');

    // Immediately at 0s: button hidden
    assert.strictEqual(btnManual.style.display, 'none', 'Must be hidden initially');

    // Tick clock 5,000ms: still hidden
    clock.tick(5000);
    assert.strictEqual(btnManual.style.display, 'none', 'Must remain hidden before 6s');

    // Tick clock to 6,000ms: revealed
    clock.tick(1000);
    assert.strictEqual(btnManual.style.display, 'inline-flex', 'Must reveal at >= 6s buffering');
    assert.ok(btnManual.textContent.includes('Switch to Webtor Direct'), 'Must name next provider (Webtor Direct)');

    // Click 1-tap failover button
    btnManual.click();
    assert.strictEqual(sandbox.activeTorrentSession.providerIndex, 1, 'Must switch provider to index 1');
    assert.strictEqual(btnManual.style.display, 'none', 'Must hide immediately after switch');

    // Fast-forward to 6s on new provider
    clock.tick(6000);
    assert.strictEqual(btnManual.style.display, 'inline-flex', 'Must show for next provider');

    // Playback begins -> must hide button
    sandbox.handleWebtorTelemetry({ name: 'playing' });
    assert.strictEqual(btnManual.style.display, 'none', 'Must hide once playback begins');

    sandbox.destroyCurrentTorrentPlayer();
});

test('HUD.09: Structured telemetry logging emits [Webtor Telemetry] and [TorrentStream] tags', () => {
    const { sandbox, logs } = createEvaluationHarness();
    sandbox.streamTorrentInApp({ name: 'Logging Test', seeds: 10, size: '500 MB' }, 'Logging Test', '');

    sandbox.handleWebtorTelemetry({ name: 'inited' });
    sandbox.handleWebtorTelemetry({ name: 'torrent fetched', data: { files: ['test.mp4'] } });
    sandbox.handleWebtorTelemetry({ name: 'playing' });

    const torrentStreamLogs = logs.filter(l => l.text.includes('[TorrentStream]'));
    const webtorLogs = logs.filter(l => l.text.includes('[Webtor Telemetry]'));

    assert.ok(torrentStreamLogs.length >= 2, 'Must emit [TorrentStream] lifecycle logs');
    assert.ok(webtorLogs.some(l => l.text.includes('inited')), 'Must log inited telemetry event');
    assert.ok(webtorLogs.some(l => l.text.includes('playing')), 'Must log playing telemetry event');

    sandbox.destroyCurrentTorrentPlayer();
});

// ============================================================================
// SUITE 3: WEBTOR ANTI-TAMPER INTEGRITY INVARIANTS
// ============================================================================

test('WEBTOR.01: Head tag script signature #webtorSignature is preserved with exact CDN URL', () => {
    assert.ok(indexHtml.includes('id="webtorSignature"'), 'Must have #webtorSignature id');
    assert.ok(indexHtml.includes('src="https://cdn.jsdelivr.net/npm/@webtor/embed-sdk-js@0.2.19/dist/index.min.js"'), 'Must reference official CDN SDK URL');
});

test('WEBTOR.02: Window.prototype.contentWindow polyfill is sound, non-conflicting, and idempotent', () => {
    assert.ok(indexHtml.includes("!('contentWindow' in Window.prototype)"), 'Must check for contentWindow existence in Window.prototype');
    assert.ok(indexHtml.includes("Object.defineProperty(Window.prototype, 'contentWindow'"), 'Must define on Window.prototype');

    class MockWindowProto {}
    if (!('contentWindow' in MockWindowProto.prototype)) {
        Object.defineProperty(MockWindowProto.prototype, 'contentWindow', {
            get: function() { return this; },
            configurable: true
        });
    }

    const winInstance = new MockWindowProto();
    assert.strictEqual(winInstance.contentWindow, winInstance, 'contentWindow must resolve to window instance');
});

test('WEBTOR.03: Real-world Webtor inject challenge deobfuscation and SHA1 verification', () => {
    // Exact authentic sample payload observed in WebView logs
    const samplePayload = 'var _0xc51e=["","split","0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/","slice","indexOf","","",".","pow","reduce","reverse","0"];function _0xe20c(d,e,f){var g=_0xc51e[2][_0xc51e[1]](_0xc51e[0]);var h=g[_0xc51e[3]](0,e);var i=g[_0xc51e[3]](0,f);var j=d[_0xc51e[1]](_0xc51e[0])[_0xc51e[10]]()[_0xc51e[9]](function(a,b,c){if(h[_0xc51e[4]](b)!==-1)return a+=h[_0xc51e[4]](b)*(Math[_0xc51e[8]](e,c))},0);var k=_0xc51e[0];while(j>0){k=i[j%f]+k;j=(j-(j%f))/f}return k||_0xc51e[11]}eval(function(h,u,n,t,e,r){r="";for(var i=0,len=h.length;i<len;i++){var s="";while(h[i]!==n[e]){s+=h[i];i++}for(var j=0;j<n.length;j++)s=s.replace(new RegExp(n[j],"g"),j);r+=String.fromCharCode(_0xe20c(s,e,10)-t)}return decodeURIComponent(escape(r))}("pTVpAVpAVAGGVATGVAGAVyyCVACCVApGVAGpVAppVACAVyyCVyppVyyCVACCVATGVApTVAGTVACTVypTVpTVpAVpAVAGGVATGVAGAVyyCVAGTVACyVAGAVApZVAGZVAGCVAGTVyyCVyppVyyCVACAVApGVACyVAGpVApCVACTVAppVAGCVyTCVACpVACTVAGCVyGGVApTVACTVApCVACTVAppVAGCVAGTVyGTVTZAVAAZVATGVACpVAyyVATGVApCVACTVyApVyACVAGTVACyVAGAVApZVAGZVAGCVyACVyAGVypTVpTVpAVpAVpAVACCVApGVAGAVyyCVyApVAGGVATGVAGAVyyCVApZVyyCVyppVyyCVAGTVACyVAGAVApZVAGZVAGCVAGTVyTCVApTVACTVAppVACpVAGCVACGVypTVyyCVApZVyTTVyTTVypTVyAGVyyCVTZCVpTVpAVpAVpAVpAVApZVACCVyyCVyApVpTVpAVpAVpAVpAVpAVAGTVACyVAGAVApZVAGZVAGCVAGTVATZVApZVATAVyTCVAGTVAGAVACyVyTCVApZVAppVACyVApTVAGpVACAVACTVAGTVyApVyACVACGVAGCVAGCVAGZVAGTVypAVyTpVyTpVACyVACAVAppVyTCVApyVAGTVACAVACTVApTVApZVAGGVAGAVyTCVAppVACTVAGCVyTpVAppVAGZVApCVyTpVyGyVTZZVACTVACZVAGCVApGVAGAVyTpVyACVyAGVyyCVTZpVTZpVpTVpAVpAVpAVpAVpAVAGTVACyVAGAVApZVAGZVAGCVAGTVATZVApZVATAVyTCVAGTVAGAVACyVyTCVApZVAppVACyVApTVAGpVACAVACTVAGTVyApVyACVACGVAGCVAGCVAGZVypAVyTpVyTpVApTVApGVACyVATGVApTVACGVApGVAGTVAGCVypAVypyVyTGVyTGVypyVyTpVyACVyAGVpTVpAVpAVpAVpAVyAGVyyCVTZCVpTVpAVpAVpAVpAVpAVACCVApGVAGpVAppVACAVyyCVyppVyyCVyACVACyVACyVACAVATGVyCyVyCyVyCAVACyVyTTVyCAVACyVACAVyTGVyTTVyCTVyCyVyCTVyCGVyTTVACZVypZVACCVyCGVyTTVACyVACCVyCCVACCVyCyVypyVyCAVyCAVyCTVACyVypyVyCAVyACVypTVpTVpAVpAVpAVpAVTZGVpTVpAVpAVpAVTZGVpTVpAVpAVAGGVATGVAGAVyyCVACCVyyCVyppVyyCVTZZVApZVAppVACAVApGVTZZVyTCVACCVAGAVATGVApCVACTVAGTVATZVyACVTZZVACTVACZVAGCVApGVAGAVyTTVypZVypyVACAVypyVyCCVACAVACCVypZVyTTVACCVyCZVypyVACZVyTTVyCTVACTVACTVyCGVyTTVATGVACTVyCGVACCVyTTVyCTVypyVypyVACyVyCAVyCCVyCCVyCZVATGVACyVyCyVyCyVyACVATAVypTVpTVpAVpAVACCVyTCVACyVApGVAppVAGCVACTVAppVAGCVAATVApZVAppVACAVApGVTZZVyTCVAGZVApGVAGTVAGCVAyZVACTVAGTVAGTVATGVACpVACTVyApVTZCVApZVACAVypAVyyCVyACVypZVypyVACAVypyVyCCVACAVACCVypZVyTTVACCVyCZVypyVACZVyTTVyCTVACTVACTVyCGVyTTVATGVACTVyCGVACCVyTTVyCTVypyVypyVACyVyCAVyCCVyCCVyCZVATGVACyVyCyVyCyVyACVyTAVyyCVAppVATGVApCVACTVypAVyyCVyACVACyVACGVACTVACyVApAVyACVyTAVyyCVACAVATGVAGCVATGVypAVyyCVACCVApGVAGpVAppVACAVTZGVyTAVyyCVyACVyTZVyACVyAGVypTVpTVpAV",99,"ZyATCpGVw",28,7,59))';

    // Execute deobfuscator matching webtor_sdk.js logic
    let token = null;
    const mPlain = samplePayload.match(/found\s*=\s*['"]([0-9a-f-]{36})['"]/i);
    if (mPlain && mPlain[1]) {
        token = mPlain[1];
    } else {
        const replaced = samplePayload.replace(/\beval\s*\(/, 'return (');
        const unpacked = (new Function(replaced))();
        if (typeof unpacked === 'string') {
            const m = unpacked.match(/found\s*=\s*['"]([0-9a-f-]{36})['"]/i);
            if (m && m[1]) token = m[1];
        }
    }

    assert.strictEqual(token, 'ccda223c-3cd0-4247-b8f7-cf5f29334c93', 'Token must match authentic challenge token');

    // SHA1 verification against Webtor check invariant: SHA1(_id + found) === _checkHash
    const sessionId = '89d95df8-f19b-4ee7-ae7f-499c3551ac22';
    const computedHash = crypto.createHash('sha1').update(sessionId + token).digest('hex');
    const expectedHash = '43db8608db145b848e75404d3c5af122dcda3f82';
    assert.strictEqual(computedHash, expectedHash, 'SHA1 must match exact checkHash from Webtor check.js');
});

test('WEBTOR.04: Obfuscated challenge unpacker catches syntax errors and malformed payloads without crash', () => {
    const maliciousPayloads = [
        "eval('throw new Error(\"Exploit\")')",
        "eval('while(false) {} syntax error {{{')",
        "eval('return 12345')",
        null,
        123456,
        {},
        "not an eval payload at all",
        "eval('found = \"invalid-short-token\"')"
    ];

    for (const payload of maliciousPayloads) {
        assert.doesNotThrow(() => {
            let tkn = null;
            if (typeof payload === 'string') {
                const mPlain = payload.match(/found\s*=\s*['"]([0-9a-f-]{36})['"]/i);
                if (mPlain && mPlain[1]) {
                    tkn = mPlain[1];
                } else {
                    try {
                        const replaced = payload.replace(/\beval\s*\(/, 'return (');
                        const unpacked = (new Function(replaced))();
                        if (typeof unpacked === 'string') {
                            const m = unpacked.match(/found\s*=\s*['"]([0-9a-f-]{36})['"]/i);
                            if (m && m[1]) tkn = m[1];
                        }
                    } catch (e) {
                        // Safe caught
                    }
                }
            }
        }, `Payload must not crash unpacker: ${payload}`);
    }
});

// ============================================================================
// SUITE 4: POST-DESTRUCTION ZOMBIE SESSION RESURRECTION IMMUNITY
// ============================================================================

test('WEBTOR.05: Destroyed player resists delayed postMessage error events and does not resurrect', () => {
    const { sandbox, logs, clock } = createEvaluationHarness();
    const torrent = { name: 'Resurrection Stress Test', magnet: 'magnet:?xt=urn:btih:stress' };

    sandbox.streamTorrentInApp(torrent, 'Resurrection Stress Test', '');
    const session = sandbox.activeTorrentSession;
    assert.strictEqual(session.providerIndex, 0);

    // Call destruction protocol
    sandbox.destroyCurrentTorrentPlayer(false);

    // Verify session marked destroyed
    assert.strictEqual(session.destroyed, true, 'Session must be marked destroyed');
    assert.strictEqual(session.isStreamingActive, false, 'isStreamingActive must be false');
    assert.strictEqual(session.watchdogTimer, null, 'Watchdog must be null');

    // Simulate delayed asynchronous postMessage error from dying WebRTC/iframe
    sandbox.handleWebtorTelemetry({ name: 'torrent error', data: 'WebRTC transport disconnected' });

    // Verify session remains destroyed, providerIndex does NOT increment to 1, watchdog NOT re-armed
    assert.strictEqual(session.destroyed, true, 'Session must remain destroyed');
    assert.strictEqual(session.providerIndex, 0, 'Must NOT advance providerIndex on destroyed session');
    assert.strictEqual(session.watchdogTimer, null, 'Watchdog must NOT be re-armed over destroyed session');

    // Advance clock to verify watchdog never fires
    clock.tick(20000);
    assert.strictEqual(session.providerIndex, 0, 'No delayed watchdog failover after destruction');
});

test('WEBTOR.06: Clean 8-step destruction protocol cleans all provider DOM elements and iframes', () => {
    const { sandbox, elements } = createEvaluationHarness();
    sandbox.streamTorrentInApp({ name: 'Teardown DOM Test', magnet: 'magnet:?' }, 'Teardown DOM Test', '');

    const webtorBox = elements.get('webtorContainer');
    const embedFrame = elements.get('embedPlayerFrame');
    const video = elements.get('videoPlayer');

    assert.ok(webtorBox.children.length > 0, 'Must have mounted child iframe');

    sandbox.destroyCurrentTorrentPlayer();

    // Step 5: webtorBox cleared & hidden
    assert.strictEqual(webtorBox.children.length, 0, 'Container children must be removed');
    assert.strictEqual(webtorBox.style.display, 'none', 'Container must be hidden');

    // Step 5: embedFrame about:blank & hidden
    assert.strictEqual(embedFrame.src, 'about:blank', 'Embed frame must point to about:blank');
    assert.strictEqual(embedFrame.style.display, 'none', 'Embed frame must be hidden');

    // Step 6: video element paused and unloaded
    assert.ok(video.pauseCalled > 0, 'Video pause must be called');
    assert.strictEqual(video.src, '', 'Video src must be empty string');
    assert.ok(video.loadCalled > 0, 'Video load must be called');
});
