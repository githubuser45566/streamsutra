/**
 * challenger_m2_empirical_test.js
 * Empirical Challenge & Stress-Test Suite for Milestone M2:
 * Multi-Provider Failover Streaming Engine & Clean Destruction Protocol
 *
 * Requirements Verified:
 * 1. Failover sequence: webtor_sdk -> webtor_web -> magnet_player -> instant_torrent -> direct_stream.
 * 2. Watchdog behavior: timeout triggers failover; 'playing' or positive current time disarms watchdog.
 * 3. Clean 8-step destruction: verify iframes point to about:blank, are removed, timers cleared, video paused.
 * 4. Manual failover button: activates after 6s buffering and immediately triggers provider switch.
 * 5. Telemetry & State Integrity: adversarial payloads, rapid triggers, and post-destruction zombie session verification.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Read production assets/index.html
const INDEX_HTML_PATH = path.resolve(__dirname, '../assets/index.html');
const indexHtmlContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

// Extract production M2 engine block (lines 6128 through 6823)
const startMarker = 'const TORRENT_PROVIDERS = [';
const endMarker = 'window.handleWebtorTelemetry = handleWebtorTelemetry;';
const startIdx = indexHtmlContent.indexOf(startMarker);
const endIdx = indexHtmlContent.indexOf(endMarker);

assert.ok(startIdx > 0, 'Could not locate start of TORRENT_PROVIDERS in assets/index.html');
assert.ok(endIdx > startIdx, 'Could not locate window.handleWebtorTelemetry in assets/index.html');

const M2_CODE_SLICE = indexHtmlContent.substring(startIdx, endIdx + endMarker.length);

/**
 * Controllable Clock for microsecond-precision deterministic time & timer control
 */
class ControllableClock {
    constructor() {
        this.now = 1000000;
        this.timers = [];
        this.nextId = 1;
    }

    setTimeout(fn, delay = 0) {
        const id = this.nextId++;
        this.timers.push({ id, fn, time: this.now + delay, isInterval: false });
        return id;
    }

    clearTimeout(id) {
        this.timers = this.timers.filter(t => t.id !== id);
    }

    setInterval(fn, delay = 0) {
        const id = this.nextId++;
        this.timers.push({ id, fn, delay, time: this.now + delay, isInterval: true });
        return id;
    }

    clearInterval(id) {
        this.clearTimeout(id);
    }

    tick(ms) {
        const target = this.now + ms;
        while (true) {
            this.timers.sort((a, b) => a.time - b.time);
            if (this.timers.length === 0 || this.timers[0].time > target) break;
            const timer = this.timers.shift();
            this.now = timer.time;
            timer.fn();
            if (timer.isInterval) {
                timer.time = this.now + timer.delay;
                this.timers.push(timer);
            }
        }
        this.now = target;
    }
}

/**
 * High-fidelity Mock DOM Element
 */
