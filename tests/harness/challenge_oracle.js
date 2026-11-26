/**
 * challenge_oracle.js
 * Authoritative Webtor Challenge Deobfuscator, Packer & SHA-1 Oracle
 * Replicates Webtor check.js (Module 2044) & unpacker specifications.
 */

const crypto = require('node:crypto');

class ChallengeOracle {
    /**
     * Compute SHA1 hash of (window._id + token)
     * Matches Webtor check.js: r(window._id + e)
     */
    static computeHash(id, token) {
        return crypto.createHash('sha1').update(String(id) + String(token)).digest('hex');
    }

    /**
     * Generate packed challenge payload simulating Webtor inject string
     * @param {string} id - Session UUID
     * @param {string} token - Dynamic UUID token to embed
     * @returns {string} Obfuscated code string
     */
    static generatePackedChallenge(id, token) {
        const rawCode = `
var found = false;
var scripts = document.getElementsByTagName('script');
for (var i = scripts.length; i--;) {
    if (scripts[i].src && (scripts[i].src.indexOf('https://cdn.jsdelivr.net/npm/@webtor/') !== -1 || scripts[i].src.indexOf('http://localhost:9009/') !== -1)) {
        found = '${token}';
    }
}
var f = window.frames['webtor-${id}'];
if (f && f.contentWindow) {
    f.contentWindow.postMessage({ id: '${id}', name: 'check', data: found }, '*');
}
`;
        // Wrap in eval packer format as seen in check.js
        const escaped = JSON.stringify(rawCode);
        return `var _0xc51e = ["", "split", "slice"];\nfunction _0xe20c(d) { return d; }\neval(function() { return ${escaped}; })()`;
    }

    /**
     * Authoritative Deobfuscator Algorithm
     * As specified in Survey E1 §6 and Survey E2 §6
     */
    static deobfuscateChallenge(dataStr) {
        if (typeof dataStr !== 'string' || !dataStr.trim()) {
            return false;
        }

        try {
            if (/\beval\s*\(/.test(dataStr)) {
                // Replace outer eval with return to unpack code safely
                const replaced = dataStr.replace(/\beval\s*\(/, "return (");
                const unpacked = (new Function(replaced))();

                if (typeof unpacked === 'string') {
                    const m = unpacked.match(/found\s*=\s*['"]([0-9a-f-]{36})['"]/i);
                    if (m && m[1]) {
                        return m[1];
                    }
                }
            }
        } catch (err) {
            // Dynamic unpack failed
        }

        // Direct regex match fallback
        const m = dataStr.match(/found\s*=\s*['"]([0-9a-f-]{36})['"]/i);
        if (m && m[1]) return m[1];

        return false;
    }

    /**
     * Verify whether a given script collection satisfies the Webtor challenge
     */
    static checkScriptsCollection(scripts) {
        if (!scripts || !Array.isArray(scripts)) return false;
        for (let i = scripts.length - 1; i >= 0; i--) {
            const src = (scripts[i] && scripts[i].src) ? String(scripts[i].src) : '';
            if (src.includes('https://cdn.jsdelivr.net/npm/@webtor/') || src.includes('http://localhost:9009/')) {
                return true;
            }
        }
        return false;
    }

    /**
     * Verify handshake against check.js criteria
     * @param {string} id
     * @param {string|boolean} token
     * @param {string} expectedHash
     * @returns {boolean}
     */
    static verifyHandshake(id, token, expectedHash) {
        if (!token) return false;
        const actualHash = this.computeHash(id, token);
        return actualHash === expectedHash;
    }
}

module.exports = ChallengeOracle;
