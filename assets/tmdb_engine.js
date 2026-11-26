/**
 * Live TV - TMDb & IMDb Discovery & Metadata Engine
 * 
 * Provides official IMDb and TMDb data:
 * - Latest Releases, Trending, Top Rated, Now Playing
 * - Multi-dimensional Filtering: Genre, Language (Hindi, English, Telugu, Tamil, Korean, etc.), Year, Sort Order
 * - Real-time Multi-Search across Movies, TV Series, and People
 * - Complete Details: Backdrops, Posters, Cast, Synopsis, Official YouTube Trailers
 * - TV Series: Multi-season breakdowns with episode thumbnails, titles, air dates, overviews
 */

(function(window) {
    'use strict';

    function getApiKey() {
        try {
            return localStorage.getItem('streamsutra_tmdb_api_key') || localStorage.getItem('tmdb_api_key') || '';
        } catch (e) {
            return '';
        }
    }

    const BASE_URL = 'https://api.themoviedb.org/3';
    const IMG_BASE_POSTER = 'https://image.tmdb.org/t/p/w500';
    const IMG_BASE_BACKDROP = 'https://image.tmdb.org/t/p/original';

    const GENRES_MOVIE = [
        { id: 28, name: 'Action' },
        { id: 12, name: 'Adventure' },
        { id: 16, name: 'Animation' },
        { id: 35, name: 'Comedy' },
        { id: 80, name: 'Crime' },
        { id: 99, name: 'Documentary' },
        { id: 18, name: 'Drama' },
        { id: 10751, name: 'Family' },
        { id: 14, name: 'Fantasy' },
        { id: 36, name: 'History' },
        { id: 27, name: 'Horror' },
        { id: 10402, name: 'Music' },
        { id: 9648, name: 'Mystery' },
        { id: 10749, name: 'Romance' },
        { id: 878, name: 'Sci-Fi' },
        { id: 53, name: 'Thriller' },
        { id: 10752, name: 'War' },
        { id: 37, name: 'Western' }
    ];

    const GENRES_TV = [
        { id: 10759, name: 'Action & Adventure' },
        { id: 16, name: 'Animation' },
        { id: 35, name: 'Comedy' },
        { id: 80, name: 'Crime' },
        { id: 99, name: 'Documentary' },
        { id: 18, name: 'Drama' },
        { id: 10751, name: 'Family' },
        { id: 10762, name: 'Kids' },
        { id: 9648, name: 'Mystery' },
        { id: 10763, name: 'News' },
        { id: 10764, name: 'Reality' },
        { id: 10765, name: 'Sci-Fi & Fantasy' },
        { id: 10766, name: 'Soap' },
        { id: 10767, name: 'Talk' },
        { id: 10768, name: 'War & Politics' },
        { id: 37, name: 'Western' }
    ];

    const LANGUAGES = [
        { code: '', name: 'All Languages' },
        { code: 'hi', name: 'Hindi (हिन्दी)' },
        { code: 'en', name: 'English' },
        { code: 'te', name: 'Telugu (తెలుగు)' },
        { code: 'ta', name: 'Tamil (தமிழ்)' },
        { code: 'ml', name: 'Malayalam (മലയാളം)' },
        { code: 'kn', name: 'Kannada (ಕನ್ನಡ)' },
        { code: 'bn', name: 'Bengali (বাংলা)' },
        { code: 'ko', name: 'Korean (한국어)' },
        { code: 'ja', name: 'Japanese (日本語)' }
    ];

    // In-memory cache for ultra-fast navigation
    const cache = new Map();
    let hasWarnedApiKey = false;

    async function apiFetch(endpoint, params = {}) {
        const apiKey = getApiKey();
        if (!apiKey) {
            if (!hasWarnedApiKey) {
                console.info('[TmdbEngine] TMDb API key not configured. Set your free key via localStorage.setItem("streamsutra_tmdb_api_key", "YOUR_KEY") or in Settings.');
                hasWarnedApiKey = true;
            }
            return null;
        }
        const queryParams = new URLSearchParams({
            api_key: apiKey,
            ...params
        });
        const url = `${BASE_URL}${endpoint}?${queryParams.toString()}`;

        if (cache.has(url)) {
            return cache.get(url);
        }

        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                cache.set(url, data);
                return data;
            } catch (err) {
                if (attempt === 1) {
                    console.warn('[TmdbEngine] Fetch failed for:', url, err);
                    return null;
                }
            }
        }
        return null;
    }

    const TmdbEngine = {
        genresMovie: GENRES_MOVIE,
        genresTV: GENRES_TV,
        languages: LANGUAGES,
        getApiKey,
        setApiKey(key) {
            try {
                localStorage.setItem('streamsutra_tmdb_api_key', (key || '').trim());
                cache.clear();
                return true;
            } catch (e) {
                return false;
            }
        },

        /**
         * Get Trending Titles (day/week)
         */
        async getTrending(type = 'movie', timeWindow = 'week') {
            const data = await apiFetch(`/trending/${type}/${timeWindow}`);
            return data && data.results ? data.results.map(item => this.normalizeItem(item, type)) : [];
        },

        /**
         * Get Latest / In Theaters / On The Air
         */
        async getLatest(type = 'movie', page = 1) {
            const endpoint = (type === 'movie') ? '/movie/now_playing' : '/tv/on_the_air';
            const data = await apiFetch(endpoint, { page });
            return data && data.results ? data.results.map(item => this.normalizeItem(item, type)) : [];
        },

        /**
         * Get Top Rated Titles of all time
         */
        async getTopRated(type = 'movie', page = 1) {
            const endpoint = (type === 'movie') ? '/movie/top_rated' : '/tv/top_rated';
            const data = await apiFetch(endpoint, { page });
            return data && data.results ? data.results.map(item => this.normalizeItem(item, type)) : [];
        },

        /**
         * Get Bollywood / Indian Titles
         */
        async getBollywood(type = 'movie', page = 1) {
            return this.discover({
                type,
                language: 'hi',
                sortBy: 'popularity.desc',
                page
            });
        },

        /**
         * Get Popular Dual Audio & Dubbed Titles (Hollywood Action/Sci-Fi/Adventure in India)
         */
        async getDualAudio(type = 'movie', page = 1) {
            const endpoint = (type === 'movie') ? '/discover/movie' : '/discover/tv';
            const params = {
                page,
                sort_by: 'popularity.desc',
                with_original_language: 'en',
                'vote_count.gte': (type === 'movie') ? 300 : 150,
                include_adult: false
            };
            if (type === 'movie') {
                params.with_genres = '28|12|878|14|53'; // Action, Adventure, Sci-Fi, Fantasy, Thriller
            }
            const data = await apiFetch(endpoint, params);
            return data && data.results ? data.results.map(item => this.normalizeItem(item, type)) : [];
        },

        /**
         * Get South Indian Pan-India Blockbusters (Telugu, Tamil, Malayalam, Kannada dubbed)
         */
        async getSouthIndian(type = 'movie', page = 1) {
            const endpoint = (type === 'movie') ? '/discover/movie' : '/discover/tv';
            const params = {
                page,
                sort_by: 'popularity.desc',
                with_original_language: 'te|ta|ml|kn',
                'vote_count.gte': 15,
                include_adult: false
            };
            const data = await apiFetch(endpoint, params);
            return data && data.results ? data.results.map(item => this.normalizeItem(item, type)) : [];
        },

        /**
         * Multi-Filter Discovery Engine:
         * Filters by: type, genre, language, year, sortBy, page
         */
        async discover({
            type = 'movie',
            genre = '',
            language = '',
            year = '',
            sortBy = 'popularity.desc',
            page = 1
        } = {}) {
            const endpoint = (type === 'movie') ? '/discover/movie' : '/discover/tv';
            const params = {
                page,
                sort_by: sortBy,
                include_adult: false
            };

            if (genre) params.with_genres = genre;
            if (language) params.with_original_language = language;

            if (year) {
                if (type === 'movie') {
                    if (year.endsWith('s')) {
                        // Decade query e.g. 2010s
                        const startYear = parseInt(year, 10);
                        params['primary_release_date.gte'] = `${startYear}-01-01`;
                        params['primary_release_date.lte'] = `${startYear + 9}-12-31`;
                    } else if (year === 'Classics') {
                        params['primary_release_date.lte'] = '1999-12-31';
                    } else {
                        params.primary_release_year = year;
                    }
                } else {
                    if (year.endsWith('s')) {
                        const startYear = parseInt(year, 10);
                        params['first_air_date.gte'] = `${startYear}-01-01`;
                        params['first_air_date.lte'] = `${startYear + 9}-12-31`;
                    } else if (year === 'Classics') {
                        params['first_air_date.lte'] = '1999-12-31';
                    } else {
                        params.first_air_date_year = year;
                    }
                }
            }

            // Ensure decent rating quality if sorting by rating
            if (sortBy.includes('vote_average')) {
                params['vote_count.gte'] = 200;
            }

            const data = await apiFetch(endpoint, params);
            return data && data.results ? data.results.map(item => this.normalizeItem(item, type)) : [];
        },

        /**
         * Real-time Multi-Search across Movies and TV Series
         */
        async search(query, page = 1) {
            if (!query || !query.trim()) return [];
            const data = await apiFetch('/search/multi', {
                query: query.trim(),
                page,
                include_adult: false
            });

            if (!data || !data.results) return [];

            return data.results
                .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
                .map(item => this.normalizeItem(item, item.media_type));
        },

        /**
         * Get Full Details (Credits, Trailers, External IDs, Recommendations)
         */
        async getDetails(type, id) {
            const endpoint = (type === 'movie') ? `/movie/${id}` : `/tv/${id}`;
            const data = await apiFetch(endpoint, {
                append_to_response: 'credits,videos,external_ids,recommendations'
            });

            if (!data) return null;
            return this.normalizeDetailedItem(data, type);
        },

        /**
         * Get Season Episodes for TV Series
         */
        async getSeasonEpisodes(tvId, seasonNumber = 1) {
            const data = await apiFetch(`/tv/${tvId}/season/${seasonNumber}`);
            if (!data || !data.episodes) return [];

            return data.episodes.map(ep => ({
                id: ep.id,
                epNumber: ep.episode_number,
                seasonNumber: ep.season_number,
                title: ep.name || `Episode ${ep.episode_number}`,
                airDate: ep.air_date || '',
                duration: ep.runtime ? `${ep.runtime}m` : '45m',
                rating: ep.vote_average ? ep.vote_average.toFixed(1) : '',
                thumb: ep.still_path ? `${IMG_BASE_BACKDROP}${ep.still_path}` : '',
                overview: ep.overview || 'No description available for this episode.'
            }));
        },

        /**
         * Normalize TMDb list item
         */
        normalizeItem(item, type) {
            const isMovie = (type === 'movie' || item.title !== undefined);
            const title = isMovie ? (item.title || item.original_title) : (item.name || item.original_name);
            const dateStr = isMovie ? (item.release_date || '') : (item.first_air_date || '');
            const year = dateStr ? dateStr.substring(0, 4) : '';
            const rating = item.vote_average ? item.vote_average.toFixed(1) : '7.5';

            const genreIds = item.genre_ids || [];
            const genreList = isMovie ? GENRES_MOVIE : GENRES_TV;
            const genres = genreIds.map(id => {
                const found = genreList.find(g => g.id === id);
                return found ? found.name : null;
            }).filter(Boolean);

            return {
                id: item.id,
                tmdbId: item.id,
                title: title,
                type: isMovie ? 'movie' : 'series',
                poster: item.poster_path ? `${IMG_BASE_POSTER}${item.poster_path}` : 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=600&h=900&q=80',
                backdrop: item.backdrop_path ? `${IMG_BASE_BACKDROP}${item.backdrop_path}` : (item.poster_path ? `${IMG_BASE_POSTER}${item.poster_path}` : 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1920&h=1080&q=80'),
                rating: rating,
                year: year,
                genre: genres.length > 0 ? genres : ['Entertainment'],
                overview: item.overview || 'Experience high definition cinematic entertainment.',
                originalLanguage: item.original_language || 'en'
            };
        },

        /**
         * Normalize Full Details Item
         */
        normalizeDetailedItem(data, type) {
            const base = this.normalizeItem(data, type);
            base.overview = data.overview || base.overview;
            base.tagline = data.tagline || '';
            base.imdbId = data.external_ids ? data.external_ids.imdb_id : null;

            if (type === 'movie') {
                base.duration = data.runtime ? `${Math.floor(data.runtime / 60)}h ${data.runtime % 60}m` : '2h 10m';
            } else {
                base.totalSeasons = data.number_of_seasons || (data.seasons ? data.seasons.filter(s => s.season_number > 0).length : 1);
                base.totalEpisodes = data.number_of_episodes || 0;
                base.seasonsList = (data.seasons || []).filter(s => s.season_number > 0).map(s => ({
                    seasonNumber: s.season_number,
                    name: s.name || `Season ${s.season_number}`,
                    episodeCount: s.episode_count || 0
                }));
            }

            // Cast list
            if (data.credits && data.credits.cast) {
                base.cast = data.credits.cast.slice(0, 8).map(c => c.name);
            } else {
                base.cast = [];
            }

            // Official YouTube Trailers
            base.trailers = [];
            if (data.videos && data.videos.results) {
                const ytTrailers = data.videos.results.filter(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
                base.trailers = ytTrailers.map(t => ({
                    id: t.id,
                    name: t.name || 'Official Trailer',
                    youtubeKey: t.key,
                    youtubeUrl: `https://www.youtube.com/watch?v=${t.key}`,
                    embedUrl: `https://www.youtube.com/embed/${t.key}?autoplay=1&modestbranding=1&rel=0`
                }));
            }

            return base;
        }
    };

    // Universal Export
    window.TmdbEngine = TmdbEngine;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = TmdbEngine;
    }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