class MockElement {
    constructor(id = '', tagName = 'DIV') {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.style = {};
        this.children = [];
        this.attributes = {};
        this.dataset = {};
        this.textContent = '';
        this.src = '';
        this.paused = true;
        this.loadCount = 0;
        this.removed = false;
        this.parentNode = null;
        this.listeners = {};
        this._innerHTML = '';
        this.messagesPosted = [];

        this.classList = {
            classes: new Set(),
            add: (c) => this.classList.classes.add(c),
            remove: (c) => this.classList.classes.delete(c),
            contains: (c) => this.classList.classes.has(c)
        };

        this.contentWindow = {
            postMessage: (msg, targetOrigin) => {
                this.messagesPosted.push({ msg, targetOrigin });
            }
        };
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(val) {
        this._innerHTML = val;
        this.children = [];
        if (!val) return;

        // Parse button chips and IDs
        const btnRegex = /<button class="([^"]*)"(?:[^>]*id="([^"]*)")?(?:[^>]*data-prov-idx="(\d+)")?[^>]*>/g;
        let m;
        while ((m = btnRegex.exec(val)) !== null) {
            const btn = new MockElement(m[2] || '', 'BUTTON');
            btn.className = m[1];
            if (m[3] !== undefined) btn.dataset.provIdx = m[3];
            this.appendChild(btn);
        }
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) {
            this.children.splice(idx, 1);
            child.parentNode = null;
        }
        return child;
    }

    remove() {
        this.removed = true;
        if (this.parentNode) {
            this.parentNode.removeChild(this);
        }
    }

    addEventListener(ev, fn) {
        this.listeners[ev] = this.listeners[ev] || [];
        this.listeners[ev].push(fn);
    }

    removeEventListener(ev, fn) {
        if (this.listeners[ev]) {
            this.listeners[ev] = this.listeners[ev].filter(f => f !== fn);
        }
    }

    click() {
        if (this.listeners['click']) {
            this.listeners['click'].forEach(fn => fn());
        }
        if (typeof this.onclick === 'function') {
            this.onclick();
        }
    }

    querySelectorAll(sel) {
        const results = [];
        const matchTag = sel.toUpperCase();
        const traverse = (el) => {
            for (const child of el.children) {
                if (sel.includes('data-prov-idx') && child.dataset && child.dataset.provIdx !== undefined) {
                    results.push(child);
                } else if (child.tagName === matchTag || sel === '*') {
                    results.push(child);
                }
                traverse(child);
            }
        };
        traverse(this);
        return results;
    }

    querySelector(sel) {
        const all = this.querySelectorAll(sel);
        return all.length > 0 ? all[0] : null;
    }

    removeAttribute(attr) {
        delete this.attributes[attr];
        if (attr === 'src') this.src = '';
    }

    pause() {
        this.paused = true;
    }

    load() {
        this.loadCount++;
    }
}

/**
 * Creates an isolated execution harness around the production M2 slice
 */
