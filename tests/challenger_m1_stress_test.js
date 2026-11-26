/**
 * challenger_m1_stress_test.js
 * Empirical Challenge & Stress Harness for Milestone M1
 *
 * Verifies:
 * 1. Real payloads extracted from /sdcard/Download/livetv_debug.log
 * 2. 100+ Randomized UUIDs with varying hunter obfuscation parameters (radix, alphabet, offsets)
 * 3. Cryptographic SHA1 hash verification against Webtor check.js specification
 * 4. Window.prototype.contentWindow polyfill behavior on mock window objects
 * 5. Adversarial fault-injection & crash-resilience (zero unhandled exceptions)
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LOG_FILE = '/sdcard/Download/livetv_debug.log';
const WEBTOR_SDK_PATH = path.resolve(__dirname, '../assets/webtor_sdk.js');
const INDEX_HTML_PATH = path.resolve(__dirname, '../assets/index.html');

// Reference alphabet used by Webtor packer
const WEBTOR_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/";

/**
 * Helper: Convert between number bases using custom character set
 */
function baseConvert(d, e, f) {
    const g = WEBTOR_ALPHABET.split("");
    const h = g.slice(0, e);
    const i = g.slice(0, f);
    let j = d.split("").reverse().reduce((a, b, c) => {
        if (h.indexOf(b) !== -1) return a += h.indexOf(b) * Math.pow(e, c);
        return a;
    }, 0);
    let k = "";
    while (j > 0) {
        k = i[j % f] + k;
        j = Math.floor(j / f);
    }
    return k || "0";
}

/**
 * Generator: Pack arbitrary JS code using authentic Webtor hunter packer
 */
function packChallengeCode(code, base = 7, offset = 28, mapChars = "ZyATCpGVw") {
    const delim = mapChars[base];
    let h = "";
    for (let i = 0; i < code.length; i++) {
        const charCode = code.charCodeAt(i);
        const val = (charCode + offset).toString();
        const s = baseConvert(val, 10, base);
        let mapped = "";
        for (let k = 0; k < s.length; k++) {
            const digit = parseInt(s[k], 10);
            mapped += mapChars[digit];
        }
        h += mapped + delim;
    }

    return `var _0xc51e=["","split","${WEBTOR_ALPHABET}","slice","indexOf","","",".","pow","reduce","reverse","0"];` +
           `function _0xe20c(d,e,f){var g=_0xc51e[2][_0xc51e[1]](_0xc51e[0]);var h=g[_0xc51e[3]](0,e);var i=g[_0xc51e[3]](0,f);var j=d[_0xc51e[1]](_0xc51e[0])[_0xc51e[10]]()[_0xc51e[9]](function(a,b,c){if(h[_0xc51e[4]](b)!==-1)return a+=h[_0xc51e[4]](b)*(Math[_0xc51e[8]](e,c))},0);var k=_0xc51e[0];while(j>0){k=i[j%f]+k;j=(j-(j%f))/f}return k||_0xc51e[11]}` +
           `eval(function(h,u,n,t,e,r){r="";for(var i=0,len=h.length;i<len;i++){var s="";while(h[i]!==n[e]){s+=h[i];i++}for(var j=0;j<n.length;j++)s=s.replace(new RegExp(n[j],"g"),j);r+=String.fromCharCode(_0xe20c(s,e,10)-t)}return decodeURIComponent(escape(r))}("${h}",99,"${mapChars}",${offset},${base},59))`;
}

/**
 * Pure challenge deobfuscator replicating assets/webtor_sdk.js
 */
