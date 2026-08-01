// Unified Application State Management
// بدل ~50 متغير عام، نستخدم object واحد مركزي

const appState = {
    // User & Auth
    user: {
        uid: null,
        email: '',
        role: 'admin', // 'admin', 'manager', 'cashier', 'viewer'
        createdAt: null,
        lastLogin: null
    },
    
    // All Data Collections
    data: {
        sales: [],
        items: [],
        categories: [],
        expenses: [],
        sliderItems: [],
        activityLog: []
    },
    
    // UI State
    ui: {
        currentSection: 'dashboard',
        darkMode: localStorage.getItem('xmetalDarkMode') === 'true',
        displaySecondaryCurrency: localStorage.getItem('xmetalDisplaySecondary') === 'true',
        loading: false,
        error: null,
        successMessage: null
    },
    
    // Currency Settings
    currency: {
        primary: '$',
        secondary: {
            name: localStorage.getItem('xmetalSecondaryName') || 'ريال سعودي',
            symbol: localStorage.getItem('xmetalSecondarySymbol') || '﷼',
            exchangeRate: parseFloat(localStorage.getItem('xmetalExchangeRate') || '3.75'),
            defaultInputCurrency: localStorage.getItem('xmetalDefaultInputCurrency') || 'primary',
            defaultSellCurrency: localStorage.getItem('xmetalDefaultSellCurrency') || 'primary'
        }
    },
    
    // Store Information
    storeInfo: {
        name: '',
        address: '',
        phone: '',
        mapLink: '',
        imageUrl: '',
        videoUrl: '',
        socialLinks: {},
        hideOutOfStock: false
    },
    
    // Pagination & Filters
    pagination: {
        sales: { page: 0, pageSize: 25, lastDoc: null, hasMore: true, currentPageItems: [] },
        activity: { page: 0, pageSize: 25, lastDoc: null, hasMore: true, currentPageItems: [] }
    },
    
    filters: {
        sales: { period: 'all', searchTerm: '', categoryId: '', productId: '', minQty: '', maxQty: '', minProfit: '', maxProfit: '' },
        activity: { period: 'all', searchTerm: '', actionType: '', entity: '', user: '', customStart: null, customEnd: null },
        inventory: 'all',
        inventorySort: localStorage.getItem('xmetalInventorySort') || 'alphabetical',
        slider: { activeFilter: 'all', searchQuery: '' }
    },
    
    // Editor State
    editor: {
        currentItemId: null,
        isEditingItem: false,
        currentThumbnails: [],
        currentSliderEditId: null
    },
    
    // Cache & Performance
    cache: {
        lastFetchTime: 0,
        ttl: 3600000, // 1 hour
        allSalesFullLoaded: false,
        hasFetchedSales: false
    },
    
    // Targets & Goals
    targets: {
        dailySales: parseFloat(localStorage.getItem('xmetalSalesTarget') || '0'),
        targetAlertShown: false
    },
    
    // Notifications
    notifications: [],
    
    // Methods
    setState(path, value) {
        const keys = path.split('.');
        let obj = this;
        for (let i = 0; i < keys.length - 1; i++) {
            obj = obj[keys[i]];
        }
        obj[keys[keys.length - 1]] = value;
    },
    
    getState(path) {
        const keys = path.split('.');
        let obj = this;
        for (let i = 0; i < keys.length; i++) {
            obj = obj[keys[i]];
            if (obj === undefined) return null;
        }
        return obj;
    },
    
    resetState() {
        this.data = { sales: [], items: [], categories: [], expenses: [], sliderItems: [], activityLog: [] };
        this.ui.currentSection = 'dashboard';
        this.editor = { currentItemId: null, isEditingItem: false, currentThumbnails: [], currentSliderEditId: null };
        this.cache = { lastFetchTime: 0, ttl: 3600000, allSalesFullLoaded: false, hasFetchedSales: false };
    },
    
    saveToLocalStorage(key) {
        try {
            const value = this.getState(key);
            if (value !== null && value !== undefined) {
                localStorage.setItem('xmetal_' + key, JSON.stringify(value));
            }
        } catch (e) {
            console.warn('Failed to save to localStorage:', key, e);
        }
    },
    
    loadFromLocalStorage(key) {
        try {
            const item = localStorage.getItem('xmetal_' + key);
            if (item) {
                return JSON.parse(item);
            }
        } catch (e) {
            console.warn('Failed to load from localStorage:', key, e);
        }
        return null;
    }
};

// Export للاستخدام
window.appState = appState;