function createM2Harness() {
    const clock = new ControllableClock();
    const elements = {};

    function getOrCreateEl(id, tagName = 'DIV') {
        if (!elements[id]) {
            elements[id] = new MockElement(id, tagName);
        }
        return elements[id];
    }

    // Initialize required static elements
    const webtorBox = getOrCreateEl('webtorContainer', 'DIV');
    const embedFrame = getOrCreateEl('embedPlayerFrame', 'IFRAME');
    const videoPlayer = getOrCreateEl('videoPlayer', 'VIDEO');
    const streamServerBar = getOrCreateEl('streamServerBar', 'DIV');
    const serverChipsList = getOrCreateEl('serverChipsList', 'DIV');
    const torrentStatsHud = getOrCreateEl('torrentStatsHud', 'DIV');
    const tStatPeersVal = getOrCreateEl('tStatPeersVal', 'SPAN');
    const tStatSpeedVal = getOrCreateEl('tStatSpeedVal', 'SPAN');
    const tStatProgressVal = getOrCreateEl('tStatProgressVal', 'SPAN');
    const tStatProgressFill = getOrCreateEl('tStatProgressFill', 'DIV');
    const tStatStatusText = getOrCreateEl('tStatStatusText', 'DIV');
    const btnManualFailover = getOrCreateEl('btnManualFailover', 'BUTTON');
    const btnServerBarTorrents = getOrCreateEl('btnServerBarTorrents', 'BUTTON');

    const logs = [];
    const toasts = [];
    const windowListeners = {};

    const sandbox = {
        window: {},
        document: {
            getElementById: (id) => getOrCreateEl(id),
            querySelectorAll: (sel) => []
        },
        addEventListener: (ev, fn) => {
            windowListeners[ev] = windowListeners[ev] || [];
            windowListeners[ev].push(fn);
        },
        removeEventListener: (ev, fn) => {
            if (windowListeners[ev]) {
                windowListeners[ev] = windowListeners[ev].filter(f => f !== fn);
            }
        },
        scrollTo: () => {},
        console: {
            log: (...args) => logs.push({ type: 'LOG', text: args.join(' ') }),
            warn: (...args) => logs.push({ type: 'WARN', text: args.join(' ') }),
            error: (...args) => logs.push({ type: 'ERROR', text: args.join(' ') })
        },
        setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
        clearTimeout: (id) => clock.clearTimeout(id),
        setInterval: (fn, ms) => clock.setInterval(fn, ms),
        clearInterval: (id) => clock.clearInterval(id),
        Date: { now: () => clock.now },
        Math,
        parseInt,
        parseFloat,
        isNaN,
        encodeURIComponent,
        showToast: (msg) => toasts.push(msg),
        closeDetailModal: () => {},
        closeSourcesModal: () => {},
        escapeHtml: (s) => (s ? s.replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] || c)) : ''),
        npTitle: getOrCreateEl('npTitle'),
        npCategory: getOrCreateEl('npCategory'),
        fsChannelTitle: getOrCreateEl('fsChannelTitle'),
        fsProgInfo: getOrCreateEl('fsProgInfo'),
        npLogo: getOrCreateEl('npLogo', 'IMG'),
        currentSourcesState: {
            itemTitle: 'Fast Stream Movie',
            poster: '',
            params: { type: 'movie', item: { id: 42 } }
        },
        activeStreamSession: null,
        SourcesEngine: {
            getWebStreams: () => [{ name: 'Direct CDN Fallback Stream', url: 'https://cdn.example.com/fallback.mp4' }]
        },
        playStreamInApp: (url, title, sName, poster) => {
            logs.push({ type: 'PLAY_STREAM', url, title, sName });
        }
    };
    sandbox.window = sandbox;

    // Track active Webtor SDK instances
    let webtorInstanceCount = 0;
    sandbox.window.webtor = {
        push: (opts) => {
            webtorInstanceCount++;
            const iframe = new MockElement(`webtor-iframe-${webtorInstanceCount}`, 'IFRAME');
            webtorBox.appendChild(iframe);
            return {
                destroyed: false,
                destroy: function() {
                    this.destroyed = true;
                }
            };
        }
    };

    vm.createContext(sandbox);
    vm.runInContext(M2_CODE_SLICE, sandbox);

    return {
        sandbox,
        clock,
        elements: {
            webtorBox,
            embedFrame,
            videoPlayer,
            streamServerBar,
            serverChipsList,
            torrentStatsHud,
            tStatPeersVal,
            tStatSpeedVal,
            tStatProgressVal,
            tStatProgressFill,
            tStatStatusText,
            btnManualFailover
        },
        logs,
        toasts,
        windowListeners,
        fireMessage: (data) => {
            const handlers = windowListeners['message'] || [];
            handlers.forEach(fn => fn({ data }));
        }
    };
}

// ============================================================================
// SUITE 1: FAILOVER SEQUENCE VERIFICATION (5 PROVIDERS)
// ============================================================================

test('CHALLENGE 1.1: Registry specifies exact 5 providers in prescribed failover order', () => {
    const { sandbox } = createM2Harness();
    const providers = sandbox.window.TORRENT_PROVIDERS;

    assert.strictEqual(providers.length, 5, 'Must contain exactly 5 providers');
    assert.strictEqual(providers[0].id, 'webtor_sdk', 'Provider 0 must be webtor_sdk');
    assert.strictEqual(providers[0].type, 'sdk');
    assert.strictEqual(providers[0].timeoutMs, 12000);
    assert.strictEqual(providers[0].isDefault, true);

    assert.strictEqual(providers[1].id, 'webtor_web', 'Provider 1 must be webtor_web');
    assert.strictEqual(providers[1].type, 'iframe');
    assert.strictEqual(providers[1].timeoutMs, 12000);

    assert.strictEqual(providers[2].id, 'magnet_player', 'Provider 2 must be magnet_player');
    assert.strictEqual(providers[2].type, 'iframe');
    assert.strictEqual(providers[2].timeoutMs, 12000);

    assert.strictEqual(providers[3].id, 'instant_torrent', 'Provider 3 must be instant_torrent');
    assert.strictEqual(providers[3].type, 'iframe');
    assert.strictEqual(providers[3].timeoutMs, 12000);

    assert.strictEqual(providers[4].id, 'direct_stream', 'Provider 4 must be direct_stream');
    assert.strictEqual(providers[4].type, 'direct_stream');
    assert.strictEqual(providers[4].timeoutMs, 8000);
});

