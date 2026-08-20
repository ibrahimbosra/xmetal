(function (global) {
    'use strict';

    var ARABIC_LETTER_MAP = {
        a: 'ا', b: 'ب', c: 'س', d: 'د', e: 'ع', f: 'ف', g: 'ج', h: 'ح', i: 'ي', j: 'ج',
        k: 'ك', l: 'ل', m: 'م', n: 'ن', o: 'و', p: 'ب', q: 'ق', r: 'ر', s: 'س', t: 'ت',
        u: 'و', v: 'ف', w: 'و', x: 'س', y: 'ي', z: 'ز'
    };

    function normalizeEmailKey(value) {
        return String(value == null ? '' : value).trim().toLowerCase().replace(/[\u200E\u200F]/g, '');
    }

    function flattenNameMap(source) {
        var target = {};
        if (!source || typeof source !== 'object') return target;

        if (Array.isArray(source)) {
            source.forEach(function (entry) {
                if (!entry || typeof entry !== 'object') return;
                var email = entry.email || entry.userEmail || entry.username || entry.mail || entry.account;
                var name = entry.name || entry.displayName || entry.fullName || entry.label;
                if (email && name) target[normalizeEmailKey(email)] = String(name).trim();
            });
            return target;
        }

        Object.keys(source).forEach(function (key) {
            var value = source[key];
            if (value && typeof value === 'object') {
                if (value.email || value.userEmail) {
                    var nestedEmail = value.email || value.userEmail;
                    var nestedName = value.name || value.displayName || value.fullName || value.label || value.userName;
                    if (nestedEmail && nestedName) target[normalizeEmailKey(nestedEmail)] = String(nestedName).trim();
                    return;
                }
                Object.keys(value).forEach(function (nestedKey) {
                    var nestedValue = value[nestedKey];
                    if (nestedValue && typeof nestedValue === 'string') target[normalizeEmailKey(nestedKey)] = String(nestedValue).trim();
                });
                return;
            }
            if (typeof value === 'string' && key) {
                if (/@/.test(String(key))) target[normalizeEmailKey(key)] = String(value).trim();
                else if (typeof source.emails === 'object' && source.emails[key]) target[normalizeEmailKey(key)] = String(source.emails[key]).trim();
            }
        });

        return target;
    }

    function resolveSellerName(email, fallbackName, rawNameMap) {
        var cleanedEmail = normalizeEmailKey(email);
        var cleanedFallback = String(fallbackName == null ? '' : fallbackName).trim();
        if (!cleanedEmail) return cleanedFallback || '';

        var map = flattenNameMap(rawNameMap || {});
        if (map[cleanedEmail] && String(map[cleanedEmail]).trim()) return String(map[cleanedEmail]).trim();
        if (rawNameMap && rawNameMap[cleanedEmail] && String(rawNameMap[cleanedEmail]).trim()) return String(rawNameMap[cleanedEmail]).trim();
        if (rawNameMap && rawNameMap[String(email).trim()] && String(rawNameMap[String(email).trim()]).trim()) return String(rawNameMap[String(email).trim()]).trim();
        return cleanedFallback || email || '';
    }

    function getArabicInitial(value) {
        var raw = String(value == null ? '' : value).trim();
        if (!raw) return 'ا';

        var arabicMatches = raw.match(/[ابتثجحخدذرزسشصضطظعغفقكلمنهوياءأإآؤةى]/g);
        if (arabicMatches && arabicMatches.length) return arabicMatches[0];

        var englishMatch = raw.match(/[A-Za-z]/);
        if (englishMatch) {
            var letter = englishMatch[0].toLowerCase();
            return ARABIC_LETTER_MAP[letter] || 'ا';
        }

        return 'ا';
    }

    var helpers = {
        normalizeEmailKey: normalizeEmailKey,
        flattenNameMap: flattenNameMap,
        resolveSellerName: resolveSellerName,
        getArabicInitial: getArabicInitial
    };

    global.XMetalMobileSalesHelpers = helpers;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = helpers;
    }
})(typeof window !== 'undefined' ? window : globalThis);
