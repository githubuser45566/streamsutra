/**
 * StreamSutra - Sample Catalog Data (Open Demo Streams)
 */
(function() {
    'use strict';

    var CATALOG_DATA = {
        version: "1.1.0",
        hero: [],
        sections: []
    };

    if (typeof window !== 'undefined') {
        window.MEDIA_CATALOG = CATALOG_DATA;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = CATALOG_DATA;
    }
})();