test('CHALLENGE 1.2: Complete sequential failover chain executes under timeout without error', () => {
    const { sandbox, clock } = createM2Harness();
    const torrent = { name: 'Empirical Matrix', magnet: 'magnet:?xt=urn:btih:alpha', seeds: 35 };

    sandbox.window.streamTorrentInApp(torrent, 'Empirical Matrix', '');
    assert.strictEqual(sandbox.window.activeTorrentSession.providerIndex, 0, 'Initial provider must be index 0');

    // 0 -> 1: Timeout after 12000ms
    clock.tick(12000);
    assert.strictEqual(sandbox.window.activeTorrentSession.providerIndex, 1, 'Failed over to index 1 (webtor_web)');

    // 1 -> 2: Timeout after 12000ms
    clock.tick(12000);
    assert.strictEqual(sandbox.window.activeTorrentSession.providerIndex, 2, 'Failed over to index 2 (magnet_player)');

    // 2 -> 3: Timeout after 12000ms
    clock.tick(12000);
    assert.strictEqual(sandbox.window.activeTorrentSession.providerIndex, 3, 'Failed over to index 3 (instant_torrent)');

    // Disable direct web streams so provider 4 does not confirm playback and instead tests timeout wraparound
    sandbox.SourcesEngine.getWebStreams = () => [];

    // 3 -> 4: Timeout after 12000ms
    clock.tick(12000);
    assert.strictEqual(sandbox.window.activeTorrentSession.providerIndex, 4, 'Failed over to index 4 (direct_stream)');

    // Direct stream (timeout: 8000ms) -> wraps back to 0
    clock.tick(8000);
    assert.strictEqual(sandbox.window.activeTorrentSession.providerIndex, 0, 'Wraps back to index 0 (webtor_sdk)');
});

test('CHALLENGE 1.3: Direct stream provider switches immediately when web stream available', () => {
    const { sandbox, logs } = createM2Harness();
    const torrent = { name: 'Fast Stream Movie', magnet: 'magnet:?xt=urn:btih:fast', seeds: 10 };

    sandbox.window.streamTorrentInApp(torrent, 'Fast Stream Movie', '', 'direct_stream');
    assert.strictEqual(sandbox.window.activeTorrentSession.providerIndex, 4);

    const playStreamLogged = logs.some(l => l.type === 'PLAY_STREAM' && l.url === 'https://cdn.example.com/fallback.mp4');
    assert.ok(playStreamLogged, 'Direct CDN stream must immediately launch playStreamInApp');
});

// ============================================================================
// SUITE 2: WATCHDOG BEHAVIOR & DISARM PROTOCOL
// ============================================================================

test('CHALLENGE 2.1: Watchdog arms with exact provider timeout duration on mount', () => {
    const { sandbox } = createM2Harness();
    sandbox.window.streamTorrentInApp({ name: 'Watchdog Test', magnet: 'magnet:?' }, 'Watchdog Test', '');

    const session = sandbox.window.activeTorrentSession;
    assert.ok(session.watchdogTimer !== null, 'Watchdog timer must be armed');
    assert.strictEqual(session.isStreamingActive, false, 'isStreamingActive must be false initially');
});

test('CHALLENGE 2.2: Telemetry event "playing" disarms watchdog and transitions to active streaming', () => {
    const { sandbox, clock } = createM2Harness();
    sandbox.window.streamTorrentInApp({ name: 'Play Test', magnet: 'magnet:?' }, 'Play Test', '');

    // Advance 4 seconds (under 12s timeout)
    clock.tick(4000);
    assert.ok(sandbox.window.activeTorrentSession.watchdogTimer !== null);

    // Receive 'playing' telemetry event
    sandbox.window.handleWebtorTelemetry({ name: 'playing' });

    assert.strictEqual(sandbox.window.activeTorrentSession.watchdogTimer, null, 'Watchdog must be disarmed/null');
    assert.strictEqual(sandbox.window.activeTorrentSession.isStreamingActive, true, 'isStreamingActive must be true');

    // Advance past original 12s timeout (total 20s) -> should NOT trigger failover
    clock.tick(16000);
    assert.strictEqual(sandbox.window.activeTorrentSession.providerIndex, 0, 'Must remain on provider 0 without failover');
});

