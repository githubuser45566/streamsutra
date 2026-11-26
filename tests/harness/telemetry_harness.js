/**
 * telemetry_harness.js
 * Swarm Telemetry, 3-Phase Playback Transition & Structured Logging Validator
 * Validates specifications from Survey E2 §4 and MainActivity.java AppLogger.
 */

class TelemetryHarness {
    /**
     * Format network speed dynamically:
     * Values < 1.0 MB/s formatted as KB/s
     * Values >= 1.0 MB/s formatted as MB/s
     */
    static formatSpeed(speedMB) {
        if (typeof speedMB !== 'number' || isNaN(speedMB) || speedMB < 0) {
            return '0 KB/s';
        }
        if (speedMB < 1.0) {
            return `${Math.round(speedMB * 1024)} KB/s`;
        }
        return `${speedMB.toFixed(1)} MB/s`;
    }

    /**
     * Parse size string into megabytes
     * @param {string} sizeStr - e.g. "1.4 GB", "750 MB", "2.1 GiB"
     */
    static parseSizeMB(sizeStr) {
        if (!sizeStr || typeof sizeStr !== 'string') return 1000;
        const clean = sizeStr.trim();
        const m = clean.match(/^([\d.]+)\s*([a-zA-Z]+)?$/);
        if (!m) return 1000;

        const val = parseFloat(m[1]);
        const unit = (m[2] || 'MB').toUpperCase();

        if (unit.startsWith('G')) {
            return Math.round(val * 1024);
        } else if (unit.startsWith('T')) {
            return Math.round(val * 1024 * 1024);
        } else if (unit.startsWith('K')) {
            return Math.round(val / 1024);
        }
        return Math.round(val);
    }

    /**
     * Format downloaded bytes vs total
     */
    static formatProgress(downloadedMB, totalMB) {
        if (!totalMB || totalMB <= 0) {
            return {
                percent: 0,
                percentStr: '0%',
                label: '0% (0 MB)'
            };
        }
        const pct = Math.min(100, Math.max(0, (downloadedMB / totalMB) * 100));
        let dlStr = `${Math.round(downloadedMB)} MB`;
        if (downloadedMB >= 1024) {
            dlStr = `${(downloadedMB / 1024).toFixed(2)} GB`;
        }
        return {
            percent: pct,
            percentStr: `${pct.toFixed(0)}%`,
            label: `${pct.toFixed(0)}% (${dlStr})`
        };
    }

    /**
     * 3-Phase Playback Transition Machine
     */
    static createPlaybackStateMachine() {
        return {
            phase: 1, // 1: Handshake, 2: Pre-buffer, 3: Active
            phaseName: 'HANDSHAKE',
            statusText: 'Connecting to Torrent Swarm... Contacting Trackers',
            statusBadge: '🟡 Connecting',
            isStreamingActive: false,

            onEvent(eventName, payload) {
                if (this.phase === 1) {
                    if (eventName === 'inited' || eventName === 'torrent fetched') {
                        this.phase = 2;
                        this.phaseName = 'PRE_BUFFER';
                        this.statusText = 'Pre-Buffering initial chunks...';
                        this.statusBadge = '🟠 Pre-Buffering';
                    } else if (eventName === 'play_clicked' || eventName === 'playing') {
                        this.transitionToActive();
                    }
                } else if (this.phase === 2) {
                    if (eventName === 'play_clicked' || eventName === 'playing' || (eventName === 'current time' && payload > 0)) {
                        this.transitionToActive();
                    }
                }
                return this.phase;
            },

            transitionToActive() {
                this.phase = 3;
                this.phaseName = 'ACTIVE_PLAYBACK';
                this.statusText = 'Active Video Streaming';
                this.statusBadge = '🟢 Streaming Active (HD)';
                this.isStreamingActive = true;
            }
        };
    }

    /**
     * Validate structured log format
     * Log line format from MainActivity: "[yyyy-MM-dd HH:mm:ss.SSS] [TAG] message"
     */
    static validateLogLine(line) {
        if (typeof line !== 'string') return false;
        const logRegex = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]\s*\[(JS-LOG|JS-WARNING|JS-ERROR|TorrentStream|Webtor Telemetry|Bridge|AssetServer|WebChrome)\]\s*(.*)$/;
        return logRegex.test(line);
    }

    /**
     * Check if text contains structured telemetry tags
     */
    static hasStructuredTelemetryTags(text) {
        if (typeof text !== 'string') return false;
        return text.includes('[Webtor Telemetry]') || text.includes('[TorrentStream]');
    }
}

module.exports = TelemetryHarness;
