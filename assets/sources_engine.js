/**
 * StreamSutra - Sources & Stream Discovery Engine
 * Bring-Your-Own-Content (BYOC) Open Architecture
 * 
 * Provides:
 * 1. User-Configurable P2P Torrent & Magnet Stream Indexing
 * 2. Multi-Server Direct Web Embed Stream Support
 * 3. Episode-level and Movie-level stream discovery
 */

(function(window) {
    'use strict';

    function getTmdbApiKey() {
        try {
            return (window.TmdbEngine && typeof window.TmdbEngine.getApiKey === 'function')
                ? window.TmdbEngine.getApiKey()
                : (localStorage.getItem('streamsutra_tmdb_api_key') || localStorage.getItem('tmdb_api_key') || '');
        } catch (e) {
            return '';
        }
    }

    function getTorrentProviderBase() {
        try {
            return localStorage.getItem('streamsutra_torrent_provider') || '';
        } catch (e) {
            return '';
        }
    }

    const DEFAULT_TRACKERS = [
        'udp://tracker.opentrackr.org:1337/announce',
        'udp://open.stealth.si:80/announce',
        'udp://tracker.torrent.eu.org:451/announce',
        'udp://explodie.org:6969/announce',
        'udp://tracker.dler.org:6969/announce',
        'udp://tracker.coppersurfer.tk:6969/announce'
    ];

    const SourcesEngine = {
        getTorrentProvider: getTorrentProviderBase,
        setTorrentProvider(url) {
            try {
                localStorage.setItem('streamsutra_torrent_provider', (url || '').trim());
                return true;
            } catch (e) {
                return false;
            }
        },

        /**
         * Fetch and normalize Torrent / Magnet streams from user-configured provider
         */
        async getTorrents({ type = 'movie', imdbId, tmdbId, season, episode, title = '' }) {
            const providerBase = getTorrentProviderBase();
            if (!providerBase) {
                // BYOC Clean Mode: Return empty array when no external indexer is configured by user
                return [];
            }

            let id = imdbId;

            // If imdbId is missing, attempt to resolve via TMDb external_ids
            if (!id && tmdbId) {
                const apiKey = getTmdbApiKey();
                if (apiKey) {
                    try {
                        const endpoint = (type === 'movie') 
                            ? `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${apiKey}` 
                            : `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${apiKey}`;
                        const res = await fetch(endpoint);
                        if (res.ok) {
                            const ext = await res.json();
                            id = ext.imdb_id;
                        }
                    } catch (e) {
                        console.warn('[SourcesEngine] Failed to resolve IMDb ID:', e);
                    }
                }
            }

            if (!id) {
                return [];
            }

            const queryPath = (type === 'movie') 
                ? `/stream/movie/${id}.json` 
                : `/stream/series/${id}:${season || 1}:${episode || 1}.json`;

            const url = `${providerBase}${queryPath}`;

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 6000);
                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (!response.ok) return [];
                const data = await response.json();
                if (!data || !data.streams || !Array.isArray(data.streams)) return [];

                return data.streams.map(s => this.parseTorrentStream(s, title))
                    .filter(Boolean)
                    .sort((a, b) => b.seeds - a.seeds);
            } catch (err) {
                console.warn('[SourcesEngine] BYOC indexer fetch error:', err);
                return [];
            }
        },

        /**
         * Parse raw BYOC stream object into normalized UI model with Dual/Multi-Audio detection
         */
        parseTorrentStream(s, defaultTitle) {
            const hash = s.infoHash;
            if (!hash) return null;

            const nameLine = (s.title || '').split('\n')[0] || (s.behaviorHints && s.behaviorHints.filename) || defaultTitle;
            const seedMatch = (s.title || '').match(/👤\s*(\d+)/);
            const sizeMatch = (s.title || '').match(/💾\s*([\d\.]+\s*(?:GB|MB|TB))/i);
            const provMatch = (s.title || '').match(/⚙️\s*([^\n\r]+)/);

            const filename = (s.behaviorHints && s.behaviorHints.filename) || '';
            const fullText = `${s.name || ''} ${s.title || ''} ${nameLine} ${filename}`;
            const lowerText = fullText.toLowerCase();

            // 1. Resolution / Quality
            let quality = 'HD';
            if (/\b(4k|2160p|uhd)\b/i.test(lowerText)) {
                quality = '4K UHD';
            } else if (/\b(1080p|fhd)\b/i.test(lowerText)) {
                quality = '1080p';
            } else if (/\b(720p|hd)\b/i.test(lowerText)) {
                quality = '720p';
            } else if (/\b(480p|sd|dvdrip)\b/i.test(lowerText)) {
                quality = 'SD';
            }

            // 2. Audio Language Detection (Regex with word boundaries & flags)
            const hasHindi = /\b(hindi|hin|hnd)\b/i.test(lowerText) || fullText.includes('🇮🇳');
            const hasEnglish = /\b(english|eng)\b/i.test(lowerText) || fullText.includes('🇬🇧') || fullText.includes('🇺🇸');
            const hasTamil = /\b(tamil|tam)\b/i.test(lowerText);
            const hasTelugu = /\b(telugu|tel)\b/i.test(lowerText);
            const hasMalayalam = /\b(malayalam|mal)\b/i.test(lowerText);
            const hasKannada = /\b(kannada|kan)\b/i.test(lowerText);
            const hasRussian = /\b(rus|russian)\b/i.test(lowerText) || fullText.includes('🇷🇺');
            const hasFrench = /\b(french|fr|truefrench|vff)\b/i.test(lowerText) || fullText.includes('🇫🇷');
            const hasSpanish = /\b(spanish|esp|es|lat)\b/i.test(lowerText) || fullText.includes('🇪🇸') || fullText.includes('🇲🇽');
            const hasPortuguese = /\b(portuguese|pt|br)\b/i.test(lowerText) || fullText.includes('🇵🇹') || fullText.includes('🇧🇷');
            const hasItalian = /\b(ita|italian)\b/i.test(lowerText) || fullText.includes('🇮🇹');
            const hasGerman = /\b(german|de|ger)\b/i.test(lowerText) || fullText.includes('🇩🇪');
            const hasJapanese = /\b(japanese|jap|jpn)\b/i.test(lowerText) || fullText.includes('🇯🇵');
            const hasKorean = /\b(korean|kor)\b/i.test(lowerText) || fullText.includes('🇰🇷');

            const isDubbed = /\b(dubbed|dub|dubs|hybrid)\b/i.test(lowerText);

            const audioLanguages = [];
            if (hasHindi) audioLanguages.push('Hindi');
            if (hasEnglish) audioLanguages.push('English');
            if (hasTamil) audioLanguages.push('Tamil');
            if (hasTelugu) audioLanguages.push('Telugu');
            if (hasMalayalam) audioLanguages.push('Malayalam');
            if (hasKannada) audioLanguages.push('Kannada');
            if (hasRussian) audioLanguages.push('Russian');
            if (hasFrench) audioLanguages.push('French');
            if (hasSpanish) audioLanguages.push('Spanish');
            if (hasPortuguese) audioLanguages.push('Portuguese');
            if (hasItalian) audioLanguages.push('Italian');
            if (hasGerman) audioLanguages.push('German');
            if (hasJapanese) audioLanguages.push('Japanese');
            if (hasKorean) audioLanguages.push('Korean');

            // 3. Dual & Multi-Audio Detection
            const hasDualWord = /\b(dual[\s\-_]*audio|dual|dvo)\b/i.test(lowerText) ||
                                /\b(hindi\s*[\+\-\/&]\s*eng(?:lish)?|eng(?:lish)?\s*[\+\-\/&]\s*hindi)\b/i.test(lowerText) ||
                                lowerText.includes('dual audio');
            const hasMultiWord = /\b(multi[\s\-_]*audio|multi|mvo|multiaudio)\b/i.test(lowerText) ||
                                 lowerText.includes('multi audio');

            let isDualAudio = false;
            let isMultiAudio = false;
            let audioBadge = '';

            if (hasMultiWord || audioLanguages.length >= 3) {
                isMultiAudio = true;
                const langSummary = audioLanguages.length > 0 
                    ? ` (${audioLanguages.slice(0, 4).map(l => l.substring(0, 3)).join('+')})` 
                    : '';
                audioBadge = `🌐 Multi Audio${langSummary}`;
            } else if (hasDualWord || (hasHindi && hasEnglish) || audioLanguages.length === 2) {
                isDualAudio = true;
                if (hasHindi && hasEnglish) {
                    audioBadge = '🎧 Dual Audio (Hindi+Eng)';
                } else if (audioLanguages.length === 2) {
                    audioBadge = `🎧 Dual Audio (${audioLanguages[0].substring(0, 3)}+${audioLanguages[1].substring(0, 3)})`;
                } else {
                    audioBadge = '🎧 Dual Audio';
                }
            } else if (hasHindi) {
                audioBadge = isDubbed ? '🇮🇳 Hindi Dubbed' : '🇮🇳 Hindi Audio';
            } else if (hasTamil) {
                audioBadge = isDubbed ? '🦁 Tamil Dubbed' : '🦁 Tamil Audio';
            } else if (hasTelugu) {
                audioBadge = isDubbed ? '🦁 Telugu Dubbed' : '🦁 Telugu Audio';
            } else if (hasMalayalam) {
                audioBadge = '🌴 Malayalam Audio';
            } else if (hasKannada) {
                audioBadge = '🟡 Kannada Audio';
            }

            // Extract trackers or use defaults
            const streamTrackers = (s.sources || [])
                .filter(src => src.startsWith('tracker:'))
                .map(src => src.replace('tracker:', ''));
            const trackers = Array.from(new Set([...streamTrackers, ...DEFAULT_TRACKERS]));

            let magnet = `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(nameLine)}`;
            for (const tr of trackers) {
                magnet += `&tr=${encodeURIComponent(tr)}`;
            }

            return {
                hash,
                name: nameLine,
                seeds: seedMatch ? parseInt(seedMatch[1], 10) : 0,
                size: sizeMatch ? sizeMatch[1] : 'Unknown',
                provider: provMatch ? provMatch[1].trim() : 'BYOC',
                quality,
                isDualAudio,
                isMultiAudio,
                isHindi: hasHindi,
                audioBadge,
                audioLanguages,
                magnet
            };
        },

        /**
         * Get direct multi-server web embed stream sources
         */
        getWebStreams({ type = 'movie', tmdbId, imdbId, season = 1, episode = 1 }) {
            const id = imdbId || tmdbId;

            // BYOC: User-configured custom web embed servers
            try {
                const stored = localStorage.getItem('streamsutra_web_servers');
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        return parsed.map(s => ({
                            name: s.name || 'Custom Server',
                            badge: s.badge || 'BYOC Server',
                            color: s.color || '#00d2ff',
                            url: (s.url || '')
                                .replace('{tmdbId}', tmdbId || '')
                                .replace('{imdbId}', imdbId || '')
                                .replace('{id}', id || '')
                                .replace('{season}', season)
                                .replace('{episode}', episode)
                        }));
                    }
                }
            } catch (e) {
                console.warn('[SourcesEngine] Error parsing custom web servers:', e);
            }

            // BYOC Clean Mode: Return only user-configured legal web stream servers
            return [];
        }
    };

    // Universal Export
    window.SourcesEngine = SourcesEngine;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SourcesEngine;
    }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