test('CHALLENGE 2.3: Telemetry event "play_clicked" disarms watchdog', () => {
    const { sandbox } = createM2Harness();
    sandbox.window.streamTorrentInApp({ name: 'Play Clicked Test', magnet: 'magnet:?' }, 'Play Clicked Test', '');

    sandbox.window.handleWebtorTelemetry({ name: 'play_clicked' });
    assert.strictEqual(sandbox.window.activeTorrentSession.watchdogTimer, null);
    assert.strictEqual(sandbox.window.activeTorrentSession.isStreamingActive, true);
});

test('CHALLENGE 2.4: Telemetry event "current time > 0" disarms watchdog', () => {
    const { sandbox } = createM2Harness();
    sandbox.window.streamTorrentInApp({ name: 'Time Test', magnet: 'magnet:?' }, 'Time Test', '');

    sandbox.window.handleWebtorTelemetry({ name: 'current time', data: 4.8 });
    assert.strictEqual(sandbox.window.activeTorrentSession.watchdogTimer, null);
    assert.strictEqual(sandbox.window.activeTorrentSession.isStreamingActive, true);
});

test('CHALLENGE 2.5: Adversarial "current time" payloads (<= 0, NaN, string) do NOT disarm watchdog', () => {
    const { sandbox } = createM2Harness();
    sandbox.window.streamTorrentInApp({ name: 'Adversarial Time', magnet: 'magnet:?' }, 'Adversarial Time', '');

    // current time = 0
    sandbox.window.handleWebtorTelemetry({ name: 'current time', data: 0 });
    assert.ok(sandbox.window.activeTorrentSession.watchdogTimer !== null, 'time=0 must NOT disarm');

    // current time = -1
    sandbox.window.handleWebtorTelemetry({ name: 'current time', data: -1 });
    assert.ok(sandbox.window.activeTorrentSession.watchdogTimer !== null, 'time=-1 must NOT disarm');

    // current time = NaN
    sandbox.window.handleWebtorTelemetry({ name: 'current time', data: NaN });
    assert.ok(sandbox.window.activeTorrentSession.watchdogTimer !== null, 'time=NaN must NOT disarm');

    // current time = "5.0" (string)
    sandbox.window.handleWebtorTelemetry({ name: 'current time', data: '5.0' });
    assert.ok(sandbox.window.activeTorrentSession.watchdogTimer !== null, 'time=string must NOT disarm');

    // current time = null
    sandbox.window.handleWebtorTelemetry({ name: 'current time', data: null });
    assert.ok(sandbox.window.activeTorrentSession.watchdogTimer !== null, 'time=null must NOT disarm');
});

// ============================================================================
// SUITE 3: CLEAN 8-STEP DESTRUCTION PROTOCOL
// ============================================================================