function deobfuscate(payload) {
    if (typeof payload !== 'string' || !payload.trim()) return null;

    // Fast path: plain regex
    const mPlain = payload.match(/found\s*=\s*['"]([0-9a-f-]{36})['"]/i);
    if (mPlain && mPlain[1]) return mPlain[1];

    // Dynamic unpack path
    try {
        const replaced = payload.replace(/\beval\s*\(/, "return (");
        const unpacked = (new Function(replaced))();
        if (typeof unpacked === 'string') {
            const m = unpacked.match(/found\s*=\s*['"]([0-9a-f-]{36})['"]/i);
            if (m && m[1]) return m[1];
        }
    } catch (errUnpack) {
        // Fallback eval attempt (if safe)
    }

    return null;
}

/**
 * SHA1 computation matching Webtor check.js: r(window._id + found)
 */
function computeWebtorHash(sessionId, token) {
    return crypto.createHash('sha1').update(String(sessionId) + String(token)).digest('hex');
}

/**
 * Generate randomized UUID v4
 */
function generateRandomUUID() {
    return crypto.randomUUID();
}

// ============================================================================
// SUITE 1: Real Payloads from livetv_debug.log
// ============================================================================

test('C1.01: livetv_debug.log exists and contains real Webtor inject events', () => {
    assert.ok(fs.existsSync(LOG_FILE), `Log file ${LOG_FILE} must exist`);
    const logContent = fs.readFileSync(LOG_FILE, 'utf8');
    assert.ok(logContent.includes('inject'), 'Log must contain inject entries');
});

test('C1.02: Extract and deobfuscate all real inject challenge payloads from log', () => {
    const logContent = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = logContent.split('\n');
    const injectLines = lines.filter(l => l.includes('inject var _'));

    assert.ok(injectLines.length >= 10, `Expected at least 10 inject lines in log, found ${injectLines.length}`);

    let extractedCount = 0;
    const extractedTokens = new Set();

    injectLines.forEach((line, idx) => {
        const match = line.match(/inject\s+(var\s+_0x[0-9a-f]+.*)\s+\([^)]+:[0-9]+\)$/);
        if (!match) return;

        const raw = match[1];
        const token = deobfuscate(raw);
        assert.ok(token, `Failed to extract token from log line index ${idx}`);
        assert.match(token, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
            `Token ${token} must be a valid 36-char UUID format`);

        extractedCount++;
        extractedTokens.add(token);
    });

    assert.ok(extractedCount >= 10, `Successfully unpacked ${extractedCount} real payloads`);
    assert.ok(extractedTokens.size >= 3, `Found ${extractedTokens.size} distinct dynamic tokens across sessions`);
});

test('C1.03: Verify cited worker_m1 sample payload and cryptographic SHA1 hash', () => {
    const samplePayload = 'var _0xc51e=["","split","0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/","slice","indexOf","","",".","pow","reduce","reverse","0"];function _0xe20c(d,e,f){var g=_0xc51e[2][_0xc51e[1]](_0xc51e[0]);var h=g[_0xc51e[3]](0,e);var i=g[_0xc51e[3]](0,f);var j=d[_0xc51e[1]](_0xc51e[0])[_0xc51e[10]]()[_0xc51e[9]](function(a,b,c){if(h[_0xc51e[4]](b)!==-1)return a+=h[_0xc51e[4]](b)*(Math[_0xc51e[8]](e,c))},0);var k=_0xc51e[0];while(j>0){k=i[j%f]+k;j=(j-(j%f))/f}return k||_0xc51e[11]}eval(function(h,u,n,t,e,r){r="";for(var i=0,len=h.length;i<len;i++){var s="";while(h[i]!==n[e]){s+=h[i];i++}for(var j=0;j<n.length;j++)s=s.replace(new RegExp(n[j],"g"),j);r+=String.fromCharCode(_0xe20c(s,e,10)-t)}return decodeURIComponent(escape(r))}("pTVpAVpAVAGGVATGVAGAVyyCVACCVApGVAGpVAppVACAVyyCVyppVyyCVACCVATGVApTVAGTVACTVypTVpTVpAVpAVAGGVATGVAGAVyyCVAGTVACyVAGAVApZVAGZVAGCVAGTVyyCVyppVyyCVACAVApGVACyVAGpVApCVACTVAppVAGCVyTCVACpVACTVAGCVyGGVApTVACTVApCVACTVAppVAGCVAGTVyGTVTZAVAAZVATGVACpVAyyVATGVApCVACTVyApVyACVAGTVACyVAGAVApZVAGZVAGCVyACVyAGVypTVpTVpAVpAVpAVACCVApGVAGAVyyCVyApVAGGVATGVAGAVyyCVApZVyyCVyppVyyCVAGTVACyVAGAVApZVAGZVAGCVAGTVyTCVApTVACTVAppVACpVAGCVACGVypTVyyCVApZVyTTVyTTVypTVyAGVyyCVTZCVpTVpAVpAVpAVpAVApZVACCVyyCVyApVpTVpAVpAVpAVpAVpAVAGTVACyVAGAVApZVAGZVAGCVAGTVATZVApZVATAVyTCVAGTVAGAVACyVyTCVApZVAppVACyVApTVAGpVACAVACTVAGTVyApVyACVACGVAGCVAGCVAGZVAGTVypAVyTpVyTpVACyVACAVAppVyTCVApyVAGTVACAVACTVApTVApZVAGGVAGAVyTCVAppVACTVAGCVyTpVAppVAGZVApCVyTpVyGyVTZZVACTVACZVAGCVApGVAGAVyTpVyACVyAGVyyCVTZpVTZpVpTVpAVpAVpAVpAVpAVAGTVACyVAGAVApZVAGZVAGCVAGTVATZVApZVATAVyTCVAGTVAGAVACyVyTCVApZVAppVACyVApTVAGpVACAVACTVAGTVyApVyACVACGVAGCVAGCVAGZVypAVyTpVyTpVApTVApGVACyVATGVApTVACGVApGVAGTVAGCVypAVypyVyTGVyTGVypyVyTpVyACVyAGVpTVpAVpAVpAVpAVyAGVyyCVTZCVpTVpAVpAVpAVpAVpAVACCVApGVAGpVAppVACAVyyCVyppVyyCVyACVACyVACyVACAVATGVyCyVyCyVyCAVACyVyTTVyCAVACyVACAVyTGVyTTVyCTVyCyVyCTVyCGVyTTVACZVypZVACCVyCGVyTTVACyVACCVyCCVACCVyCyVypyVyCAVyCAVyCTVACyVypyVyCAVyACVypTVpTVpAVpAVpAVpAVTZGVpTVpAVpAVpAVTZGVpTVpAVpAVAGGVATGVAGAVyyCVACCVyyCVyppVyyCVTZZVApZVAppVACAVApGVTZZVyTCVACCVAGAVATGVApCVACTVAGTVATZVyACVTZZVACTVACZVAGCVApGVAGAVyTTVypZVypyVACAVypyVyCCVACAVACCVypZVyTTVACCVyCZVypyVACZVyTTVyCTVACTVACTVyCGVyTTVATGVACTVyCGVACCVyTTVyCTVypyVypyVACyVyCAVyCCVyCCVyCZVATGVACyVyCyVyCyVyACVATAVypTVpTVpAVpAVACCVyTCVACyVApGVAppVAGCVACTVAppVAGCVAATVApZVAppVACAVApGVTZZVyTCVAGZVApGVAGTVAGCVAyZVACTVAGTVAGTVATGVACpVACTVyApVTZCVApZVACAVypAVyyCVyACVypZVypyVACAVypyVyCCVACAVACCVypZVyTTVACCVyCZVypyVACZVyTTVyCTVACTVACTVyCGVyTTVATGVACTVyCGVACCVyTTVyCTVypyVypyVACyVyCAVyCCVyCCVyCZVATGVACyVyCyVyCyVyACVyTAVyyCVAppVATGVApCVACTVypAVyyCVyACVACyVACGVACTVACyVApAVyACVyTAVyyCVACAVATGVAGCVATGVypAVyyCVACCVApGVAGpVAppVACAVTZGVyTAVyyCVyACVyTZVyACVyAGVypTVpTVpAV",99,"ZyATCpGVw",28,7,59))';

    const token = deobfuscate(samplePayload);
    assert.strictEqual(token, 'ccda223c-3cd0-4247-b8f7-cf5f29334c93', 'Token must match handoff report observation');

    const sessionId = '89d95df8-f19b-4ee7-ae7f-499c3551ac22';
    const computedHash = computeWebtorHash(sessionId, token);
    const expectedHash = '43db8608db145b848e75404d3c5af122dcda3f82';

    assert.strictEqual(computedHash, expectedHash, `SHA1 must exactly match check.js expected verification hash: ${expectedHash}`);
});

// ============================================================================
// SUITE 2: Stress-Test with 100+ Randomized UUIDs & Varying Parameters
// ============================================================================

test('C2.01: Stress-test 100 randomized UUIDs across varying radix, offsets, and alphabets', () => {
    const alphabets = [
        "ZyATCpGVw",
        "HdsunwbBi",
        "NsEMloPIG",
        "DeELIYUBC",
        "QwErTyUiO",
        "xYzAbCdEf",
        "kLmNoPqRs"
    ];

    const bases = [5, 6, 7]; // valid base indices for mapChars length 9
    const offsets = [10, 15, 20, 28, 33, 45];

    let passed = 0;
    const total = 100;

    for (let i = 0; i < total; i++) {
        const testUuid = generateRandomUUID();
        const testSessionId = generateRandomUUID();

        const alphabet = alphabets[i % alphabets.length];
        const base = bases[i % bases.length];
        const offset = offsets[i % offsets.length];

        const innerCode = `
var found = false;
var scripts = document.getElementsByTagName('script');
for (var i = scripts.length; i--;) {
    if (scripts[i].src.includes('https://cdn.jsdelivr.net/npm/@webtor/')) {
        found = '${testUuid}';
    }
}
var f = window.frames['webtor-${testSessionId}'];
f.contentWindow.postMessage({ id: '${testSessionId}', name: 'check', data: found }, '*');
`;

        const packed = packChallengeCode(innerCode, base, offset, alphabet);

        // Deobfuscate
        const extractedUuid = deobfuscate(packed);
        assert.strictEqual(extractedUuid, testUuid, `Iteration ${i}: Extracted UUID must match embedded UUID`);

        // Verify SHA1 hash
        const hash = computeWebtorHash(testSessionId, extractedUuid);
        const expectedHash = crypto.createHash('sha1').update(testSessionId + testUuid).digest('hex');
        assert.strictEqual(hash, expectedHash, `Iteration ${i}: SHA1 hash mismatch`);

        passed++;
    }

    assert.strictEqual(passed, total, 'All 100 randomized challenge stress tests must pass');
});

test('C2.02: Handle arbitrary whitespace and newlines around eval wrapper', () => {
    const testUuid = generateRandomUUID();
    const raw = `var found = '${testUuid}';`;
    const escaped = JSON.stringify(raw);

    const variations = [
        `eval(function(){ return ${escaped}; })()`,
        `eval  (function(){ return ${escaped}; })()`,
        `eval\t(function(){ return ${escaped}; })()`,
        `eval\n(function(){ return ${escaped}; })()`,
        `eval \n (function(){ return ${escaped}; })()`,
    ];

    for (const v of variations) {
        const extracted = deobfuscate(v);
        assert.strictEqual(extracted, testUuid, `Must extract UUID from whitespace variation: ${JSON.stringify(v.slice(0, 20))}`);
    }
});

test('C2.03: Plain regex fallback when eval is absent or already evaluated', () => {
    const testUuid = generateRandomUUID();
    const plainCases = [
        `var found = '${testUuid}';`,
        `found="${testUuid}"`,
        `window.found = '${testUuid}';`,
        `{ name: 'check', data: '${testUuid}' }; found = '${testUuid}'`,
    ];

    for (const p of plainCases) {
        const extracted = deobfuscate(p);
        assert.strictEqual(extracted, testUuid, `Fallback must extract UUID from plain text: ${p}`);
    }
});

// ============================================================================
// SUITE 3: Window.prototype.contentWindow Behavior on Mock Window Objects
// ============================================================================

test('C3.01: Window.prototype.contentWindow polyfill in index.html is sound', () => {
    const indexContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
    assert.ok(indexContent.includes('Window.prototype'), 'index.html must polyfill Window.prototype');
    assert.ok(indexContent.includes('contentWindow'), 'index.html must define contentWindow');
    assert.ok(indexContent.includes('return this'), 'Getter must return this');
});

test('C3.02: Mock Window and Window proxy resolve contentWindow and execute postMessage', () => {
    // Simulate browser Window constructor
    function MockWindow() {
        this.messages = [];
    }
    MockWindow.prototype.postMessage = function(data, origin) {
        this.messages.push({ data, origin });
    };

    // Apply the exact polyfill from index.html
    if (!('contentWindow' in MockWindow.prototype)) {
        Object.defineProperty(MockWindow.prototype, 'contentWindow', {
            get: function() { return this; },
            configurable: true
        });
    }

    const winInstance = new MockWindow();

    // Verify contentWindow getter
    assert.strictEqual(winInstance.contentWindow, winInstance, 'win.contentWindow must return winInstance');

    // Simulate f = window.frames['webtor-xyz'] which returns a Window
    const f = winInstance;
    const testPayload = { id: 'test-123', name: 'check', data: 'token-abc' };

    // This call threw TypeError before M1: f.contentWindow was undefined!
    assert.doesNotThrow(() => {
        f.contentWindow.postMessage(testPayload, '*');
    }, 'Calling f.contentWindow.postMessage must never throw TypeError');

    assert.strictEqual(winInstance.messages.length, 1);
    assert.deepStrictEqual(winInstance.messages[0].data, testPayload);
});

test('C3.03: contentWindow polyfill is configurable and does not collide with HTMLIFrameElement', () => {
    function MockWindow() {}
    Object.defineProperty(MockWindow.prototype, 'contentWindow', {
        get: function() { return this; },
        configurable: true
    });

    // Mock HTMLIFrameElement (inherits from Element, not Window)
    function MockIFrameElement() {
        this._subWindow = new MockWindow();
    }
    Object.defineProperty(MockIFrameElement.prototype, 'contentWindow', {
        get: function() { return this._subWindow; },
        configurable: true
    });

    const iframe = new MockIFrameElement();
    const win = new MockWindow();

    assert.strictEqual(win.contentWindow, win, 'Window contentWindow returns itself');
    assert.strictEqual(iframe.contentWindow, iframe._subWindow, 'IFrame contentWindow returns its child window');
    assert.notStrictEqual(iframe.contentWindow, iframe, 'IFrame contentWindow does not return the iframe element');
});

test('C3.04: Multiple applications of polyfill are idempotent and safe', () => {
    function TestWindow() {}
    for (let i = 0; i < 5; i++) {
        if (!('contentWindow' in TestWindow.prototype)) {
            Object.defineProperty(TestWindow.prototype, 'contentWindow', {
                get: function() { return this; },
                configurable: true
            });
        }
    }

    const t = new TestWindow();
    assert.strictEqual(t.contentWindow, t);
});

// ============================================================================
// SUITE 4: Fault Injection & Crash Resilience (Zero Unhandled Exceptions)
// ============================================================================

test('C4.01: Non-string and empty challenge inputs never throw unhandled exceptions', () => {
    const pathologicalInputs = [
        null,
        undefined,
        "",
        "   ",
        12345,
        true,
        false,
        {},
        [],
        { found: "abc" },
        () => "var found = '123';",
        Symbol("test")
    ];

    for (const input of pathologicalInputs) {
        assert.doesNotThrow(() => {
            const res = deobfuscate(input);
            assert.strictEqual(res, null, `Pathological input ${String(input)} should safely yield null`);
        }, `Input ${String(input)} caused unexpected exception`);
    }
});

test('C4.02: SyntaxError and Runtime exceptions in eval payload are safely caught', () => {
    const maliciousPayloads = [
        // Unclosed eval
        "eval(function() { return 'unterminated",
        // Direct throw
        "eval(function() { throw new Error('Exploit Injection Failure'); })()",
        // SyntaxError inside eval
        "eval(<<<>>>)",
        // Undefined variable access
        "eval(function() { return nonExistentVar.someProp; })()",
        // Malformed regex in payload
        "eval(function() { var r = new RegExp('+++'); return r; })()",
        // Type error in execution
        "eval(function() { null.f(); })()"
    ];

    for (const badPayload of maliciousPayloads) {
        assert.doesNotThrow(() => {
            const res = deobfuscate(badPayload);
            // Must return null, not crash
            assert.strictEqual(res, null);
        }, `Malicious payload caused unhandled throw: ${badPayload.slice(0, 30)}`);
    }
});

test('C4.03: SDK message listener handler resists postMessage and callback errors', () => {
    // Read the actual webtor_sdk.js file and verify try/catch boundaries
    const sdkCode = fs.readFileSync(WEBTOR_SDK_PATH, 'utf8');

    // Verify self.INJECT block has outer and inner try/catches
    assert.ok(sdkCode.includes('d.name==self.INJECT'), 'SDK must handle INJECT event');
    assert.ok(sdkCode.includes('catch(errUnpack)'), 'SDK must catch dynamic unpack error');
    assert.ok(sdkCode.includes('catch(ePost)'), 'SDK must catch postMessage errors');
    assert.ok(sdkCode.includes('catch(e)'), 'SDK must have top-level challenge resolution try/catch');
    assert.ok(sdkCode.includes('[Webtor Callback Error]'), 'SDK must isolate user callbacks in try/catch');
});

test('C4.04: Extremely long payloads (100KB+) do not cause regex DOS or call stack overflow', () => {
    const validUuid = generateRandomUUID();
    const padding = "/* " + "A".repeat(120000) + " */\n";
    const hugePayload = padding + `var found = '${validUuid}';\n` + padding;

    const start = Date.now();
    const token = deobfuscate(hugePayload);
    const duration = Date.now() - start;

    assert.strictEqual(token, validUuid, 'Extracted token must match despite 120KB payload padding');
    assert.ok(duration < 200, `Execution took ${duration}ms, must complete under 200ms without ReDoS`);
});

test('C4.05: Bug Verification - postMessage(null) handled safely without TypeError in webtor_sdk.js', () => {
    const sdkCode = fs.readFileSync(WEBTOR_SDK_PATH, 'utf8');
    let messageListener = null;
    const mockWindow = {
        location: { href: "https://livetv.app" },
        addEventListener: (type, fn) => {
            if (type === "message") messageListener = fn;
        },
        removeEventListener: () => {},
        document: {
            createElement: () => ({ id: "", name: "", setAttribute: () => {}, style: {} }),
            getElementById: () => ({ appendChild: () => {} }),
            querySelectorAll: () => []
        }
    };

    new Function("window", "document", sdkCode)(mockWindow, mockWindow.document);
    mockWindow.webtor.push({ id: "p", magnet: "magnet:?xt=urn:btih:12345" });
    assert.ok(messageListener, "Message listener must be registered");

    // Fixed: Boolean(d)&&"object"==typeof d&&d.id==id ensures postMessage(null) does not evaluate null.id
    assert.doesNotThrow(() => {
        messageListener({ data: null });
        messageListener({ data: undefined });
        messageListener(null);
        messageListener(undefined);
    }, 'VERIFIED FIX: window.postMessage with null or undefined data does NOT throw unhandled TypeError');
});

test('C4.06: Contract Invalidation Check - Requirement 3 requires ZERO unhandled exceptions on all postMessages', (t) => {
    const sdkCode = fs.readFileSync(WEBTOR_SDK_PATH, 'utf8');
    let messageListener = null;
    const mockWindow = {
        location: { href: "https://livetv.app" },
        addEventListener: (type, fn) => {
            if (type === "message") messageListener = fn;
        },
        removeEventListener: () => {},
        document: {
            createElement: () => ({ id: "", name: "", setAttribute: () => {}, style: {} }),
            getElementById: () => ({ appendChild: () => {} }),
            querySelectorAll: () => []
        }
    };

    new Function("window", "document", sdkCode)(mockWindow, mockWindow.document);
    mockWindow.webtor.push({ id: "p", magnet: "magnet:?xt=urn:btih:12345" });

    // Requirement 3: "Verify that no unhandled exceptions can bubble up to crash the application"
    // Under unpatched webtor_sdk.js, messageListener({ data: null }) bubbles an unhandled TypeError.
    // If this test fails, changes are requested to patch webtor_sdk.js:
    // Change `"object"==typeof d&&d.id==id` -> `Boolean(d)&&"object"==typeof d&&d.id==id`
    try {
        messageListener({ data: null });
    } catch (err) {
        assert.fail(`UNHANDLED EXCEPTION BUBBLED UP: ${err.name} - ${err.message}. assets/webtor_sdk.js must guard against null event.data`);
    }
});

