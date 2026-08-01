(function(global) {
    'use strict';

    const STORAGE_KEY = 'xmetalGeminiApiKey';
    const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';
    const DEFAULT_MODEL = 'gemini-flash-latest';

    const config = {
        apiKey: '',
        endpoint: DEFAULT_ENDPOINT,
        model: DEFAULT_MODEL
    };

    function getGeminiApiKey() {
        try {
            const stored = global.localStorage ? global.localStorage.getItem(STORAGE_KEY) : '';
            if (stored) {
                config.apiKey = stored;
            }
        } catch (error) {
            console.warn('Unable to read Gemini API key from localStorage:', error);
        }
        return config.apiKey || '';
    }

    function setGeminiApiKey(key) {
        config.apiKey = (key || '').trim();
        if (global.localStorage) {
            global.localStorage.setItem(STORAGE_KEY, config.apiKey);
        }
        return config.apiKey;
    }

    function getGeminiConfig() {
        return {
            apiKey: getGeminiApiKey(),
            endpoint: config.endpoint,
            model: config.model
        };
    }

    try {
        config.apiKey = getGeminiApiKey();
    } catch (error) {
        console.warn('Gemini config initialization error:', error);
    }

    global.GEMINI_AI_CONFIG = config;
    global.getGeminiApiKey = getGeminiApiKey;
    global.setGeminiApiKey = setGeminiApiKey;
    global.getGeminiConfig = getGeminiConfig;
})(typeof window !== 'undefined' ? window : globalThis);