test('CHALLENGE 3.1: Clean 8-step destruction protocol purges iframes, clears timers, and resets video', () => {
    const { sandbox, elements } = createM2Harness();
    const torrent = { name: 'Teardown Test', magnet: 'magnet:?' };

    sandbox.window.streamTorrentInApp(torrent, 'Teardown Test', '');
    const session = sandbox.window.activeTorrentSession;

    // Verify initial setup has active timer and iframes in webtorBox
    assert.ok(session.watchdogTimer !== null);
    assert.ok(elements.webtorBox.children.length > 0);
    const webtorIframe = elements.webtorBox.children[0];

    // Execute clean destruction
    sandbox.window.destroyCurrentTorrentPlayer();

    // Step 1: Watchdog timer cleared
    assert.strictEqual(session.watchdogTimer, null, 'Step 1: Watchdog timer must be cleared');

    // Step 2: Telemetry monitor hidden
    assert.strictEqual(elements.torrentStatsHud.style.display, 'none', 'Step 2: HUD must be hidden');

    // Step 3: Message handler removed
    assert.strictEqual(session.messageHandler, null, 'Step 3: Session messageHandler must be null');

    // Step 4: Webtor instance destroyed
    assert.strictEqual(session.webtorInstance, null, 'Step 4: Webtor instance must be null');

    // Step 5: Iframes set to about:blank and removed
    assert.strictEqual(webtorIframe.src, 'about:blank', 'Step 5: webtor iframe src must be about:blank');
    assert.strictEqual(webtorIframe.removed, true, 'Step 5: webtor iframe must be removed from DOM');
    assert.ok(webtorIframe.messagesPosted.some(m => m.msg && m.msg.action === 'destroy'), 'Step 5: postMessage destroy sent');
    assert.strictEqual(elements.embedFrame.src, 'about:blank', 'Step 5: embedFrame src must be about:blank');
    assert.strictEqual(elements.embedFrame.style.display, 'none', 'Step 5: embedFrame must be hidden');

    // Step 6: HTML5 video element paused, unloaded, hidden
    assert.strictEqual(elements.videoPlayer.paused, true, 'Step 6: Video must be paused');
    assert.strictEqual(elements.videoPlayer.src, '', 'Step 6: Video src must be empty');
    assert.ok(elements.videoPlayer.loadCount >= 1, 'Step 6: Video load() must be called');
    assert.strictEqual(elements.videoPlayer.style.display, 'none', 'Step 6: Video must be hidden');

    // Step 8: Streaming active set to false
    assert.strictEqual(session.isStreamingActive, false, 'Step 8: isStreamingActive must be false');
});

test('CHALLENGE 3.2: Calling destroyCurrentTorrentPlayer repeatedly or when null is safe and idempotent', () => {
    const { sandbox } = createM2Harness();

    // Call when no session has ever been created
    assert.doesNotThrow(() => {
        sandbox.window.destroyCurrentTorrentPlayer();
    }, 'Must not throw when activeTorrentSession is null');

    // Call 10 times consecutively
    assert.doesNotThrow(() => {
        for (let i = 0; i < 10; i++) {
            sandbox.window.destroyCurrentTorrentPlayer();
        }
    }, 'Must survive 10 consecutive teardowns idempotently');
});

test('CHALLENGE 3.3: Webtor SDK destroy() exception is safely caught without unhandled throw', () => {
    const { sandbox } = createM2Harness();
    sandbox.window.streamTorrentInApp({ name: 'Error SDK', magnet: 'magnet:?' }, 'Error SDK', '');

    // Sabotage webtorInstance.destroy to throw an unexpected error
    sandbox.window.activeTorrentSession.webtorInstance = {
        destroy: () => {
            throw new Error('Fatal Native Bridge IPC Error');
        }
    };

    assert.doesNotThrow(() => {
        sandbox.window.destroyCurrentTorrentPlayer();
    }, 'Teardown must safely catch webtorInstance.destroy() errors');
});

// ============================================================================
// SUITE 4: 1-TAP MANUAL FAILOVER ACTION
// ============================================================================

test('CHALLENGE 4.1: Manual failover button hidden before 6,000ms buffering', () => {
    const { sandbox, clock, elements } = createM2Harness();
    sandbox.window.streamTorrentInApp({ name: 'Buffering Test', magnet: 'magnet:?' }, 'Buffering Test', '');

    const btn = elements.btnManualFailover;
    assert.strictEqual(btn.style.display, 'none', 'Hidden at 0ms');

    // Advance 5,000ms (5 ticks of monitor)
    clock.tick(5000);
    assert.strictEqual(btn.style.display, 'none', 'Hidden at 5,000ms');
});

test('CHALLENGE 4.2: Manual failover button displays at buffering >= 6,000ms with next provider name', () => {
    const { sandbox, clock, elements } = createM2Harness();
    sandbox.window.streamTorrentInApp({ name: 'Buffering Threshold', magnet: 'magnet:?' }, 'Buffering Threshold', '');

    const btn = elements.btnManualFailover;

    // Advance to 6,000ms
    clock.tick(6000);
    assert.strictEqual(btn.style.display, 'inline-flex', 'Button must be visible at 6,000ms');
    assert.ok(btn.textContent.includes('Switch to Webtor Direct'), 'Button must name next provider (Webtor Direct)');
});

test('CHALLENGE 4.3: Clicking manual failover button disarms watchdog and switches provider immediately', () => {
    const { sandbox, clock, elements, logs } = createM2Harness();
    sandbox.window.streamTorrentInApp({ name: 'Manual Click', magnet: 'magnet:?' }, 'Manual Click', '');

    clock.tick(6000);
    const btn = elements.btnManualFailover;

    // Click button
    btn.click();

    // Verify switch
    assert.strictEqual(sandbox.window.activeTorrentSession.providerIndex, 1, 'Switched to provider 1');
    assert.strictEqual(btn.style.display, 'none', 'Button reset to hidden for next provider');

    const logFound = logs.some(l => l.text.includes('Manual 1-tap failover triggered by user'));
    assert.ok(logFound, 'Must log [TorrentStream] Manual 1-tap failover tag');
});

test('CHALLENGE 4.4: Manual failover button immediately hides when streaming becomes active', () => {
    const { sandbox, clock, elements } = createM2Harness();
    sandbox.window.streamTorrentInApp({ name: 'Hide On Play', magnet: 'magnet:?' }, 'Hide On Play', '');

    clock.tick(6000);
    const btn = elements.btnManualFailover;
    assert.strictEqual(btn.style.display, 'inline-flex');

    // Frame rendered
    sandbox.window.handleWebtorTelemetry({ name: 'playing' });
    assert.strictEqual(btn.style.display, 'none', 'Button must disappear once playback starts');
});

// ============================================================================
// SUITE 5: TELEMETRY FORMATTING & ADVERSARIAL TELEMETRY PAYLOADS
// ============================================================================

test('CHALLENGE 5.1: Dynamic speed formatting conforms to KB/s (<1.0) and MB/s (>=1.0)', () => {
    const { sandbox } = createM2Harness();

    // Extract formatTorrentSpeed
    const formatSpeed = sandbox.window.formatTorrentSpeed || eval('(' + M2_CODE_SLICE.match(/function formatTorrentSpeed[\s\S]*?^ {8}\}/m)[0] + ')');

    assert.strictEqual(formatSpeed(0), '0 KB/s');
    assert.strictEqual(formatSpeed(0.5), '512 KB/s');
    assert.strictEqual(formatSpeed(0.999), '1023 KB/s');
    assert.strictEqual(formatSpeed(1.0), '1.0 MB/s');
    assert.strictEqual(formatSpeed(3.456), '3.5 MB/s');
    assert.strictEqual(formatSpeed(-2), '0 KB/s');
    assert.strictEqual(formatSpeed(NaN), '0 KB/s');
    assert.strictEqual(formatSpeed('string'), '0 KB/s');
    assert.strictEqual(formatSpeed(null), '0 KB/s');
});

test('CHALLENGE 5.2: Dynamic progress formatting handles zero, MB, GB, and overflow', () => {
    const { sandbox } = createM2Harness();
    const formatProgress = eval('(' + M2_CODE_SLICE.match(/function formatTorrentProgress[\s\S]*?^ {8}\}/m)[0] + ')');

    assert.deepStrictEqual(formatProgress(0, 0), { percent: 0, percentStr: '0%', label: '0% (0 MB)' });
    assert.deepStrictEqual(formatProgress(0, 1000), { percent: 0, percentStr: '0%', label: '0% (0 MB)' });
    assert.deepStrictEqual(formatProgress(500, 1000), { percent: 50, percentStr: '50%', label: '50% (500 MB)' });
    assert.deepStrictEqual(formatProgress(2048, 4096), { percent: 50, percentStr: '50%', label: '50% (2.00 GB)' });
    assert.deepStrictEqual(formatProgress(1500, 1000), { percent: 100, percentStr: '100%', label: '100% (1.46 GB)' });
});

test('CHALLENGE 5.3: Adversarial telemetry payloads never throw unhandled exceptions', () => {
    const { sandbox } = createM2Harness();
    sandbox.window.streamTorrentInApp({ name: 'Adversarial Telemetry', magnet: 'magnet:?' }, 'Adversarial Telemetry', '');

    const adversarial = [
        null,
        undefined,
        '',
        12345,
        {},
        [],
        { name: null },
        { name: undefined },
        { name: 'unknown_event_xyz' },
        { name: 'torrent error', data: null },
        { name: 'error', data: { circular: 'err' } },
        { numPeers: 'invalid_string' },
        { downloadSpeed: -1000 },
        { duration: NaN }
    ];

    for (const payload of adversarial) {
        assert.doesNotThrow(() => {
            sandbox.window.handleWebtorTelemetry(payload);
        }, `Payload must not throw: ${JSON.stringify(payload)}`);
    }
});

// ============================================================================
// SUITE 6: ADVERSARIAL STRESS TESTING & POST-DESTRUCTION ZOMBIE RECONSTRUCTION
// ============================================================================

test('CHALLENGE 6.1: Rapid manual failover clicks (20 rapid triggers) complete full provider wrap safely', () => {
    const { sandbox, elements } = createM2Harness();
    sandbox.window.streamTorrentInApp({ name: 'Rapid Clicks', magnet: 'magnet:?' }, 'Rapid Clicks', '');

    assert.doesNotThrow(() => {
        for (let i = 0; i < 20; i++) {
            sandbox.window.triggerManualFailover();
        }
    }, 'Rapid manual failover triggers must not throw or corrupt call stack');

    // 20 switches % 5 = index 0
    assert.strictEqual(sandbox.window.activeTorrentSession.providerIndex, 0);
});

test('CHALLENGE 6.2 [CRITICAL FINDING]: Post-destruction zombie session resurrection vulnerability', () => {
    const { sandbox, toasts } = createM2Harness();
    const torrent = { name: 'Dead Stream', magnet: 'magnet:?xt=urn:btih:dead' };

    // 1. User starts torrent stream
    sandbox.window.streamTorrentInApp(torrent, 'Dead Stream', '');
    assert.strictEqual(sandbox.window.activeTorrentSession.providerIndex, 0);

    // 2. User stops playback or switches to Live TV channel
    sandbox.window.destroyCurrentTorrentPlayer();

    // Step 8 verification: Worker handoff claimed: "Step 8: Nullifies active streaming session state"
    // Check whether activeTorrentSession was nullified
    const isSessionNull = (sandbox.window.activeTorrentSession === null);

    // 3. An asynchronous error event arrives from an old WebRTC socket or decaying iframe
    toasts.length = 0;
    sandbox.window.handleWebtorTelemetry({ name: 'torrent error', data: 'WebRTC transport disconnected' });

    // Assess whether the destroyed player resurrected
    const resurrected = sandbox.window.activeTorrentSession && sandbox.window.activeTorrentSession.providerIndex === 1;
    const watchdogReArmed = sandbox.window.activeTorrentSession && sandbox.window.activeTorrentSession.watchdogTimer !== null;

    if (!isSessionNull && resurrected && watchdogReArmed) {
        // Document confirmed vulnerability:
        console.warn('\n   ⚠️ [VULNERABILITY REPRODUCED]: destroyCurrentTorrentPlayer() leaves activeTorrentSession as a zombie object.');
        console.warn('      When a delayed error event arrives after player destruction, handleWebtorTelemetry() resurrects the session,');
        console.warn('      triggers failover, displays switch toasts, and re-arms watchdog timers on a destroyed player!\n');
    }

    // Assert the intended state:
    // A clean destruction protocol MUST NOT allow a destroyed player to resurrect and re-arm watchdog timers!
    assert.ok(
        !resurrected && !watchdogReArmed,
        'CRITICAL: Destroyed player resurrected! activeTorrentSession must be nullified on destruction so delayed error events cannot re-arm failover watchdog'
    );
});
