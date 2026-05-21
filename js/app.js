const firebaseConfig = {
    apiKey: "AIzaSyBeJ0sbdCqz60a-yqzuZSt6QstDhR3TRtM",
    authDomain: "profit-zone-e03c6.firebaseapp.com",
    projectId: "profit-zone-e03c6",
    storageBucket: "profit-zone-e03c6.firebasestorage.app",
    messagingSenderId: "306955059136",
    appId: "1:306955059136:web:a450be9721f4a2db0d1225"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
db.enablePersistence().catch(function() {});

let allSales = [],
    allItems = [],
    allCategories = [],
    allExpenses = [],
    allSliderItems = [];
let allSalesFullLoaded = false;
let currencySettings = { secondaryCurrencyName: 'ريال سعودي', secondaryCurrencySymbol: '﷼', exchangeRate: 3.75,
    defaultInputCurrency: 'primary', defaultSellCurrency: 'primary' };
let storeInfoData = {};
let currentSection = 'dashboard';
let salesPage = 0,
    salesQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
let salesPageSize = 25;
let salesFilterParams = { period: 'all', searchTerm: '', categoryId: '', productId: '', minQty: '', maxQty: '',
    minProfit: '', maxProfit: '', minProfitPct: '', maxProfitPct: '' };
let activityPage = 0,
    activityPageSize = 25,
    activityQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
let activityFilterParams = { period: 'all', searchTerm: '', actionType: '', entity: '', user: '', customStart: null, customEnd: null };
let allCharts = {};
let darkMode = localStorage.getItem('xmetalDarkMode') === 'true';
let displaySecondaryCurrency = localStorage.getItem('xmetalDisplaySecondary') === 'true';
let salesTarget = parseFloat(localStorage.getItem('xmetalSalesTarget') || '0');
let realtimeListeners = [];
let searchDebounceTimer = null;
let itemVisibility = {};
let currentItemId = null,
    isEditingItem = false;
let tempPurchaseCurrency = false,
    tempSaleCurrency = false,
    tempSellCurrency = false,
    tempEditCurrency = false;
let currentThumbnails = [];
let currentSliderEditId = null;
let sliderActiveFilter = 'all';
let sliderSearchQuery = '';
let globalAutoSlideDelay = 5000;
let currentInventoryFilter = 'all';
let hasFetchedSales = false;
let comparisonManualRows = null;
window._cachedStats = { allTimeProfit: 0 };
window._targetAlertShown = false;
const CACHE_TTL = 3600000;
const chartColors = ['#2b6cb0', '#27ae60', '#f97316', '#e55353', '#6b46c1', '#0987a0', '#d69e2e', '#3182ce',
    '#38a169', '#dd6b20', '#c53030', '#805ad5', '#00b5d8', '#b7791f'
];
const popularIcons = [
    "fa-solid fa-tag", "fa-solid fa-percent", "fa-solid fa-gift", "fa-solid fa-star",
    "fa-solid fa-fire", "fa-solid fa-bolt", "fa-solid fa-bell", "fa-solid fa-calendar",
    "fa-solid fa-clock", "fa-solid fa-truck", "fa-solid fa-phone", "fa-solid fa-envelope",
    "fa-solid fa-location-dot", "fa-solid fa-heart", "fa-solid fa-thumbs-up", "fa-solid fa-share",
    "fa-solid fa-circle-info", "fa-solid fa-triangle-exclamation", "fa-solid fa-circle-check",
    "fa-solid fa-circle-xmark", "fa-solid fa-snowflake", "fa-solid fa-sun", "fa-solid fa-moon",
    "fa-solid fa-crown", "fa-solid fa-medal", "fa-solid fa-trophy", "fa-solid fa-rocket",
    "fa-solid fa-paper-plane", "fa-solid fa-comment", "fa-solid fa-bullhorn", "fa-solid fa-megaphone",
    "fa-solid fa-hand-point-right", "fa-solid fa-arrow-right", "fa-solid fa-angles-right",
    "fa-solid fa-cart-shopping", "fa-solid fa-credit-card", "fa-solid fa-wallet",
    "fa-solid fa-coins", "fa-solid fa-sack-dollar", "fa-solid fa-hand-holding-dollar",
    "fa-brands fa-whatsapp", "fa-brands fa-facebook", "fa-brands fa-instagram",
    "fa-brands fa-tiktok", "fa-brands fa-youtube", "fa-solid fa-motorcycle",
    "fa-solid fa-burger", "fa-solid fa-pizza-slice", "fa-solid fa-mug-hot",
    "fa-solid fa-wrench", "fa-solid fa-gear", "fa-solid fa-shield-halved",
    "fa-solid fa-certificate", "fa-solid fa-award", "fa-solid fa-ranking-star"
];

function fmt(n) { return Number(n || 0).toFixed(2); }
function fmtInt(n) { return parseInt(n || 0); }
function fmtDate(ts) { return new Date(ts).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short',
        day: 'numeric' }); }
function fmtDateTime(ts) { return new Date(ts).toLocaleString('ar-EG'); }
function getDayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,
        '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function getMonthKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,
        '0'); }
function getYearKey(ts) { return String(new Date(ts).getFullYear()); }
function escHtml(s) { if (!s) return ''; return s.replace(/[&<>]/g, function(m) { if (m === '&') return '&amp;';
        if (m === '<') return '&lt;'; if (m === '>') return '&gt;'; return m; }); }
function escJsString(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
function getFirebaseErrorMessage(e) {
    if (!e) return 'حدث خطأ غير متوقع';
    var map = {
        'auth/invalid-email': 'البريد الإلكتروني غير صالح',
        'auth/user-disabled': 'تم تعطيل هذا الحساب',
        'auth/user-not-found': 'بيانات الدخول غير صحيحة',
        'auth/wrong-password': 'بيانات الدخول غير صحيحة',
        'auth/invalid-credential': 'بيانات الدخول غير صحيحة',
        'permission-denied': 'لا تملك صلاحية للوصول إلى البيانات',
        'failed-precondition': 'يلزم إنشاء فهرس في Firebase — راجع Console',
        'unavailable': 'الخدمة غير متاحة مؤقتاً، حاول لاحقاً'
    };
    return map[e.code] || e.message || 'حدث خطأ غير متوقع';
}
function parseDateString(value, endOfDay) {
    if (!value || !String(value).trim()) return null;
    var text = String(value).trim();
    var date = null;
    // Prefer parsing YYYY-MM-DD as local date to avoid UTC shift
    var ymdMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (ymdMatch) {
        var yy = parseInt(ymdMatch[1], 10);
        var mm = parseInt(ymdMatch[2], 10);
        var dd = parseInt(ymdMatch[3], 10);
        date = new Date(yy, mm - 1, dd, 0, 0, 0, 0);
    } else {
        date = new Date(text);
        if (isNaN(date.getTime())) {
            var parts = text.split(/[-\/\.\s:]+/).map(function(p) { return parseInt(p, 10); });
            if (parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
                date = new Date(parts[0], parts[1] - 1, parts[2], parts[3] || 0, parts[4] || 0);
            }
        }
    }
    if (isNaN(date.getTime())) return null;
    if (endOfDay) { date.setHours(23, 59, 59, 999); }
    else { date.setHours(0, 0, 0, 0); }
    return date.getTime();
}
function showFirestoreError(e, context) {
    console.warn(context || 'Firestore', e);
    showToast((context ? context + ': ' : '') + getFirebaseErrorMessage(e), 'error');
}
function calcProfitMarginPct(purchasePrice, salePrice) {
    var p = Number(purchasePrice) || 0,
        s = Number(salePrice) || 0;
    if (p <= 0) return s > 0 ? '—' : '0.00';
    return (((s - p) / p) * 100).toFixed(2);
}
function getSalesRealtimeCutoff() {
    return Date.now() - 365 * 86400000;
}
function showToast(msg, type) {
    var t = document.createElement('div');
    t.className = 'toast' + (type === 'error' ? ' error' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, type === 'error' ? 5000 : 3000);
}
function closeModalById(id) { document.getElementById(id).classList.remove('show'); }
function formatMoney(amount) {
    var num = Number(amount || 0);
    if (displaySecondaryCurrency) { return currencySettings.secondaryCurrencySymbol + ' ' + fmt(num * currencySettings
            .exchangeRate); }
    return '$' + fmt(num);
}
function formatMoneyPlain(amount) {
    var num = Number(amount || 0);
    if (displaySecondaryCurrency) return fmt(num * currencySettings.exchangeRate);
    return fmt(num);
}

async function logActivity(actionType, entity, entityId, details, metadata) {
    try {
        await db.collection('activityLog').add({
            timestamp: Date.now(),
            actionType: actionType || '',
            entity: entity || '',
            entityId: entityId || null,
            details: details || '',
            user: (auth.currentUser && auth.currentUser.email) ? auth.currentUser.email : 'unknown',
            metadata: metadata || {}
        });
    } catch (e) {
        console.warn('Activity log failed:', e);
    }
}

function getActivityLabel(type) {
    var map = {
        create: 'إنشاء',
        update: 'تعديل',
        delete: 'حذف',
        sell: 'بيع',
        cancelSale: 'إلغاء بيع',
        archive: 'أرشفة',
        assign: 'تعيين',
        setting: 'تعديل إعداد',
        expenseAdd: 'إضافة مصروف',
        expenseDelete: 'حذف مصروف',
        sliderCreate: 'إضافة سلايدر',
        sliderUpdate: 'تحديث سلايدر',
        sliderHide: 'إخفاء/إظهار سلايدر',
        sliderDuplicate: 'نسخ سلايدر',
        sliderDelete: 'حذف سلايدر',
        currencyUpdate: 'تحديث العملة',
        storeUpdate: 'تحديث بيانات المتجر',
        targetUpdate: 'تحديث الهدف'
    };
    return map[type] || type || '--';
}

function getEntityLabel(entity) {
    var map = {
        item: 'منتج',
        sale: 'بيع',
        category: 'فئة',
        expense: 'مصروف',
        storeInfo: 'المتجر',
        currencySettings: 'إعدادات العملة',
        sliderItem: 'سلايدر',
        target: 'هدف',
        salesArchive: 'أرشيف المبيعات'
    };
    return map[entity] || entity || '--';
}

function formatActivityChangeValue(value, formatter) {
    if (formatter) return formatter(value);
    if (value === null || value === undefined) return '--';
    if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
    if (Array.isArray(value)) return value.length ? value.join(', ') : 'لا يوجد';
    if (typeof value === 'object') return JSON.stringify(value);
    return escHtml(String(value));
}

function buildItemChangeDetails(oldItem, newItem) {
    var fields = [
        { key: 'name', label: 'الاسم' },
        { key: 'purchasePrice', label: 'سعر الشراء', formatter: function(v) { return v === null || v === undefined ? '--' : fmt(v); } },
        { key: 'salePrice', label: 'سعر البيع', formatter: function(v) { return v === null || v === undefined ? '--' : fmt(v); } },
        { key: 'quantity', label: 'الكمية' },
        { key: 'categoryName', label: 'الفئة' },
        { key: 'hidden', label: 'الحالة', formatter: function(v) { return v ? 'مخفي' : 'ظاهر'; } },
        { key: 'limitedQuantity', label: 'الكمية محدودة', formatter: function(v) { return v ? 'نعم' : 'لا'; } },
        { key: 'discountEnabled', label: 'الخصم مفعل', formatter: function(v) { return v ? 'نعم' : 'لا'; } },
        { key: 'discountValue', label: 'قيمة الخصم', formatter: function(v) { return v === null || v === undefined ? '--' : fmt(v); } },
        { key: 'showPrice', label: 'عرض السعر', formatter: function(v) { return v ? 'نعم' : 'لا'; } },
        { key: 'description', label: 'الوصف' },
        { key: 'youtubeUrl', label: 'رابط اليوتيوب' }
    ];
    var changes = [];
    var metadata = {};
    function valuesDiffer(oldVal, newVal) {
        if (oldVal === newVal) return false;
        if (typeof oldVal === 'number' && typeof newVal === 'number' && isNaN(oldVal) && isNaN(newVal)) return false;
        if (typeof oldVal === 'object' || typeof newVal === 'object') {
            return JSON.stringify(oldVal) !== JSON.stringify(newVal);
        }
        return true;
    }
    fields.forEach(function(field) {
        var oldVal = oldItem[field.key];
        var newVal = newItem[field.key];
        if (valuesDiffer(oldVal, newVal)) {
            changes.push(field.label + ' من ' + formatActivityChangeValue(oldVal, field.formatter) + ' إلى ' + formatActivityChangeValue(newVal, field.formatter));
            metadata[field.key] = { from: oldVal, to: newVal };
        }
    });
    return { details: changes.join('، '), metadata: metadata, beforeSnapshot: oldItem, afterSnapshot: newItem };
}

function buildProductDetailsSummary(item) {
    return 'سعر الشراء: ' + fmt(item.purchasePrice) + '، سعر البيع: ' + fmt(item.salePrice) + '، الكمية: ' + (item.quantity || 0) + '، الفئة: ' + (item.categoryName || 'بدون فئة') + '، إخفاء المنتج: ' + (item.hidden ? 'نعم' : 'لا') + '، عرض السعر: ' + (item.showPrice ? 'نعم' : 'لا') + (item.discountEnabled ? '، الخصم: ' + fmt(item.discountValue) : '');
}

function buildCurrencyChangeDetails(oldSettings, newSettings) {
    var fields = [
        { key: 'secondaryCurrencyName', label: 'اسم العملة' },
        { key: 'secondaryCurrencySymbol', label: 'رمز العملة' },
        { key: 'exchangeRate', label: 'سعر الصرف', formatter: function(v) { return v === null || v === undefined ? '--' : fmt(v); } },
        { key: 'defaultInputCurrency', label: 'العملة الافتراضية للإدخال' },
        { key: 'defaultSellCurrency', label: 'العملة الافتراضية للبيع' }
    ];
    var changes = [];
    var metadata = {};
    function valuesDiffer(oldVal, newVal) {
        if (oldVal === newVal) return false;
        if (typeof oldVal === 'number' && typeof newVal === 'number' && isNaN(oldVal) && isNaN(newVal)) return false;
        if (typeof oldVal === 'object' || typeof newVal === 'object') {
            return JSON.stringify(oldVal) !== JSON.stringify(newVal);
        }
        return true;
    }
    fields.forEach(function(field) {
        var oldVal = oldSettings[field.key];
        var newVal = newSettings[field.key];
        if (valuesDiffer(oldVal, newVal)) {
            changes.push(field.label + ' من ' + formatActivityChangeValue(oldVal, field.formatter) + ' إلى ' + formatActivityChangeValue(newVal, field.formatter));
            metadata[field.key] = { from: oldVal, to: newVal };
        }
    });
    return { details: changes.join('، '), metadata: { changes: metadata, before: oldSettings, after: newSettings } };
}

function formatActivityDetails(details) {
    return escHtml(details || '');
}

function getActivityShortSummary(item) {
    if (item && item.shortSummary) return escHtml(item.shortSummary);
    switch (item && item.actionType) {
        case 'create': return 'إضافة منتج';
        case 'update': return 'تعديل منتج';
        case 'delete': return 'حذف';
        case 'sell': return 'بيع';
        case 'cancelSale': return 'إلغاء بيع';
        case 'archive': return 'أرشفة';
        case 'assign': return 'تعيين';
        case 'setting': return 'تعديل إعداد';
        case 'expenseAdd': return 'إضافة مصروف';
        case 'expenseDelete': return 'حذف مصروف';
        case 'sliderCreate': return 'إضافة سلايدر';
        case 'sliderUpdate': return 'تحديث سلايدر';
        case 'sliderHide': return 'إخفاء/إظهار سلايدر';
        case 'sliderDuplicate': return 'نسخ سلايدر';
        case 'sliderDelete': return 'حذف سلايدر';
        case 'currencyUpdate': return 'تعديل سعر الصرف';
        case 'storeUpdate': return 'تحديث بيانات المتجر';
        case 'targetUpdate': return 'تحديث الهدف';
        default: return item && item.details ? escHtml(item.details.split('،')[0]) : '--';
    }
}

function getActivityDisplayValue(value) {
    if (typeof value === 'string') return escHtml(value);
    return escHtml(JSON.stringify(value || '')); 
}

function getActivitySummaryCount(items, actionType) {
    return items.filter(function(item) { return item.actionType === actionType; }).length;
}

function getActivityPeriodLabel(period) {
    switch (period) {
        case 'today': return 'اليوم';
        case 'week': return 'هذا الأسبوع';
        case 'month': return 'هذا الشهر';
        case 'year': return 'هذه السنة';
        case 'custom': return 'مخصص';
        default: return 'الكل';
    }
}

function getActivityPeriodDates(period) {
    var now = Date.now();
    if (period === 'today') return { start: getStartOfDay(), end: now };
    if (period === 'week') return { start: getStartOfWeek(), end: now };
    if (period === 'month') return { start: getStartOfMonth(), end: now };
    if (period === 'year') return { start: getStartOfYear(), end: now };
    return { start: null, end: null };
}

function getActivityFilterPeriodTitle(period) {
    return getActivityPeriodLabel(period);
}

function getActivityTextSummary(items) {
    return items.length + ' سجل';
}

function getActivityTableRow(item, index) {
    return '<tr><td>' + (index + 1) + '</td><td>' + fmtDateTime(item.timestamp) + '</td><td>' + escHtml(getActivityLabel(item.actionType)) + '</td><td>' + escHtml(getEntityLabel(item.entity)) + '</td><td>' + getActivityShortSummary(item) + '</td><td>' + escHtml(item.user || '--') + '</td><td><button type="button" onclick="viewActivityLogDetail(\'' + escJsString(item.id) + '\')" style="background:var(--primary-light);color:var(--primary);border:none;border-radius:20px;padding:5px 12px;cursor:pointer;font-size:0.72rem;font-weight:600;">عرض</button></td></tr>';
}

function buildActivitySummaryCards(items) {
    var total = items.length;
    return '<div class="stat-card"><div class="stat-label">العمليات في الصفحة</div><div class="stat-value">' + total + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">إنشاء</div><div class="stat-value">' + getActivitySummaryCount(items, 'create') + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">تعديل</div><div class="stat-value">' + getActivitySummaryCount(items, 'update') + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">حذف</div><div class="stat-value">' + getActivitySummaryCount(items, 'delete') + '</div></div>';
}

function getCustomDateValue(ts) {
    return ts ? new Date(ts).toISOString().split('T')[0] : '';
}

function getActivityFilterInputDate(value, isEnd) {
    if (!value) return '';
    return new Date(value).toISOString().split('T')[0];
}

function getActivityFilterDateValue(ts) {
    if (!ts) return '';
    return new Date(ts).toISOString().split('T')[0];
}

function getActivityFilterDateString(ts) {
    return ts ? new Date(ts).toLocaleDateString('ar-EG') : '';
}

function getActivityRowCount(items) {
    return items.length;
}

function getActivityCardSubtitle(items) {
    return 'آخر تحديث: ' + fmtDateTime(Date.now());
}

function getFormattedActivityDetails(item) {
    var md = item.metadata || {};
    var metaText = '';
    for (var key in md) {
        if (md.hasOwnProperty(key)) {
            metaText += '<div><strong>' + escHtml(key) + ':</strong> ' + escHtml(JSON.stringify(md[key])) + '</div>';
        }
    }
    return '<div style="display:grid;gap:10px;">' +
        '<div><strong>الإجراء:</strong> ' + escHtml(getActivityLabel(item.actionType)) + '</div>' +
        '<div><strong>الكيان:</strong> ' + escHtml(getEntityLabel(item.entity)) + '</div>' +
        '<div><strong>التفاصيل:</strong> ' + formatActivityDetails(item.details) + '</div>' +
        '<div><strong>المستخدم:</strong> ' + escHtml(item.user || '--') + '</div>' +
        '<div><strong>الوقت:</strong> ' + fmtDateTime(item.timestamp) + '</div>' + metaText + '</div>';
}

function getActivityFilterValue(value) {
    return value || '';
}

function getActivityFilters() {
    return activityFilterParams;
}

function safeActivityInput(value) {
    return escHtml(value || '');
}

function formatActivityFilterPlaceholder(field) {
    switch (field) {
        case 'searchTerm': return 'بحث في التفاصيل أو المستخدم';
        default: return '';
    }
}

function getActivitySearchTerm(term) {
    return term || '';
}

function getActivityFilterOptions() {
    return {
        actionTypes: [
            { value: '', label: 'كل الإجراءات' },
            { value: 'create', label: 'إنشاء' },
            { value: 'update', label: 'تعديل' },
            { value: 'delete', label: 'حذف' },
            { value: 'sell', label: 'بيع' },
            { value: 'cancelSale', label: 'إلغاء بيع' },
            { value: 'archive', label: 'أرشفة' },
            { value: 'assign', label: 'تعيين' },
            { value: 'expenseAdd', label: 'إضافة مصروف' },
            { value: 'expenseDelete', label: 'حذف مصروف' },
            { value: 'sliderCreate', label: 'سلايدر' },
            { value: 'sliderUpdate', label: 'تحديث سلايدر' },
            { value: 'sliderHide', label: 'إخفاء/إظهار سلايدر' },
            { value: 'sliderDuplicate', label: 'نسخ سلايدر' },
            { value: 'sliderDelete', label: 'حذف سلايدر' },
            { value: 'currencyUpdate', label: 'تحديث العملة' },
            { value: 'storeUpdate', label: 'تحديث المتجر' },
            { value: 'targetUpdate', label: 'تحديث الهدف' }
        ],
        entities: [
            { value: '', label: 'كل الكيانات' },
            { value: 'item', label: 'منتج' },
            { value: 'sale', label: 'بيع' },
            { value: 'category', label: 'فئة' },
            { value: 'expense', label: 'مصروف' },
            { value: 'storeInfo', label: 'المتجر' },
            { value: 'currencySettings', label: 'إعدادات العملة' },
            { value: 'sliderItem', label: 'سلايدر' },
            { value: 'target', label: 'هدف' },
            { value: 'salesArchive', label: 'أرشيف المبيعات' }
        ]
    };
}

function buildActivityFilterSelect(options, selected) {
    return options.map(function(opt) { return '<option value="' + opt.value + '" ' + (selected === opt.value ? 'selected' : '') + '>' + escHtml(opt.label) + '</option>'; }).join('');
}

function getActivityFilterPeriodOptions() {
    return [
        { value: 'all', label: 'كل الفترات' },
        { value: 'today', label: 'اليوم' },
        { value: 'week', label: 'هذا الأسبوع' },
        { value: 'month', label: 'هذا الشهر' },
        { value: 'year', label: 'هذا السنة' },
        { value: 'custom', label: 'مخصص' }
    ];
}

function getExportActivityFilename() {
    return 'activity_log_' + new Date().toISOString().split('T')[0];
}

function formatActivityPdfTitle() {
    return 'تقرير سجل العمليات';
}

function getActivityTableHeaders() {
    return ['#', 'التاريخ', 'الإجراء', 'الكيان', 'التفاصيل', 'المستخدم'];
}

function buildActivityPdfRows(items) {
    return items.map(function(item, i) { return [i + 1, fmtDateTime(item.timestamp), getActivityLabel(item.actionType), getEntityLabel(item.entity), item.details || '', item.user || '']; });
}

function getActivitySearchPlaceholder() {
    return '🔍 بحث في السجل';
}

function getActivityFiltersRowHTML() {
    var options = getActivityFilterOptions();
    var sp = activityFilterParams;
    return '<select id="afPeriod" onchange="updateActivityFilter(\'period\',this.value)">' + buildActivityFilterSelect(getActivityFilterPeriodOptions(), sp.period) + '</select>' +
        '<select id="afActionType" onchange="updateActivityFilter(\'actionType\',this.value)">' + buildActivityFilterSelect(options.actionTypes, sp.actionType) + '</select>' +
        '<select id="afEntity" onchange="updateActivityFilter(\'entity\',this.value)">' + buildActivityFilterSelect(options.entities, sp.entity) + '</select>' +
        '<input type="text" id="afSearch" placeholder="' + getActivitySearchPlaceholder() + '" value="' + escHtml(sp.searchTerm) + '" oninput="debouncedActivitySearchUpdate(this.value)" style="max-width:220px;">' +
        '<input type="text" id="afUser" placeholder="المستخدم" value="' + escHtml(sp.user) + '" onchange="updateActivityFilter(\'user\',this.value)" style="max-width:150px;">' +
        (sp.period === 'custom' ? '<input type="text" class="date-input" readonly id="afCustomStart" placeholder="YYYY-MM-DD" value="' + (sp.customStart ? new Date(sp.customStart).toISOString().split('T')[0] : '') + '" onchange="updateActivityFilter(\'customStart\',parseDateString(this.value,false))" style="max-width:140px;margin-right:8px;">' +
            '<span style="font-weight:700;color:var(--text3);margin:0 8px;">إلى</span>' +
            '<input type="text" class="date-input" readonly id="afCustomEnd" placeholder="YYYY-MM-DD" value="' + (sp.customEnd ? new Date(sp.customEnd).toISOString().split('T')[0] : '') + '" onchange="updateActivityFilter(\'customEnd\',parseDateString(this.value,true))" style="max-width:140px;">' : '') +
        '<button class="btn-sm outline" onclick="resetActivityFilters()">مسح الفلاتر</button>';
}

function getActivityLabelForExport(type) {
    return getActivityLabel(type);
}

function getEntityLabelForExport(entity) {
    return getEntityLabel(entity);
}

function getActivityCsvRow(item, index) {
    return [index + 1, fmtDateTime(item.timestamp), getActivityLabelForExport(item.actionType), getEntityLabelForExport(item.entity), item.details || '', item.user || ''];
}

function getActivityPdfBody(items) {
    return buildActivityPdfRows(items);
}

function getActivityExportRows(items) {
    return items.map(getActivityCsvRow);
}

function getActivityExportHeaders() {
    return getActivityTableHeaders();
}

function getCurrentUserEmail() {
    return (auth.currentUser && auth.currentUser.email) ? auth.currentUser.email : 'unknown';
}

function updateActivityFilterField(key, value) {
    activityFilterParams[key] = value;
    activityPage = 0;
    activityQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
    renderActivityLog();
}

function getActivitySearchPhrase(value) {
    return value || '';
}

function getActivityDetailsValue(value) {
    return value || '--';
}

function buildActivityQueryForFilter(query, params) {
    if (params.actionType) query = query.where('actionType', '==', params.actionType);
    if (params.entity) query = query.where('entity', '==', params.entity);
    if (params.user) query = query.where('user', '==', params.user);
    return query;
}

function activityMatchesSearch(item, term) {
    if (!term) return true;
    term = term.toLowerCase();
    return (item.details || '').toLowerCase().includes(term) || (item.user || '').toLowerCase().includes(term) || (item.entity || '').toLowerCase().includes(term) || (item.actionType || '').toLowerCase().includes(term);
}

function buildActivitySearchPlaceholder() {
    return 'بحث في النشاط';
}

function getActivityPageLabel() {
    return 'صفحة ' + (activityPage + 1);
}

function getActivityCurrentPageItems() {
    return activityQueryCache.currentPageItems || [];
}

function getActivityDetailFields(item) {
    return item || {};
}

function formatActivityMetadata(metadata) {
    function renderValue(value) {
        if (value === null || value === undefined) return '--';
        if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
        if (Array.isArray(value)) return value.length ? value.map(renderValue).join(', ') : 'لا يوجد';
        if (typeof value === 'object') return null;
        return escHtml(String(value));
    }
    function renderObject(obj, depth) {
        var html = '<div style="margin-left:' + (depth * 12) + 'px;">';
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                var value = obj[key];
                var rendered = renderValue(value);
                if (rendered === null) {
                    html += '<div><strong>' + escHtml(key) + ':</strong></div>' + renderObject(value, depth + 1);
                } else {
                    html += '<div><strong>' + escHtml(key) + ':</strong> ' + rendered + '</div>';
                }
            }
        }
        html += '</div>';
        return html;
    }
    return renderObject(metadata, 0);
}

function writeActivityModalContent(item) {
    document.getElementById('activityDetailContent').innerHTML = '<div style="display:grid;gap:10px;">' +
        '<div><strong>التاريخ:</strong> ' + fmtDateTime(item.timestamp) + '</div>' +
        '<div><strong>الإجراء:</strong> ' + escHtml(getActivityLabel(item.actionType)) + '</div>' +
        '<div><strong>الكيان:</strong> ' + escHtml(getEntityLabel(item.entity)) + '</div>' +
        '<div><strong>المعرف:</strong> ' + escHtml(item.entityId || '--') + '</div>' +
        '<div><strong>المستخدم:</strong> ' + escHtml(item.user || '--') + '</div>' +
        '<div><strong>التفاصيل:</strong> ' + formatActivityDetails(item.details) + '</div>' +
        (item.metadata ? '<div><strong>البيانات الإضافية:</strong>' + formatActivityMetadata(item.metadata) + '</div>' : '') +
        '</div>';
}

function getFormattedActivityModalContent(item) {
    return item ? writeActivityModalContent(item) : '';
}

function getActivityFilterDateValueOrEmpty(ts) {
    return ts ? new Date(ts).toISOString().split('T')[0] : '';
}

function buildActivityFilterRow() {
    if (!document.getElementById('activityFilterRow')) return;
    document.getElementById('activityFilterRow').innerHTML = getActivityFiltersRowHTML();
}

// Wheel picker implementation for Day / Month / Year spinner
function initActivityWheelPickers(startTs, endTs) {
    try {
        var startContainer = document.getElementById('afCustomStartPicker');
        var endContainer = document.getElementById('afCustomEndPicker');
        var now = Date.now();
        createWheelPicker(startContainer, startTs || now, function(ts) { updateActivityFilter('customStart', ts); });
        createWheelPicker(endContainer, endTs || now, function(ts) { updateActivityFilter('customEnd', ts); }, true);
    } catch (e) {
        console.warn('Wheel picker init failed', e);
    }
}

// Initialize comparison section wheel pickers (4 pickers: start1,end1,start2,end2)
function initComparisonWheelPickers(s1, e1, s2, e2) {
    try {
        var c1 = document.getElementById('compStart1Picker');
        var c2 = document.getElementById('compEnd1Picker');
        var c3 = document.getElementById('compStart2Picker');
        var c4 = document.getElementById('compEnd2Picker');
        var now = Date.now();
        createWheelPicker(c1, s1 || (now - 7*24*3600*1000), function(ts) {}, false);
        createWheelPicker(c2, e1 || now, function(ts) {}, true);
        createWheelPicker(c3, s2 || (now - 14*24*3600*1000), function(ts) {}, false);
        createWheelPicker(c4, e2 || (now - 7*24*3600*1000), function(ts) {}, true);
    } catch (e) { console.warn('initComparisonWheelPickers error', e); }
}

function createWheelPicker(container, ts, onChange, endOfDay) {
    if (!container) return;
    container.innerHTML = '';
    var date = new Date(ts || Date.now());

    // Create display label (fixed) and hidden columns
    var display = document.createElement('div'); display.className = 'wheel-display';
    var displayText = document.createElement('span'); displayText.className = 'wheel-display-text';
    display.appendChild(displayText);
    var colsWrap = document.createElement('div'); colsWrap.className = 'wheel-columns'; colsWrap.style.display = 'none';

    var dayCol = document.createElement('div'); dayCol.className = 'wheel-column';
    var monthCol = document.createElement('div'); monthCol.className = 'wheel-column';
    var yearCol = document.createElement('div'); yearCol.className = 'wheel-column';

    // populate days
    for (var d = 1; d <= 31; d++) { var div = document.createElement('div'); div.className = 'wheel-item'; div.dataset.val = d; div.innerText = d; dayCol.appendChild(div); }
    // months (Arabic short names)
    var months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    for (var m = 1; m <= 12; m++) { var md = document.createElement('div'); md.className = 'wheel-item'; md.dataset.val = m; md.innerText = months[m-1]; monthCol.appendChild(md); }
    // years range
    var curYear = date.getFullYear();
    var startYear = curYear - 10; var endYear = curYear + 5;
    for (var y = startYear; y <= endYear; y++) { var yd = document.createElement('div'); yd.className = 'wheel-item'; yd.dataset.val = y; yd.innerText = y; yearCol.appendChild(yd); }

    colsWrap.appendChild(dayCol); colsWrap.appendChild(monthCol); colsWrap.appendChild(yearCol);
    container.appendChild(display); container.appendChild(colsWrap);

    function updateDisplayText(dt) {
        var d = dt.getDate(); var m = dt.getMonth() + 1; var y = dt.getFullYear();
        displayText.innerText = d + '/' + m + '/' + y;
    }

    // helper to snap and detect selected value
    function snapToClosest(col) {
        var items = Array.from(col.querySelectorAll('.wheel-item'));
        var box = col.getBoundingClientRect();
        var center = box.top + box.height/2;
        var closest = items.reduce(function(prev, cur) {
            var r = cur.getBoundingClientRect(); var dist = Math.abs((r.top + r.height/2) - center);
            return (prev.dist === undefined || dist < prev.dist) ? { node: cur, dist: dist } : prev;
        }, {});
        if (closest && closest.node) {
            closest.node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }

    var debounceTimer;
    function onScrollHandler() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
            snapToClosest(dayCol); snapToClosest(monthCol); snapToClosest(yearCol);
            var sel = getWheelSelectedDate(container, endOfDay);
            if (sel && onChange) onChange(sel);
            if (sel) updateDisplayText(new Date(sel));
        }, 120);
    }

    dayCol.addEventListener('scroll', onScrollHandler);
    monthCol.addEventListener('scroll', onScrollHandler);
    yearCol.addEventListener('scroll', onScrollHandler);

    // clicking the display toggles the columns
    display.addEventListener('click', function(e) {
        if (colsWrap.style.display === 'none') {
            colsWrap.style.display = 'flex';
            // ensure columns are centered on current date
            setWheelToDate(container, date);
        } else {
            colsWrap.style.display = 'none';
        }
    });

    // set initial scroll to given date and display text
    setWheelToDate(container, date);
    updateDisplayText(date);
}

function getWheelSelectedDate(container, endOfDay) {
    if (!container) return null;
    var dayCol = container.children[0]; var monthCol = container.children[1]; var yearCol = container.children[2];
    function selectedFromCol(col) {
        var items = Array.from(col.querySelectorAll('.wheel-item'));
        var box = col.getBoundingClientRect(); var center = box.top + box.height/2;
        var closest = items.reduce(function(prev, cur) {
            var r = cur.getBoundingClientRect(); var dist = Math.abs((r.top + r.height/2) - center);
            return (prev.dist === undefined || dist < prev.dist) ? { node: cur, dist: dist } : prev;
        }, {});
        return closest && closest.node ? parseInt(closest.node.dataset.val,10) : null;
    }
    var d = selectedFromCol(dayCol) || 1;
    var m = selectedFromCol(monthCol) || 1;
    var y = selectedFromCol(yearCol) || new Date().getFullYear();
    var dt = new Date(y, m-1, d);
    if (endOfDay) dt.setHours(23,59,59,999); else dt.setHours(0,0,0,0);
    return dt.getTime();
}

function setWheelToDate(container, date) {
    if (!container) return;
    var d = date.getDate(); var m = date.getMonth() + 1; var y = date.getFullYear();
    var cols = [container.children[0], container.children[1], container.children[2]];
    function scrollToValue(col, val) {
        var item = Array.from(col.querySelectorAll('.wheel-item')).find(function(it){ return String(it.dataset.val) === String(val); });
        if (item) item.scrollIntoView({ block: 'center' });
    }
    scrollToValue(cols[0], d); scrollToValue(cols[1], m); scrollToValue(cols[2], y);
}

var datePickerState = {
    activeInput: null,
    overlay: null,
    dayInput: null,
    monthInput: null,
    yearInput: null
};

function initDatePickerPopup() {
    var overlay = document.getElementById('datePickerOverlay');
    if (!overlay) return;
    datePickerState.overlay = overlay;
    datePickerState.dayInput = document.getElementById('datePickerDay');
    datePickerState.monthInput = document.getElementById('datePickerMonth');
    datePickerState.yearInput = document.getElementById('datePickerYear');

    // Auto-navigation and input sanitation for day/month/year fields
    function sanitizeDigits(el, maxLen) {
        if (!el) return;
        var v = String(el.value || '').replace(/[^0-9]/g, '');
        if (v.length > maxLen) v = v.slice(0, maxLen);
        if (el.value !== v) el.value = v;
    }

    if (datePickerState.dayInput) {
        datePickerState.dayInput.addEventListener('input', function() {
            sanitizeDigits(this, 2);
            if (this.value.length >= 2) {
                datePickerState.monthInput && datePickerState.monthInput.focus();
            }
        });
        datePickerState.dayInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                datePickerState.monthInput && datePickerState.monthInput.focus();
            }
        });
    }
    if (datePickerState.monthInput) {
        datePickerState.monthInput.addEventListener('input', function() {
            sanitizeDigits(this, 2);
            if (this.value.length >= 2) {
                datePickerState.yearInput && datePickerState.yearInput.focus();
            }
        });
        datePickerState.monthInput.addEventListener('keydown', function(e) {
            if (e.key === 'Backspace' && (!this.value || this.value.length === 0)) {
                datePickerState.dayInput && datePickerState.dayInput.focus();
            }
            if (e.key === 'Enter') {
                datePickerState.yearInput && datePickerState.yearInput.focus();
            }
        });
    }
    if (datePickerState.yearInput) {
        datePickerState.yearInput.addEventListener('input', function() {
            sanitizeDigits(this, 4);
            // auto-confirm when full year entered
            if (this.value.length >= 4) {
                var sel = getPickerDate();
                if (sel && datePickerState.activeInput) {
                    datePickerState.activeInput.value = formatDateInputValue(sel);
                    datePickerState.activeInput.dispatchEvent(new Event('change', { bubbles: true }));
                    closeDatePicker();
                }
            }
        });
        datePickerState.yearInput.addEventListener('keydown', function(e) {
            if (e.key === 'Backspace' && (!this.value || this.value.length === 0)) {
                datePickerState.monthInput && datePickerState.monthInput.focus();
            }
            if (e.key === 'Enter') {
                var sel = getPickerDate();
                if (sel && datePickerState.activeInput) {
                    datePickerState.activeInput.value = formatDateInputValue(sel);
                    datePickerState.activeInput.dispatchEvent(new Event('change', { bubbles: true }));
                    closeDatePicker();
                }
            }
        });
    }

    document.addEventListener('click', function(e) {
        var dateInput = e.target.closest('.date-input');
        if (!dateInput) return;
        if (datePickerState.overlay.contains(e.target)) return;
        e.preventDefault();
        openDatePicker(dateInput);
    });

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            closeDatePicker();
        }
    });

    var confirmBtn = document.getElementById('datePickerConfirmBtn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', function() {
            if (!datePickerState.activeInput) return;
            var selected = getPickerDate();
            if (!selected) {
                showToast('الرجاء إدخال تاريخ صالح', 'error');
                return;
            }
            datePickerState.activeInput.value = formatDateInputValue(selected);
            datePickerState.activeInput.dispatchEvent(new Event('change', { bubbles: true }));
            closeDatePicker();
        });
    }
}

function openDatePicker(input) {
    if (!datePickerState.overlay) return;
    datePickerState.activeInput = input;
    var parsed = parseDateString(input.value, false);
    if (parsed) {
        var date = new Date(parsed);
        datePickerState.dayInput.value = padNumber(date.getDate());
        datePickerState.monthInput.value = padNumber(date.getMonth() + 1);
        datePickerState.yearInput.value = date.getFullYear();
    } else {
        datePickerState.dayInput.value = '';
        datePickerState.monthInput.value = '';
        datePickerState.yearInput.value = '';
    }
    datePickerState.overlay.classList.remove('hidden');
    datePickerState.dayInput.focus();
}

function closeDatePicker() {
    if (!datePickerState.overlay) return;
    datePickerState.overlay.classList.add('hidden');
    datePickerState.activeInput = null;
}

function getPickerDate() {
    if (!datePickerState.dayInput || !datePickerState.monthInput || !datePickerState.yearInput) return null;
    var day = parseInt(datePickerState.dayInput.value, 10);
    var month = parseInt(datePickerState.monthInput.value, 10);
    var year = parseInt(datePickerState.yearInput.value, 10);
    if (!year || !month || !day) return null;
    if (month < 1 || month > 12) return null;
    var maxDay = new Date(year, month, 0).getDate();
    if (day < 1 || day > maxDay) return null;
    var selected = new Date(year, month - 1, day);
    if (isNaN(selected.getTime())) return null;
    selected.setHours(0, 0, 0, 0);
    return selected;
}

function padNumber(value) {
    return value < 10 ? '0' + value : String(value);
}

function formatDateInputValue(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
}

function getActivityPageSummary(items) {
    return {
        total: items.length,
        create: getActivitySummaryCount(items, 'create'),
        update: getActivitySummaryCount(items, 'update'),
        delete: getActivitySummaryCount(items, 'delete')
    };
}

function getActivitySummaryHtml(items) {
    return buildActivitySummaryCards(items);
}

function getActivityFooter() {
    return '';
}

function getActivityPaginationButtons() {
    var html = '';
    html += '<button ' + (activityPage === 0 ? 'disabled' : '') + ' onclick="goToActivityPage(' + (activityPage - 1) + ')"><i class="fas fa-chevron-right"></i></button>';
    html += '<button class="active">' + (activityPage + 1) + '</button>';
    html += '<button ' + (!activityQueryCache.hasMore ? 'disabled' : '') + ' onclick="goToActivityPage(' + (activityPage + 1) + ')"><i class="fas fa-chevron-left"></i></button>';
    return html;
}

function getActivityRowsHtml(items) {
    if (!items.length) return '<tr><td colspan="7" style="padding:30px;color:var(--text3);">لا توجد سجلات</td></tr>';
    return items.map(function(item, i) { return getActivityTableRow(item, i); }).join('');
}

function getActivitySectionElements() {
    return {
        summary: document.getElementById('activitySummaryGrid'),
        body: document.getElementById('activityLogBody'),
        pagination: document.getElementById('activityPagination')
    };
}

function updateActivitySectionUI(items) {
    var els = getActivitySectionElements();
    if (!els.body || !els.pagination) return;
    if (els.summary) els.summary.innerHTML = getActivitySummaryHtml(items);
    els.body.innerHTML = getActivityRowsHtml(items);
    els.pagination.innerHTML = getActivityPaginationButtons();
}

function getActivityExportFilenameWithDate() {
    return getExportActivityFilename();
}

function getActivityPdfHeaderConfig() {
    return {
        head: [getActivityTableHeaders()],
        body: getActivityPdfBody(getCurrentActivityPageItems())
    };
}

function getCurrentActivityPageItems() {
    return activityQueryCache.currentPageItems || [];
}

function getActivityExportData() {
    return getCurrentActivityPageItems();
}

function buildActivityCsvData(rows) {
    return rows.map(function(r) { return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
}

function getActivityCsvBlob(rows) {
    return new Blob(['\uFEFF' + buildActivityCsvData(rows)], { type: 'text/csv;charset=utf-8;' });
}

function getActivityExportAnchor(filename, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

function getActivityExportFileName(filename) {
    return filename + '.csv';
}

function getActivityPdfFileName(filename) {
    return filename + '.pdf';
}

async function fetchActivityPage() {
    var sp = activityFilterParams;
    var query = db.collection('activityLog').orderBy('timestamp', 'desc');
    if (sp.period === 'today') { var ds = getStartOfDay(); query = query.where('timestamp', '>=', ds); }
    else if (sp.period === 'week') { var ws = getStartOfWeek(); query = query.where('timestamp', '>=', ws); }
    else if (sp.period === 'month') { var ms = getStartOfMonth(); query = query.where('timestamp', '>=', ms); }
    else if (sp.period === 'year') { var ys = getStartOfYear(); query = query.where('timestamp', '>=', ys); }
    else if (sp.period === 'custom' && sp.customStart) { query = query.where('timestamp', '>=', sp.customStart); if (sp.customEnd) query = query.where('timestamp', '<=', sp.customEnd); }
    if (sp.actionType) query = query.where('actionType', '==', sp.actionType);
    if (sp.entity) query = query.where('entity', '==', sp.entity);
    if (sp.user) query = query.where('user', '==', sp.user);
    query = query.limit(activityPageSize);
    if (activityPage > 0 && activityQueryCache.lastDoc) query = query.startAfter(activityQueryCache.lastDoc);
    try {
        var snap = await query.get();
        var rawItems = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
        if (sp.searchTerm) { var term = sp.searchTerm.toLowerCase(); rawItems = rawItems.filter(function(item) { return activityMatchesSearch(item, term); }); }
        activityQueryCache.currentPageItems = rawItems;
        activityQueryCache.lastDoc = snap.docs.length === activityPageSize ? snap.docs[snap.docs.length - 1] : null;
        activityQueryCache.hasMore = snap.docs.length === activityPageSize;
    } catch (e) {
        activityQueryCache.currentPageItems = [];
        activityQueryCache.hasMore = false;
        showFirestoreError(e, 'تعذّر تحميل سجل العمليات');
    }
}

function renderActivityLog() {
    activityPage = Math.max(0, activityPage);
    buildActivityFilterRow();
    fetchActivityPage().then(function() {
        updateActivitySectionUI(activityQueryCache.currentPageItems);
    });
}

function renderActivityPagination() {
    if (!document.getElementById('activityPagination')) return;
    document.getElementById('activityPagination').innerHTML = getActivityPaginationButtons();
}

function goToActivityPage(p) {
    activityPage = p;
    activityQueryCache.lastDoc = p > 0 ? activityQueryCache.lastDoc : null;
    renderActivityLog();
}

function debouncedActivitySearchUpdate(value) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(function() { updateActivityFilter('searchTerm', value); }, 400);
}

function updateActivityFilter(key, value) {
    activityFilterParams[key] = value;
    activityPage = 0;
    activityQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
    renderActivityLog();
}

function resetActivityFilters() {
    activityFilterParams = { period: 'all', searchTerm: '', actionType: '', entity: '', user: '', customStart: null, customEnd: null };
    activityPage = 0;
    activityQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
    renderActivityLog();
}

function viewActivityLogDetail(recordId) {
    var item = activityQueryCache.currentPageItems.find(function(it) { return it.id === recordId; });
    if (!item) return;
    writeActivityModalContent(item);
    document.getElementById('activityDetailModal').classList.add('show');
}

window.viewActivityLogDetail = viewActivityLogDetail;

function exportActivityLogToCSV() {
    var items = getCurrentActivityPageItems();
    var rows = [getActivityExportHeaders()].concat(getActivityExportRows(items));
    var blob = getActivityCsvBlob(rows);
    getActivityExportAnchor(getActivityExportFileName(getActivityExportFilenameWithDate()), blob);
    showToast('✅ تم تصدير سجل العمليات CSV');
}

function exportActivityLogToPDF() {
    var items = getCurrentActivityPageItems();
    var doc = new jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFont('Cairo');
    doc.setFontSize(16);
    doc.text(formatActivityPdfTitle(), 140, 15, { align: 'center' });
    doc.setFontSize(10);
    doc.text('تاريخ التصدير: ' + fmtDateTime(Date.now()) + ' | عدد السجلات: ' + items.length, 14, 22);
    doc.autoTable({
        head: [getActivityTableHeaders()],
        body: getActivityPdfBody(items),
        startY: 26,
        styles: { font: 'Cairo', fontSize: 9, halign: 'center' },
        headStyles: { fillColor: [43, 108, 176] }
    });
    doc.save(getActivityPdfFileName(getActivityExportFilenameWithDate()));
    showToast('✅ تم تنزيل PDF لسجل العمليات');
}

function getActivityExportButtonListeners() {
    var csvBtn = document.getElementById('exportActivityCsvBtn');
    var pdfBtn = document.getElementById('exportActivityPdfBtn');
    if (csvBtn) csvBtn.addEventListener('click', exportActivityLogToCSV);
    if (pdfBtn) pdfBtn.addEventListener('click', exportActivityLogToPDF);
}

getActivityExportButtonListeners();

function getCachedData(key) {
    try { var raw = localStorage.getItem('xmetal_cache_' + key); if (raw) { var p = JSON.parse(raw); if (Date.now() - p.ts < CACHE_TTL) return p.data; } } catch (e) {}
    return null;
}
function setCachedData(key, data) {
    try { localStorage.setItem('xmetal_cache_' + key, JSON.stringify({ data: data, ts: Date.now() })); } catch (
    e) {}
}
function clearAllCaches() {
    ['items', 'categories', 'expenses', 'sales_full'].forEach(function(k) { localStorage.removeItem(
            'xmetal_cache_' + k); });
}
function applyDarkMode() {
    if (darkMode) document.body.classList.add('dark-mode');
    else document.body.classList.remove('dark-mode');
    document.getElementById('darkToggle').textContent = darkMode ? '☀️' : '🌙';
    localStorage.setItem('xmetalDarkMode', darkMode);
}
function getStartOfDay(d) { d = d || new Date(); var off = 3 * 3600000,
        g = d.getTime() + off; var y = new Date(g).getUTCFullYear(),
        m = new Date(g).getUTCMonth(), day = new Date(g).getUTCDate(); return Date.UTC(y, m, day, 0, 0, 0) -
    off; }
function getStartOfWeek(d) { d = d || new Date(); var s = getStartOfDay(d),
        off = 3 * 3600000,
        g = new Date(s + off); return s - (g.getUTCDay() * 86400000); }
function getStartOfMonth(d) { d = d || new Date(); var s = getStartOfDay(d),
        off = 3 * 3600000,
        g = new Date(s + off); return Date.UTC(g.getUTCFullYear(), g.getUTCMonth(), 1, 0, 0, 0) - off; }
function getStartOfYear(d) { d = d || new Date(); var s = getStartOfDay(d),
        off = 3 * 3600000,
        g = new Date(s + off); return Date.UTC(g.getUTCFullYear(), 0, 1, 0, 0, 0) - off; }
function getExpensesSum(start, end) { start = start || 0;
    end = end || (Date.now() + 86400000); return allExpenses.filter(function(e) { return e.date >= start && e.date <
            end; }).reduce(function(a, e) { return a + (e.amount || 0); }, 0); }
function convertToSecondary(a) { return a * currencySettings.exchangeRate; }
function convertToPrimary(a) { return a / currencySettings.exchangeRate; }
function getConversionDisplay(value, isInputSecondary, symbol) {
    if (isInputSecondary) { return fmt(value) + ' ' + symbol + ' (≈ $' + convertToPrimary(value).toFixed(2) + ')'; }
    return fmt(convertToSecondary(value)) + ' ' + symbol;
}
function updateProductPriceDisplay() {
    var p = parseFloat(document.getElementById('purchasePrice') ? document.getElementById('purchasePrice').value :
        0) || 0;
    var s = parseFloat(document.getElementById('salePrice') ? document.getElementById('salePrice').value : 0) || 0;
    var sym = currencySettings.secondaryCurrencySymbol;
    var pEl = document.getElementById('purchasePriceSecondary');
    var sEl = document.getElementById('salePriceSecondary');
    if (pEl) pEl.innerText = getConversionDisplay(p, tempPurchaseCurrency, sym);
    if (sEl) sEl.innerText = getConversionDisplay(s, tempSaleCurrency, sym);
}
function updateSellPriceDisplay() {
    var v = parseFloat(document.getElementById('sellPrice') ? document.getElementById('sellPrice').value : 0) || 0;
    var el = document.getElementById('sellPriceSecondaryInfo');
    if (el) el.innerText = getConversionDisplay(v, tempSellCurrency, currencySettings.secondaryCurrencySymbol);
}
function updateEditSalePriceDisplay() {
    var v = parseFloat(document.getElementById('editPrice') ? document.getElementById('editPrice').value : 0) || 0;
    var el = document.getElementById('editPriceSecondaryInfo');
    if (el) el.innerText = getConversionDisplay(v, tempEditCurrency, currencySettings.secondaryCurrencySymbol);
}
function updatePriceLabels() {
    var sym = currencySettings.secondaryCurrencySymbol;
    var pel = document.getElementById('purchasePriceLabel');
    var sel = document.getElementById('salePriceLabel');
    var spl = document.getElementById('sellPriceLabel');
    var epl = document.getElementById('editPriceLabel');
    if (pel) pel.innerHTML = 'سعر الشراء (' + (tempPurchaseCurrency ? sym : '$') + ')';
    if (sel) sel.innerHTML = 'سعر البيع (' + (tempSaleCurrency ? sym : '$') + ')';
    if (spl) spl.innerHTML = 'السعر (' + (tempSellCurrency ? currencySettings.secondaryCurrencySymbol : '$') + ')';
    if (epl) epl.innerHTML = 'السعر (' + (tempEditCurrency ? currencySettings.secondaryCurrencySymbol : '$') + ')';
}
function closeMobileSidebar() {
    var sidebar = document.getElementById('sidebar');
    var backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('show');
}

document.getElementById('mobileMenuBtn').addEventListener('click', function() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarBackdrop').classList.toggle('show');
});
document.getElementById('sidebarBackdrop').addEventListener('click', closeMobileSidebar);

document.querySelectorAll('#sidebarNav button').forEach(function(btn) {
    btn.addEventListener('click', function() {
        document.querySelectorAll('#sidebarNav button').forEach(function(b) { b.classList
                .remove('active'); });
        btn.classList.add('active');
        currentSection = btn.dataset.section;
        salesPage = 0;
        salesQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
        destroyAllCharts();
        renderCurrentSection();
        document.getElementById('pageTitle').textContent = btn.textContent.trim();
        closeMobileSidebar();
    });
});

document.getElementById('sidebarLogoutBtn').addEventListener('click', function() {
    closeMobileSidebar();
    auth.signOut();
});
document.getElementById('exportPdfBtn').addEventListener('click', function() { closeMobileSidebar();
    exportToPDF(); });
document.getElementById('exportExcelBtn').addEventListener('click', function() { closeMobileSidebar();
    exportToCSV(); });
document.getElementById('printReportBtn').addEventListener('click', function() { closeMobileSidebar();
    window.print(); });

document.getElementById('darkToggle').addEventListener('click', function() {
    darkMode = !darkMode;
    applyDarkMode();
    destroyAllCharts();
    renderCurrentSection();
});
document.getElementById('currencyToggleBtn').addEventListener('click', function() {
    displaySecondaryCurrency = !displaySecondaryCurrency;
    localStorage.setItem('xmetalDisplaySecondary', displaySecondaryCurrency);
    document.getElementById('currencyLabel').textContent = displaySecondaryCurrency ? currencySettings
        .secondaryCurrencySymbol : '$';
    destroyAllCharts();
    renderCurrentSection();
});
document.getElementById('targetSalesBtn').addEventListener('click', function() {
    document.getElementById('targetSalesInput').value = salesTarget;
    document.getElementById('targetModal').classList.add('show');
});
document.getElementById('saveTargetBtn').addEventListener('click', async function() {
    salesTarget = parseFloat(document.getElementById('targetSalesInput').value) || 0;
    localStorage.setItem('xmetalSalesTarget', salesTarget);
    await logActivity('targetUpdate', 'target', 'daily', 'تحديث هدف المبيعات اليومي: ' + salesTarget, { target: salesTarget });
    closeModalById('targetModal');
    showToast('تم حفظ الهدف');
});

document.getElementById('doLoginBtn').addEventListener('click', function() {
    var em = document.getElementById('loginEmail').value.trim();
    var pw = document.getElementById('loginPassword').value.trim();
    if (!em || !pw) { document.getElementById('loginErrorMsg').style.display = 'block';
        document.getElementById('loginErrorMsg').textContent = 'يرجى إدخال البيانات'; return; }
    document.getElementById('loginErrorMsg').style.display = 'none';
    auth.signInWithEmailAndPassword(em, pw).catch(function(e) {
        document.getElementById('loginErrorMsg').style.display = 'block';
        document.getElementById('loginErrorMsg').textContent = 'فشل: ' + e.message;
    });
});

auth.onAuthStateChanged(async function(user) {
    if (user) {
        document.getElementById('loginOverlay').classList.add('hidden');
        await initApp();
    } else {
        document.getElementById('loginOverlay').classList.remove('hidden');
        detachRealtimeListeners();
    }
});

async function initApp() {
    detachRealtimeListeners();
    allSalesFullLoaded = false;
    hasFetchedSales = false;
    await Promise.all([fetchInitialSales(), fetchItemsSmart(), fetchCategoriesSmart(),
        fetchCurrencySettings(), fetchStoreInfo(), fetchExpensesSmart(), fetchSliderItems()
    ]);
    applyDarkMode();
    document.getElementById('currencyLabel').textContent = displaySecondaryCurrency ? currencySettings
        .secondaryCurrencySymbol : '$';
    renderCurrentSection();
    initDatePickerPopup();
    document.getElementById('lastUpdatedLabel').textContent = 'آخر تحديث: ' + fmtDateTime(Date.now());
    attachRealtimeListeners();
}

function detachRealtimeListeners() {
    realtimeListeners.forEach(function(unsub) { try { unsub(); } catch (e) {} });
    realtimeListeners = [];
}

function attachRealtimeListeners() {
    var todayStart = getStartOfDay();
    var unsubSales = db.collection('sales').where('timestamp', '>=', todayStart).orderBy('timestamp', 'desc')
        .onSnapshot(function(snap) {
            var changed = false;
            snap.docChanges().forEach(function(change) {
                var data = { saleId: change.doc.id, ...change.doc.data() };
                if (change.type === 'added') {
                    var exists = allSales.findIndex(function(s) { return s.saleId ===
                        data.saleId; });
                    if (exists === -1) { allSales.unshift(data);
                        changed = true; }
                } else if (change.type === 'modified') {
                    var idx = allSales.findIndex(function(s) { return s.saleId === data
                            .saleId; });
                    if (idx !== -1) { allSales[idx] = data;
                        changed = true; }
                } else if (change.type === 'removed') {
                    var before = allSales.length;
                    allSales = allSales.filter(function(s) { return s.saleId !== data.saleId; });
                    if (allSales.length !== before) changed = true;
                }
            });
            if (changed && (currentSection === 'dashboard' || currentSection === 'insights' ||
                    currentSection === 'profitAnalysis')) { renderCurrentSection(); }
            checkSalesTarget();
            document.getElementById('lastUpdatedLabel').textContent = 'آخر تحديث: ' + fmtDateTime(Date
                .now());
        });
    realtimeListeners.push(unsubSales);
}

function checkSalesTarget() {
    if (!salesTarget || salesTarget <= 0) return;
    var ds = getStartOfDay();
    var todayRevenue = allSales.filter(function(s) { return s.timestamp >= ds; }).reduce(function(a, s) { return a +
            (s.totalAmount || 0); }, 0);
    if (todayRevenue >= salesTarget && !window._targetAlertShown) {
        window._targetAlertShown = true;
        showToast('🎯 تم تحقيق هدف المبيعات اليومي! الإيرادات: ' + formatMoney(todayRevenue));
        setTimeout(function() { window._targetAlertShown = false; }, 60000);
    }
}

async function fetchInitialSales() {
    try {
        var oneYearAgo = Date.now() - 365 * 86400000;
        var snap = await db.collection('sales').where('timestamp', '>=', oneYearAgo).orderBy('timestamp',
            'desc').limit(1000).get();
        allSales = snap.docs.map(function(d) { return { saleId: d.id, ...d.data() }; });
        allSalesFullLoaded = false;
    } catch (e) { allSales = []; }
}

async function ensureFullSalesData() {
    if (allSalesFullLoaded) return;
    toggleLoading(true);
    try {
        var snap = await db.collection('sales').orderBy('timestamp', 'desc').get();
        var fullData = snap.docs.map(function(d) { return { saleId: d.id, ...d.data() }; });
        var existingIds = new Set(allSales.map(function(s) { return s.saleId; }));
        var newEntries = fullData.filter(function(s) { return !existingIds.has(s.saleId); });
        if (newEntries.length > 0 || fullData.length > allSales.length) { allSales = fullData; }
        allSalesFullLoaded = true;
        setCachedData('sales_full', allSales);
    } catch (e) {}
    toggleLoading(false);
}

async function fetchItemsSmart() {
    var cached = getCachedData('items');
    if (cached) { allItems = cached; return; }
    try {
        var snap = await db.collection('items').get();
        allItems = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
        setCachedData('items', allItems);
    } catch (e) { allItems = []; }
}

async function fetchCategoriesSmart() {
    var cached = getCachedData('categories');
    if (cached) { allCategories = cached; return; }
    try {
        var snap = await db.collection('categories').get();
        allCategories = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
        setCachedData('categories', allCategories);
    } catch (e) { allCategories = []; }
}

async function fetchCurrencySettings() {
    try {
        var d = await db.collection('currencySettings').doc('settings').get();
        if (d.exists) currencySettings = { ...currencySettings, ...d.data() };
    } catch (e) {}
    document.getElementById('secondaryCurrencyName').value = currencySettings.secondaryCurrencyName;
    document.getElementById('secondaryCurrencySymbol').value = currencySettings.secondaryCurrencySymbol;
    document.getElementById('exchangeRate').value = currencySettings.exchangeRate;
    var diRadios = document.querySelectorAll('input[name="defaultInputCurrency"]');
    diRadios.forEach(function(r) { if (r.value === currencySettings.defaultInputCurrency) r.checked = true; });
    var dsRadios = document.querySelectorAll('input[name="defaultSellCurrency"]');
    dsRadios.forEach(function(r) { if (r.value === currencySettings.defaultSellCurrency) r.checked = true; });
    tempPurchaseCurrency = (currencySettings.defaultInputCurrency === 'secondary');
    tempSaleCurrency = (currencySettings.defaultInputCurrency === 'secondary');
    tempSellCurrency = (currencySettings.defaultSellCurrency === 'secondary');
    tempEditCurrency = false;
    updatePriceLabels();
    updateProductPriceDisplay();
    updateSellPriceDisplay();
    updateEditSalePriceDisplay();
}

async function fetchStoreInfo() {
    try {
        var d = await db.collection('storeInfo').doc('info').get();
        if (d.exists) storeInfoData = d.data();
    } catch (e) {}
}

async function fetchExpensesSmart() {
    var cached = getCachedData('expenses');
    if (cached) { allExpenses = cached; return; }
    try {
        var snap = await db.collection('expenses').orderBy('date', 'desc').get();
        allExpenses = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
        setCachedData('expenses', allExpenses);
    } catch (e) { allExpenses = []; }
}

async function fetchSliderItems() {
    try {
        var snap = await db.collection('sliderTips').get();
        allSliderItems = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
        allSliderItems.sort(function(a, b) { return (b.priority || 0) - (a.priority || 0) || (a.order || 0) - (b
                .order || 0); });
    } catch (e) { allSliderItems = []; }
    try {
        var sd = await db.collection('sliderSettings').doc('settings').get();
        if (sd.exists) globalAutoSlideDelay = sd.data().autoSlideDelay || 5000;
        else globalAutoSlideDelay = 5000;
        document.getElementById('autoSlideDelayInput').value = globalAutoSlideDelay;
    } catch (e) {}
}

async function refreshAllData() {
    detachRealtimeListeners();
    clearAllCaches();
    allSalesFullLoaded = false;
    hasFetchedSales = false;
    await Promise.all([fetchInitialSales(), fetchItemsSmart(), fetchCategoriesSmart(), fetchExpensesSmart(),
        fetchSliderItems()
    ]);
    attachRealtimeListeners();
    destroyAllCharts();
    renderCurrentSection();
    showToast('✅ تم تحديث جميع البيانات');
    document.getElementById('lastUpdatedLabel').textContent = 'آخر تحديث: ' + fmtDateTime(Date.now());
}

function renderCurrentSection() {
    toggleLoading(true);
    document.querySelectorAll('.section-panel').forEach(function(p) { p.classList.remove('active'); });
    var secId = 'section-' + currentSection;
    var sec = document.getElementById(secId);
    if (sec) sec.classList.add('active');
    setTimeout(async function() {
        if (currentSection === 'profitAnalysis') await ensureFullSalesData();
        switch (currentSection) {
            case 'dashboard':
                renderDashboard();
                break;
            case 'inventory':
                renderInventory();
                break;
            case 'addItem':
                prepareAddItemForm();
                break;
            case 'salesLog':
                renderSalesLog();
                break;
            case 'activityLog':
                renderActivityLog();
                break;
            case 'productAnalytics':
                renderProductAnalytics();
                break;
            case 'profitAnalysis':
                renderProfitAnalysis();
                break;
            case 'comparison':
                renderComparison();
                break;
            case 'insights':
                renderInsights();
                break;
            case 'expenses':
                renderExpenses();
                break;
            case 'categories':
                renderCategories();
                break;
            case 'storeInfo':
                renderStoreInfo();
                break;
            case 'currencySettings':
                break;
            case 'sliderManager':
                renderSliderItems();
                break;
        }
        toggleLoading(false);
    }, 50);
}

function toggleLoading(show) {
    document.getElementById('loadingSpinner').classList.toggle('show', show);
}

function destroyAllCharts() {
    Object.values(allCharts).forEach(function(c) { try { c.destroy(); } catch (e) {} });
    allCharts = {};
}

function createChart(canvasId, config) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    if (allCharts[canvasId]) { try { allCharts[canvasId].destroy(); } catch (e) {} }
    var ctx = canvas.getContext('2d');
    var chart = new Chart(ctx, config);
    allCharts[canvasId] = chart;
    return chart;
}

function getArabicChartDefaults() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        font: { family: 'Cairo, sans-serif' },
        plugins: {
            legend: {
                labels: {
                    font: { family: 'Cairo, sans-serif', size: 12 },
                    color: darkMode ? '#a0aec0' : '#4a5568',
                    usePointStyle: true,
                    padding: 16
                }
            },
            tooltip: {
                titleFont: { family: 'Cairo, sans-serif', size: 13 },
                bodyFont: { family: 'Cairo, sans-serif', size: 12 },
                rtl: true,
                textDirection: 'rtl'
            }
        },
        scales: {
            x: {
                ticks: { font: { family: 'Cairo, sans-serif', size: 10 }, color: darkMode ? '#a0aec0' : '#718096' },
                grid: { color: darkMode ? '#2d3548' : '#edf2f7' }
            },
            y: {
                ticks: {
                    font: { family: 'Cairo, sans-serif', size: 10 },
                    color: darkMode ? '#a0aec0' : '#718096',
                    callback: function(v) { return formatMoney(v); }
                },
                grid: { color: darkMode ? '#2d3548' : '#edf2f7' }
            }
        }
    };
}

function getTopProducts(n) { n = n || 8;
    var map = {};
    allSales.forEach(function(s) { if (!map[s.itemId]) map[s.itemId] = { name: s.itemName || 'منتج ' + s.itemId,
            totalQty: 0, totalRevenue: 0, totalProfit: 0 };
        map[s.itemId].totalQty += s.quantity || 0;
        map[s.itemId].totalRevenue += s.totalAmount || 0;
        map[s.itemId].totalProfit += s.profit || 0; });
    return Object.values(map).sort(function(a, b) { return b.totalQty - a.totalQty; }).slice(0, n);
}

function getTopCategories(n) { n = n || 8;
    var map = {};
    allSales.forEach(function(s) { var item = allItems.find(function(i) { return i.id === s.itemId; }); var catName =
            item ? item.categoryName || 'بدون فئة' : 'بدون فئة'; if (!map[catName]) map[catName] = { name: catName,
                totalProfit: 0, totalRevenue: 0 };
        map[catName].totalProfit += s.profit || 0;
        map[catName].totalRevenue += s.totalAmount || 0; });
    return Object.values(map).sort(function(a, b) { return b.totalProfit - a.totalProfit; }).slice(0, n);
}

function getTopProfitProducts(n) { n = n || 8;
    var map = {};
    allSales.forEach(function(s) { if (!map[s.itemId]) map[s.itemId] = { name: s.itemName || 'منتج ' + s.itemId,
            totalProfit: 0 };
        map[s.itemId].totalProfit += s.profit || 0; });
    return Object.values(map).sort(function(a, b) { return b.totalProfit - a.totalProfit; }).slice(0, n);
}

function getDailyProfitData(days) { days = days || 30;
    var labels = [],
        profits = [],
        revenues = [];
    for (var i = days - 1; i >= 0; i--) { var d = new Date();
        d.setDate(d.getDate() - i); var ds = getStartOfDay(d),
            de = ds + 86400000; var daySales = allSales.filter(function(s) { return s.timestamp >= ds && s.timestamp <
                de; });
        labels.push(new Date(ds).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' }));
        profits.push(daySales.reduce(function(a, s) { return a + (s.profit || 0); }, 0));
        revenues.push(daySales.reduce(function(a, s) { return a + (s.totalAmount || 0); }, 0)); }
    return { labels: labels, profits: profits, revenues: revenues };
}

function getMonthlySalesData() {
    var map = {};
    allSales.forEach(function(s) { var mk = getMonthKey(s.timestamp); if (!map[mk]) map[mk] = { revenue: 0,
            profit: 0 };
        map[mk].revenue += s.totalAmount || 0;
        map[mk].profit += s.profit || 0; });
    var keys = Object.keys(map).sort(); if (keys.length > 12) keys = keys.slice(-12);
    return { labels: keys, revenues: keys.map(function(k) { return map[k].revenue; }), profits: keys.map(function(
            k) { return map[k].profit; }) };
}

function renderDashboard() {
    var now = Date.now();
    var ds = getStartOfDay(),
        ms = getStartOfMonth();
    var todaySales = allSales.filter(function(s) { return s.timestamp >= ds; });
    var todayRevenue = todaySales.reduce(function(a, s) { return a + (s.totalAmount || 0); }, 0);
    var todayProfit = todaySales.reduce(function(a, s) { return a + (s.profit || 0); }, 0);
    var todayOrders = todaySales.length,
        todayQty = todaySales.reduce(function(a, s) { return a + (s.quantity || 0); }, 0);
    var avgInvoice = todayOrders > 0 ? todayRevenue / todayOrders : 0;
    var avgProfitPerSale = todayOrders > 0 ? todayProfit / todayOrders : 0;
    var profitMargin = todayRevenue > 0 ? (todayProfit / todayRevenue * 100) : 0;
    var allTimeGrossProfit = allSales.reduce(function(a, s) { return a + (s.profit || 0); }, 0);
    var allTimeExpenses = getExpensesSum();
    var allTimeNetProfit = allTimeGrossProfit - allTimeExpenses;
    var allTimeRevenue = allSales.reduce(function(a, s) { return a + (s.totalAmount || 0); }, 0);
    var totalCapital = allItems.reduce(function(a, i) { return a + (i.purchasePrice || 0) * (i.quantity || 0); }, 0);
    var firstSaleDate = allSales.length > 0 ? fmtDate(Math.min.apply(null, allSales.map(function(s) { return s
            .timestamp; }))) : '--';
    var topProduct = getTopProducts(1)[0];
    var topCategory = getTopCategories(1)[0];
    var topProfitProduct = getTopProfitProducts(1)[0];
    document.getElementById('dashboardStats').innerHTML =
        '<div class="stat-card"><div class="stat-icon" style="background:var(--gradient-1);"><i class="fas fa-dollar-sign"></i></div><div class="stat-label">إجمالي المبيعات اليوم</div><div class="stat-value">' +
        formatMoney(todayRevenue) + '</div><div class="stat-sub">' + todayOrders + ' طلب</div></div>' +
        '<div class="stat-card"><div class="stat-icon" style="background:var(--gradient-2);"><i class="fas fa-chart-line"></i></div><div class="stat-label">الأرباح اليوم</div><div class="stat-value">' +
        formatMoney(todayProfit) + '</div><div class="stat-trend up">نسبة الربح: ' + fmt(profitMargin) +
        '%</div></div>' +
        '<div class="stat-card"><div class="stat-icon" style="background:var(--gradient-3);"><i class="fas fa-shopping-cart"></i></div><div class="stat-label">عدد الطلبات</div><div class="stat-value">' +
        todayOrders + '</div><div class="stat-sub">' + todayQty + ' قطعة</div></div>' +
        '<div class="stat-card"><div class="stat-icon" style="background:var(--gradient-4);"><i class="fas fa-cubes"></i></div><div class="stat-label">متوسط الفاتورة</div><div class="stat-value">' +
        formatMoney(avgInvoice) + '</div><div class="stat-sub">متوسط الربح: ' + formatMoney(avgProfitPerSale) +
        '</div></div>' +
        '<div class="stat-card"><div class="stat-icon" style="background:var(--gradient-5);"><i class="fas fa-trophy"></i></div><div class="stat-label">أكثر منتج مبيعاً</div><div class="stat-value" style="font-size:1rem;">' +
        (topProduct ? escHtml(topProduct.name) : '--') + '</div><div class="stat-sub">' + (topProduct ? topProduct
            .totalQty + ' قطعة' : '--') + '</div></div>' +
        '<div class="stat-card"><div class="stat-icon" style="background:var(--gradient-6);"><i class="fas fa-tags"></i></div><div class="stat-label">أكثر فئة مبيعاً</div><div class="stat-value" style="font-size:1rem;">' +
        (topCategory ? escHtml(topCategory.name) : '--') + '</div><div class="stat-sub">' + (topCategory ?
            formatMoney(topCategory.totalProfit) : '--') + '</div></div>' +
        '<div class="stat-card"><div class="stat-icon" style="background:var(--gradient-1);"><i class="fas fa-star"></i></div><div class="stat-label">المنتج الأعلى ربحاً</div><div class="stat-value" style="font-size:1rem;">' +
        (topProfitProduct ? escHtml(topProfitProduct.name) : '--') + '</div><div class="stat-sub">' + (
            topProfitProduct ? formatMoney(topProfitProduct.totalProfit) : '--') + '</div></div>' +
        '<div class="stat-card"><div class="stat-icon" style="background:var(--gradient-2);"><i class="fas fa-coins"></i></div><div class="stat-label">إجمالي الأرباح الكلية</div><div class="stat-value">' +
        formatMoney(allTimeGrossProfit) + '</div><div class="stat-sub">الصافي بعد المصاريف: ' + formatMoney(allTimeNetProfit) + '</div><div class="stat-sub">منذ ' + firstSaleDate + '</div></div>' +
        '<div class="stat-card"><div class="stat-icon" style="background:var(--gradient-3);"><i class="fas fa-warehouse"></i></div><div class="stat-label">رأس المال</div><div class="stat-value">' +
        formatMoney(totalCapital) + '</div><div class="stat-sub">' + allItems.length + ' صنف</div></div>';
    var dailyData = getDailyProfitData(30);
    createChart('chartDailyProfit', {
        type: 'line',
        data: {
            labels: dailyData.labels,
            datasets: [
                { label: 'الأرباح اليومية', data: dailyData.profits.map(function(v) { return parseFloat(
                        formatMoneyPlain(v)); }), borderColor: '#27ae60', backgroundColor: 'rgba(39,174,96,0.08)',
                    fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#27ae60',
                borderWidth: 2 },
                { label: 'المبيعات اليومية', data: dailyData.revenues.map(function(v) { return parseFloat(
                        formatMoneyPlain(v)); }), borderColor: '#2b6cb0', backgroundColor: 'rgba(43,108,176,0.05)',
                    fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#2b6cb0',
                borderWidth: 2, borderDash: [5, 3] }
            ]
        },
        options: { ...getArabicChartDefaults(), interaction: { mode: 'index', intersect: false } }
    });
    var allTimeProfitVal = allSales.reduce(function(a, s) { return a + (s.profit || 0); }, 0) - getExpensesSum();
    createChart('chartPieProfit', {
        type: 'doughnut',
        data: {
            labels: ['صافي الربح', 'تكلفة البضائع', 'مصاريف'],
            datasets: [{ data: [allTimeProfitVal, allTimeRevenue - allTimeProfitVal, getExpensesSum()],
                backgroundColor: ['#27ae60', '#2b6cb0', '#f97316'], borderWidth: 2,
                borderColor: darkMode ? '#1a1f2b' : '#fff' }]
        },
        options: { ...getArabicChartDefaults(), cutout: '60%', plugins: { legend: { position: 'bottom' } } }
    });
    var monthlyData = getMonthlySalesData();
    createChart('chartMonthlySales', {
        type: 'bar',
        data: {
            labels: monthlyData.labels,
            datasets: [
                { label: 'الإيرادات', data: monthlyData.revenues.map(function(v) { return parseFloat(
                        formatMoneyPlain(v)); }), backgroundColor: 'rgba(43,108,176,0.7)', borderRadius: 8,
                    borderSkipped: false },
                { label: 'الأرباح', data: monthlyData.profits.map(function(v) { return parseFloat(
                        formatMoneyPlain(v)); }), backgroundColor: 'rgba(39,174,96,0.7)', borderRadius: 8,
                    borderSkipped: false }
            ]
        },
        options: { ...getArabicChartDefaults(), interaction: { mode: 'index', intersect: false } }
    });
    var tp = getTopProducts(8);
    createChart('chartTopProducts', {
        type: 'bar',
        data: { labels: tp.map(function(p) { return p.name; }), datasets: [{ label: 'الكمية المباعة', data: tp
                    .map(function(p) { return p.totalQty; }), backgroundColor: chartColors.slice(0, tp.length),
                borderRadius: 6, borderSkipped: false
            }] },
        options: { ...getArabicChartDefaults(), indexAxis: 'y', plugins: { legend: { display: false } } }
    });
    var tc = getTopCategories(8);
    createChart('chartTopCategories', {
        type: 'bar',
        data: { labels: tc.map(function(c) { return c.name; }), datasets: [{ label: 'إجمالي الربح', data: tc
                    .map(function(c) { return parseFloat(formatMoneyPlain(c.totalProfit)); }),
                backgroundColor: chartColors.slice(0, tc.length), borderRadius: 6, borderSkipped: false
            }] },
        options: { ...getArabicChartDefaults(), indexAxis: 'y', plugins: { legend: { display: false } } }
    });
}

function arabicAlphabeticalComparator(a, b) { return a.name.localeCompare(b.name, 'ar', { sensitivity: 'variant',
        usage: 'sort' }); }

function filterAndSortProducts(term, stockFilter) {
    var filtered = [...allItems];
    var hasSearch = term && term.trim() !== "";
    if (hasSearch) {
        var searchTerm = term.trim();
        filtered = filtered.filter(function(p) { return p.name.includes(searchTerm); });
        filtered.forEach(function(p) {
            var priority = 3;
            if (p.name.startsWith(searchTerm)) priority = 1;
            else { var words = p.name.split(/\s+/); for (var wi = 0; wi < words.length; wi++) { if (
                        words[wi].startsWith(searchTerm)) { priority = 2; break; } } }
            p._searchPriority = priority;
        });
        filtered.sort(function(a, b) { if (a._searchPriority !== b._searchPriority) return a._searchPriority - b
                ._searchPriority; return arabicAlphabeticalComparator(a, b); });
        filtered.forEach(function(p) { delete p._searchPriority; });
    } else {
        if (stockFilter === 'available') filtered = filtered.filter(function(i) { return i.quantity > 0; });
        else if (stockFilter === 'outofstock') filtered = filtered.filter(function(i) { return i.quantity ===
            0; });
        filtered.sort(arabicAlphabeticalComparator);
    }
    if (stockFilter === 'available') filtered = filtered.filter(function(i) { return i.quantity > 0; });
    else if (stockFilter === 'outofstock') filtered = filtered.filter(function(i) { return i.quantity === 0; });
    return filtered;
}

function renderInventory() {
    var term = document.getElementById('searchItemsInput') ? document.getElementById('searchItemsInput').value : '';
    var filteredSorted = filterAndSortProducts(term, currentInventoryFilter);
    var html = '';
    if (!filteredSorted.length) { document.getElementById('itemsList').innerHTML =
            '<div class="empty-state"><i class="fas fa-box-open"></i><h3>لا توجد منتجات</h3></div>'; return; }
    filteredSorted.forEach(function(item, idx) {
        var profit = ((item.salePrice - item.purchasePrice) / item.purchasePrice * 100).toFixed(2);
        var profitClass = profit >= 0 ? 'profit-positive' : 'profit-negative';
        var pSec = fmt(convertToSecondary(item.purchasePrice)),
            sSec = fmt(convertToSecondary(item.salePrice));
        var vis = itemVisibility[item.id] || false;
        var cardClass = item.quantity === 0 ? 'out-of-stock' : (item.quantity <= 2 ? 'low-stock' : '');
        html += '<div class="product-card ' + cardClass + '" data-id="' + item.id +
            '"><div class="product-index-outer">' + (idx + 1) + '</div>' +
            '<div class="card-header"><div class="product-title"><span class="product-name">' + escHtml(item
                .name) + '</span>' + (item.categoryName ? '<span class="product-category-tag">' + escHtml(item
                .categoryName) + '</span>' : '') + '</div>' +
            '<div class="product-meta-wrapper"><div class="product-meta"><span><i class="fas fa-cubes"></i> ' +
            item.quantity + '</span><span class="profit-badge-small ' + profitClass + ' ' + (vis ? '' :
                'blur-price') + '">' + profit + '%</span></div>' +
            '<button class="eye-icon" data-id="' + item.id + '"><i class="fas ' + (vis ? 'fa-eye' :
                'fa-eye-slash') + '"></i></button></div></div>' +
            '<div class="price-row"><div class="price-col purchase-price"><div class="price-label">شراء</div><div class="primary-price ' +
            (vis ? '' : 'blur-price') + '">$' + fmt(item.purchasePrice) +
            '</div><div class="secondary-price ' + (vis ? '' : 'blur-price') + '">' + pSec + ' ' + currencySettings
            .secondaryCurrencySymbol + '</div></div>' +
            '<div class="price-col sale-price"><div class="price-label">بيع</div><div class="primary-price">$' +
            fmt(item.salePrice) + '</div><div class="secondary-price">' + sSec + ' ' + currencySettings
            .secondaryCurrencySymbol + '</div></div></div>' +
            '<div class="action-buttons"><button class="action-btn sell" data-id="' + item.id + '" ' + (item
                .quantity === 0 ? 'disabled' : '') +
            '><i class="fas fa-shopping-cart"></i> بيع</button><button class="action-btn edit" data-id="' + item
            .id + '"><i class="fas fa-edit"></i> تعديل</button><button class="action-btn delete" data-id="' +
            item.id + '"><i class="fas fa-trash-alt"></i> حذف</button></div></div>';
    });
    document.getElementById('itemsList').innerHTML = html;
    document.querySelectorAll('.sell').forEach(function(b) { b.addEventListener('click', function(e) {
            openSellModal(e.currentTarget.dataset.id); }); });
    document.querySelectorAll('.edit').forEach(function(b) { b.addEventListener('click', function(e) { editItem(e
                .currentTarget.dataset.id); }); });
    document.querySelectorAll('.delete').forEach(function(b) { b.addEventListener('click', function(e) { if (
                confirm('حذف المنتج؟')) performDelete(e.currentTarget.dataset.id); }); });
    document.querySelectorAll('.eye-icon').forEach(function(btn) { btn.addEventListener('click', function(e) { var
            id = btn.dataset.id;
        itemVisibility[id] = !itemVisibility[id];
        renderInventory(); }); });
}

async function performDelete(itemId) {
    var item = allItems.find(function(i) { return i.id === itemId; });
    if (!item) return;
    await db.collection('items').doc(itemId).delete();
    await logActivity('delete', 'item', itemId, 'حذف منتج: ' + item.name, { name: item.name });
    allItems = allItems.filter(function(i) { return i.id !== itemId; });
    renderInventory();
    showToast('تم الحذف');
}

function prepareAddItemForm() {
    currentItemId = null;
    isEditingItem = false;
    document.getElementById('itemForm').reset();
    document.getElementById('productHidden').checked = false;
    document.getElementById('productLimitedQty').checked = false;
    document.getElementById('productDiscountEnabled').checked = false;
    document.getElementById('discountValueGroup').style.display = 'none';
    document.getElementById('productDiscountValue').value = 0;
    document.getElementById('productShowPrice').checked = false;
    document.getElementById('productDescription').value = '';
    document.getElementById('productYoutubeUrl').value = '';
    document.getElementById('specificationsContainer').innerHTML = '';
    document.getElementById('imagesContainer').innerHTML = '';
    addSpecificationRow('', '');
    addImageRow('', true);
    tempPurchaseCurrency = (currencySettings.defaultInputCurrency === 'secondary');
    tempSaleCurrency = (currencySettings.defaultInputCurrency === 'secondary');
    document.getElementById('addItemTitle').innerText = 'إضافة قطعة جديدة';
    updatePriceLabels();
    updateProductPriceDisplay();
    populateCategorySelect();
    document.getElementById('productCategoryId').value = '';
}

function editItem(id) {
    var item = allItems.find(function(i) { return i.id === id; });
    if (!item) return;
    currentItemId = id;
    isEditingItem = true;
    document.getElementById('itemName').value = item.name;
    tempPurchaseCurrency = (currencySettings.defaultInputCurrency === 'secondary');
    tempSaleCurrency = (currencySettings.defaultInputCurrency === 'secondary');
    document.getElementById('purchasePrice').value = tempPurchaseCurrency ? fmt(convertToSecondary(item.purchasePrice)) :
        item.purchasePrice;
    document.getElementById('salePrice').value = tempSaleCurrency ? fmt(convertToSecondary(item.salePrice)) : item
        .salePrice;
    document.getElementById('quantity').value = item.quantity;
    document.getElementById('productHidden').checked = item.hidden || false;
    document.getElementById('productLimitedQty').checked = item.limitedQuantity || false;
    document.getElementById('productDiscountEnabled').checked = item.discountEnabled || false;
    document.getElementById('productDiscountValue').value = item.discountValue || 0;
    document.getElementById('discountValueGroup').style.display = item.discountEnabled ? 'block' : 'none';
    document.getElementById('productShowPrice').checked = item.showPrice || false;
    document.getElementById('productDescription').value = item.description || '';
    document.getElementById('productYoutubeUrl').value = item.youtubeUrl || '';
    document.getElementById('productCategoryId').value = item.categoryId || '';
    loadSpecificationsAndImages(item);
    document.getElementById('addItemTitle').innerText = 'تعديل القطعة';
    updatePriceLabels();
    updateProductPriceDisplay();
    currentSection = 'addItem';
    document.querySelectorAll('.section-panel').forEach(function(p) { p.classList.remove('active'); });
    document.getElementById('section-addItem').classList.add('active');
    document.getElementById('pageTitle').textContent = 'تعديل قطعة';
}

function addSpecificationRow(key, val) {
    key = key || '';
    val = val || '';
    var div = document.createElement('div');
    div.className = 'spec-row';
    div.innerHTML =
        '<input type="text" placeholder="اسم الخاصية" value="' + escHtml(key) +
        '"><input type="text" placeholder="القيمة" value="' + escHtml(val) +
        '"><button type="button" class="remove-spec">✖</button>';
    div.querySelector('.remove-spec').addEventListener('click', function() { div.remove(); });
    document.getElementById('specificationsContainer').appendChild(div);
}

function addImageRow(url, isPrimary) {
    url = url || '';
    isPrimary = isPrimary || false;
    var div = document.createElement('div');
    div.className = 'image-row';
    div.innerHTML = '<input type="url" placeholder="رابط الصورة" value="' + escHtml(url) +
        '"><button type="button" class="set-primary-btn" style="' + (isPrimary ? 'background:#4caf50;color:#fff' :
            '') + '">' + (isPrimary ? 'رئيسي' : 'تعيين رئيسي') +
        '</button><button type="button" class="remove-image">✖</button>';
    var btn = div.querySelector('.set-primary-btn');
    btn.addEventListener('click', function() {
        document.querySelectorAll('.image-row .set-primary-btn').forEach(function(b) { b.style
                .background = '';
            b.style.color = '';
            b.innerText = 'تعيين رئيسي'; });
        btn.style.background = '#4caf50';
        btn.style.color = '#fff';
        btn.innerText = 'رئيسي';
    });
    div.querySelector('.remove-image').addEventListener('click', function() { div.remove(); });
    document.getElementById('imagesContainer').appendChild(div);
}

function collectSpecifications() {
    var rows = document.querySelectorAll('#specificationsContainer .spec-row');
    var specs = [];
    rows.forEach(function(row) { var inputs = row.querySelectorAll('input'); if (inputs[0] && inputs[1] && inputs[
            0].value.trim()) specs.push({ key: inputs[0].value.trim(), value: inputs[1].value.trim() }); });
    return specs;
}

function collectImages() {
    var rows = document.querySelectorAll('#imagesContainer .image-row');
    var images = [];
    rows.forEach(function(row) { var urlInput = row.querySelector('input'); var isPrimaryBtn = row.querySelector(
            '.set-primary-btn'); if (urlInput && urlInput.value.trim()) images.push({ url: urlInput.value.trim(),
            isPrimary: isPrimaryBtn && isPrimaryBtn.innerText.includes('رئيسي') }); });
    if (images.length && !images.some(function(img) { return img.isPrimary; })) images[0].isPrimary = true;
    return images;
}

function loadSpecificationsAndImages(product) {
    var specC = document.getElementById('specificationsContainer');
    var imgC = document.getElementById('imagesContainer');
    specC.innerHTML = '';
    imgC.innerHTML = '';
    if (product.specifications) product.specifications.forEach(function(spec) { addSpecificationRow(spec.key, spec
            .value); });
    else addSpecificationRow('', '');
    if (product.images) product.images.forEach(function(img) { addImageRow(img.url, img.isPrimary); });
    else addImageRow('', true);
}

function populateCategorySelect() {
    var select = document.getElementById('productCategoryId');
    if (select) {
        select.innerHTML = '<option value="">-- بدون فئة --</option>';
        allCategories.forEach(function(c) { var opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            select.appendChild(opt); });
    }
    var assignSel = document.getElementById('assignCategorySelect');
    if (assignSel) {
        assignSel.innerHTML = '<option value="">-- اختر فئة --</option>';
        allCategories.forEach(function(c) { var opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            assignSel.appendChild(opt); });
    }
}

document.getElementById('itemForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var name = document.getElementById('itemName').value.trim();
    var purchase = tempPurchaseCurrency ? convertToPrimary(parseFloat(document.getElementById('purchasePrice')
        .value) || 0) : parseFloat(document.getElementById('purchasePrice').value) || 0;
    var sale = tempSaleCurrency ? convertToPrimary(parseFloat(document.getElementById('salePrice').value) || 0) :
        parseFloat(document.getElementById('salePrice').value) || 0;
    var qty = parseInt(document.getElementById('quantity').value) || 0;
    if (!name || purchase < 0 || sale < 0 || qty < 0) return alert('بيانات غير صالحة');
    var catId = document.getElementById('productCategoryId').value;
    var cat = allCategories.find(function(c) { return c.id === catId; });
    var categoryName = cat ? cat.name : '';
    var extra = {
        hidden: document.getElementById('productHidden').checked,
        limitedQuantity: document.getElementById('productLimitedQty').checked,
        discountEnabled: document.getElementById('productDiscountEnabled').checked,
        discountValue: document.getElementById('productDiscountEnabled').checked ? parseFloat(document
            .getElementById('productDiscountValue').value) || 0 : 0,
        showPrice: document.getElementById('productShowPrice').checked,
        description: document.getElementById('productDescription').value,
        youtubeUrl: document.getElementById('productYoutubeUrl').value,
        specifications: collectSpecifications(),
        images: collectImages(),
        categoryId: catId || null,
        categoryName: categoryName
    };
    if (isEditingItem) {
        var item = allItems.find(function(i) { return i.id === currentItemId; });
        if (!item) return;
        var previousItem = JSON.parse(JSON.stringify(item));
        var updatedItem = Object.assign({}, item, { name: name, purchasePrice: purchase, salePrice: sale, quantity: qty, ...extra,
            updatedAt: Date.now() });
        await db.collection('items').doc(item.id).set(updatedItem);
        Object.assign(item, updatedItem);
        var diff = buildItemChangeDetails(previousItem, updatedItem);
        var details = 'تعديل منتج: ' + name + (diff.details ? ' - ' + diff.details : '');
        await logActivity('update', 'item', item.id, details, { changes: diff.metadata, before: diff.beforeSnapshot, after: diff.afterSnapshot });
        showToast('تم التعديل');
    } else {
        var newId = 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        var newItem = { id: newId, name: name, purchasePrice: purchase, salePrice: sale, quantity: qty, ...extra,
            createdAt: Date.now(), updatedAt: Date.now() };
        await db.collection('items').doc(newId).set(newItem);
        await logActivity('create', 'item', newId, 'إضافة منتج: ' + name + ' - ' + buildProductDetailsSummary(newItem), { product: newItem });
        allItems.push(newItem);
        showToast('تمت الإضافة');
        prepareAddItemForm();
        if (document.getElementById('section-addItem').scrollTo) {
            document.getElementById('section-addItem').scrollTo({ top: 0, behavior: 'smooth' });
        }
        if (document.getElementById('contentArea').scrollTo) {
            document.getElementById('contentArea').scrollTo({ top: 0, behavior: 'smooth' });
        }
        document.getElementById('itemName').focus();
        currentSection = 'addItem';
        document.querySelectorAll('.section-panel').forEach(function(p) { p.classList.remove('active'); });
        document.getElementById('section-addItem').classList.add('active');
    }
    if (isEditingItem) {
        currentSection = 'inventory';
        renderCurrentSection();
    }
});

function openSellModal(itemId) {
    var item = allItems.find(function(i) { return i.id === itemId; });
    if (!item) return;
    document.getElementById('sellProductName').innerText = item.name;
    document.getElementById('sellQuantity').value = 1;
    document.getElementById('sellQuantity').max = item.quantity;
    tempSellCurrency = (currencySettings.defaultSellCurrency === 'secondary');
    document.getElementById('sellPriceLabel').innerHTML = 'السعر (' + (tempSellCurrency ? currencySettings
        .secondaryCurrencySymbol : '$') + ')';
    document.getElementById('sellPrice').value = tempSellCurrency ? fmt(convertToSecondary(item.salePrice)) : item
        .salePrice;
    updateSellPriceDisplay();
    document.getElementById('sellForm').dataset.itemId = itemId;
    document.getElementById('sellModal').classList.add('show');
}

document.getElementById('sellForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var itemId = document.getElementById('sellForm').dataset.itemId;
    var item = allItems.find(function(i) { return i.id === itemId; });
    if (!item) return;
    var qty = parseInt(document.getElementById('sellQuantity').value);
    if (qty <= 0 || qty > item.quantity) return alert('كمية غير صالحة');
    var price = tempSellCurrency ? convertToPrimary(parseFloat(document.getElementById('sellPrice').value) || 0) :
        parseFloat(document.getElementById('sellPrice').value) || 0;
    var profit = (price - item.purchasePrice) * qty;
    var saleObj = {
        itemId: item.id,
        itemName: item.name,
        quantity: qty,
        unitPrice: price,
        totalAmount: price * qty,
        profit: profit,
        purchasePriceAtTime: item.purchasePrice,
        timestamp: Date.now(),
        saleCurrency: tempSellCurrency ? 'secondary' : 'primary'
    };
    try {
        item.quantity -= qty;
        await db.collection('items').doc(item.id).update({ quantity: item.quantity, updatedAt: Date.now() });
        var ref = await db.collection('sales').add(saleObj);
        saleObj.saleId = ref.id;
        await db.collection('stats').doc('totals').set({
            allTimeProfit: firebase.firestore.FieldValue.increment(profit),
            updatedAt: Date.now()
        }, { merge: true });
        window._cachedStats.allTimeProfit = (window._cachedStats.allTimeProfit || 0) + profit;
        allItems = allItems.map(function(i) { return i.id === item.id ? item : i; });
        allSales.unshift(saleObj);
        await logActivity('sell', 'sale', saleObj.saleId, 'بيع منتج: ' + item.name + '، الكمية: ' + qty + '، الربح: ' + fmt(profit), { itemId: item.id, itemName: item.name, quantity: qty, profit: profit });
        closeModalById('sellModal');
        showToast('تم البيع بنجاح');
        if (currentSection === 'inventory') renderInventory();
        if (currentSection === 'dashboard') renderDashboard();
    } catch (err) { alert('فشل البيع'); }
});

document.getElementById('switchPurchaseCurrency').addEventListener('click', function() {
    var inputEl = document.getElementById('purchasePrice');
    var v = parseFloat(inputEl.value) || 0;
    tempPurchaseCurrency = !tempPurchaseCurrency;
    inputEl.value = tempPurchaseCurrency ? fmt(convertToSecondary(v)) : convertToPrimary(v).toFixed(2);
    updatePriceLabels();
    updateProductPriceDisplay();
});
document.getElementById('switchSaleCurrency').addEventListener('click', function() {
    var inputEl = document.getElementById('salePrice');
    var v = parseFloat(inputEl.value) || 0;
    tempSaleCurrency = !tempSaleCurrency;
    inputEl.value = tempSaleCurrency ? fmt(convertToSecondary(v)) : convertToPrimary(v).toFixed(2);
    updatePriceLabels();
    updateProductPriceDisplay();
});
document.getElementById('switchSellCurrency').addEventListener('click', function() {
    var inputEl = document.getElementById('sellPrice');
    var v = parseFloat(inputEl.value) || 0;
    tempSellCurrency = !tempSellCurrency;
    inputEl.value = tempSellCurrency ? fmt(convertToSecondary(v)) : convertToPrimary(v).toFixed(2);
    document.getElementById('sellPriceLabel').innerHTML = 'السعر (' + (tempSellCurrency ? currencySettings
        .secondaryCurrencySymbol : '$') + ')';
    updateSellPriceDisplay();
});
document.getElementById('switchEditCurrency').addEventListener('click', function() {
    var inputEl = document.getElementById('editPrice');
    var v = parseFloat(inputEl.value) || 0;
    tempEditCurrency = !tempEditCurrency;
    inputEl.value = tempEditCurrency ? fmt(convertToSecondary(v)) : convertToPrimary(v).toFixed(2);
    document.getElementById('editPriceLabel').innerHTML = 'السعر (' + (tempEditCurrency ? currencySettings
        .secondaryCurrencySymbol : '$') + ')';
    updateEditSalePriceDisplay();
});
document.getElementById('purchasePrice').addEventListener('input', updateProductPriceDisplay);
document.getElementById('salePrice').addEventListener('input', updateProductPriceDisplay);
document.getElementById('sellPrice').addEventListener('input', updateSellPriceDisplay);
document.getElementById('editPrice').addEventListener('input', updateEditSalePriceDisplay);
document.getElementById('addSpecBtn').addEventListener('click', function() { addSpecificationRow('', ''); });
document.getElementById('addImageBtn').addEventListener('click', function() { addImageRow('', false); });
document.getElementById('productDiscountEnabled').addEventListener('change', function() {
    document.getElementById('discountValueGroup').style.display = document.getElementById(
        'productDiscountEnabled').checked ? 'block' : 'none';
});
document.getElementById('cancelItemBtn').addEventListener('click', function() { currentSection = 'inventory';
    renderCurrentSection(); });
document.getElementById('searchItemsInput').addEventListener('input', function() { renderInventory(); });
document.querySelectorAll('#inventoryFilterBar .filter-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        document.querySelectorAll('#inventoryFilterBar .filter-btn').forEach(function(b) { b.classList
                .remove('active'); });
        btn.classList.add('active');
        currentInventoryFilter = btn.dataset.filter;
        renderInventory();
    });
});
var inventoryItemsList = document.getElementById('itemsList');
var inventoryScrollTopBtn = document.getElementById('inventoryScrollTopBtn');
if (inventoryItemsList && inventoryScrollTopBtn) {
    inventoryItemsList.addEventListener('scroll', function() {
        inventoryScrollTopBtn.classList.toggle('show', inventoryItemsList.scrollTop > 180);
    });
    inventoryScrollTopBtn.addEventListener('click', function() {
        inventoryItemsList.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

async function fetchSalesPage() {
    var sp = salesFilterParams;
    var query = db.collection('sales').orderBy('timestamp', 'desc');
    var now = Date.now();
    if (sp.period === 'today') { var ds = getStartOfDay();
        query = query.where('timestamp', '>=', ds); } else if (sp.period === 'week') { var ws = getStartOfWeek();
        query = query.where('timestamp', '>=', ws); } else if (sp.period === 'month') { var ms = getStartOfMonth();
        query = query.where('timestamp', '>=', ms); } else if (sp.period === 'year') { var ys = getStartOfYear();
        query = query.where('timestamp', '>=', ys); } else if (sp.period === '7days') { var d7 = now - 7 *
        86400000;
        query = query.where('timestamp', '>=', d7); } else if (sp.period === '30days') { var d30 = now - 30 *
        86400000;
        query = query.where('timestamp', '>=', d30); } else if (sp.period === '90days') { var d90 = now - 90 *
        86400000;
        query = query.where('timestamp', '>=', d90); } else if (sp.period === 'custom' && sp.customStart) { query =
            query.where('timestamp', '>=', sp.customStart); if (sp.customEnd) query = query.where('timestamp',
            '<=', sp.customEnd); }
    if (sp.productId) query = query.where('itemId', '==', sp.productId);
    if (sp.minProfit !== '') query = query.where('profit', '>=', parseFloat(sp.minProfit));
    if (sp.maxProfit !== '') query = query.where('profit', '<=', parseFloat(sp.maxProfit));
    if (sp.minQty !== '') query = query.where('quantity', '>=', parseInt(sp.minQty));
    if (sp.maxQty !== '') query = query.where('quantity', '<=', parseInt(sp.maxQty));
    query = query.limit(salesPageSize);
    if (salesPage > 0 && salesQueryCache.lastDoc) query = query.startAfter(salesQueryCache.lastDoc);
    try {
        var snap = await query.get();
        var rawItems = snap.docs.map(function(d) { return { saleId: d.id, ...d.data() }; });
        if (sp.searchTerm) { var term = sp.searchTerm.toLowerCase();
            rawItems = rawItems.filter(function(s) { return (s.itemName || '').toLowerCase().includes(term); }); }
        if (sp.categoryId) { var catItems = allItems.filter(function(i) { return i.categoryId === sp.categoryId; })
                .map(function(i) { return i.id; });
            rawItems = rawItems.filter(function(s) { return catItems.includes(s.itemId); }); }
        if (sp.minProfitPct !== '' || sp.maxProfitPct !== '') {
            rawItems = rawItems.filter(function(s) { var pct = s.totalAmount > 0 ? ((s.profit || 0) / s
                    .totalAmount * 100) : 0; if (sp.minProfitPct !== '' && pct < parseFloat(sp
                        .minProfitPct)) return false; if (sp.maxProfitPct !== '' && pct > parseFloat(sp
                    .maxProfitPct)) return false; return true; });
        }
        salesQueryCache.currentPageItems = rawItems;
        salesQueryCache.lastDoc = snap.docs.length === salesPageSize ? snap.docs[snap.docs.length - 1] : null;
        salesQueryCache.hasMore = snap.docs.length === salesPageSize;
    } catch (e) { salesQueryCache.currentPageItems = [];
        salesQueryCache.hasMore = false; }
}

function renderSalesLog() {
    salesPage = Math.max(0, salesPage);
    fetchSalesPage().then(function() {
        document.getElementById('salesCountLabel').textContent =
            'إجمالي العمليات في الصفحة: ' + salesQueryCache.currentPageItems.length;
        var tbody = document.getElementById('salesLogBody');
        var html = '';
        salesQueryCache.currentPageItems.forEach(function(s, i) {
            var cost = (s.purchasePriceAtTime || 0) * (s.quantity || 0);
            var profitPct = s.totalAmount > 0 ? ((s.profit || 0) / s.totalAmount * 100) : 0;
            html += '<tr><td>' + (i + 1) + '</td><td>' + fmtDateTime(s.timestamp) + '</td><td>' +
                escHtml(s.itemName || '--') + '</td><td>' + (s.quantity || 0) + '</td><td>' +
                formatMoney(s.unitPrice || 0) + '</td><td>' + formatMoney(s.totalAmount || 0) +
                '</td><td>' + formatMoney(cost) +
                '</td><td class="' + ((s.profit || 0) >= 0 ? 'profit-positive' : 'profit-negative') + '">' + formatMoney(s.profit || 0) +
                '</td><td><span class="badge ' + (profitPct >= 20 ? 'badge-success' : profitPct >= 0 ?
                    'badge-warning' : 'badge-danger') + '">' + fmt(profitPct) +
                '%</span></td><td><button onclick="viewSaleDetail(\'' + s.saleId +
                '\')" style="background:var(--primary-light);color:var(--primary);border:none;border-radius:20px;padding:5px 12px;cursor:pointer;font-size:0.72rem;font-weight:600;">عرض</button></td></tr>';
        });
        if (!salesQueryCache.currentPageItems.length) html =
            '<tr><td colspan="10" style="padding:30px;color:var(--text3);">لا توجد عمليات</td></tr>';
        tbody.innerHTML = html;
        renderSalesPagination();
        renderSalesFilterRow();
    });
}

function renderSalesPagination() {
    var html = '';
    if (salesPage === 0 && !salesQueryCache.hasMore) { document.getElementById('salesPagination').innerHTML =
            ''; return; }
    html += '<button ' + (salesPage === 0 ? 'disabled' : '') + ' onclick="goToSalesPage(' + (salesPage - 1) +
        ')"><i class="fas fa-chevron-right"></i></button>';
    html += '<button class="active">' + (salesPage + 1) + '</button>';
    html += '<button ' + (!salesQueryCache.hasMore ? 'disabled' : '') + ' onclick="goToSalesPage(' + (salesPage +
        1) + ')"><i class="fas fa-chevron-left"></i></button>';
    document.getElementById('salesPagination').innerHTML = html;
}

function goToSalesPage(p) { salesPage = p;
    salesQueryCache.lastDoc = p > 0 ? salesQueryCache.lastDoc : null;
    renderSalesLog(); }

function renderSalesFilterRow() {
    var sp = salesFilterParams;
    var catOpts = '<option value="">كل الفئات</option>' + allCategories.map(function(c) { return '<option value="' + c.id + '" ' + (sp.categoryId === c.id ? 'selected' : '') + '>' + escHtml(c.name) + '</option>'; })
        .join('');
    var prodOpts = '<option value="">كل المنتجات</option>' + allItems.map(function(i) { return '<option value="' + i
            .id + '" ' + (sp.productId === i.id ? 'selected' : '') + '>' + escHtml(i.name) + '</option>'; })
        .join('');
    document.getElementById('salesFilterRow').innerHTML =
        '<select id="sfPeriod" onchange="updateSalesFilter(\'period\',this.value)"><option value="all" ' + (sp
            .period === 'all' ? 'selected' : '') + '>كل الفترات</option><option value="today" ' + (sp.period ===
            'today' ? 'selected' : '') + '>اليوم</option><option value="week" ' + (sp.period === 'week' ?
            'selected' : '') + '>الأسبوع</option><option value="month" ' + (sp.period === 'month' ? 'selected' : '') + '>الشهر</option><option value="year" ' + (sp.period === 'year' ? 'selected' : '') +
            '>السنة</option><option value="7days" ' + (sp.period === '7days' ? 'selected' : '') +
            '>آخر 7 أيام</option><option value="30days" ' + (sp.period === '30days' ? 'selected' : '') +
            '>آخر 30 يوم</option><option value="90days" ' + (sp.period === '90days' ? 'selected' : '') +
            '>آخر 90 يوم</option><option value="custom" ' + (sp.period === 'custom' ? 'selected' : '') +
            '>مخصص</option></select>' + (sp.period === 'custom' ? '<input type="text" class="date-input" readonly id="sfCustomStart" placeholder="YYYY-MM-DD" value="' + (sp
                .customStart ? new Date(sp.customStart).toISOString().split('T')[0] : '') +
            '" onchange="updateSalesFilter(\'customStart\',parseDateString(this.value,false))"><span>إلى</span><input type="text" class="date-input" readonly id="sfCustomEnd" placeholder="YYYY-MM-DD" value="' +
            (sp.customEnd ? new Date(sp.customEnd).toISOString().split('T')[0] : '') +
            '" onchange="updateSalesFilter(\'customEnd\',parseDateString(this.value,true))">' :
                '') +
        '<input type="text" id="sfSearch" placeholder="🔍 بحث باسم المنتج" value="' + escHtml(sp.searchTerm) +
        '" oninput="debouncedSearchUpdate(this.value)" style="max-width:200px;">' +
        '<select id="sfProduct" onchange="updateSalesFilter(\'productId\',this.value)">' + prodOpts +
        '</select>' +
        '<select id="sfCategory" onchange="updateSalesFilter(\'categoryId\',this.value)">' + catOpts +
        '</select>' +
        '<input type="number" id="sfMinQty" placeholder="أقل كمية" value="' + sp.minQty +
        '" onchange="updateSalesFilter(\'minQty\',this.value)" style="max-width:100px;">' +
        '<input type="number" id="sfMaxQty" placeholder="أعلى كمية" value="' + sp.maxQty +
        '" onchange="updateSalesFilter(\'maxQty\',this.value)" style="max-width:100px;">' +
        '<input type="number" id="sfMinProfit" placeholder="أقل ربح" value="' + sp.minProfit +
        '" onchange="updateSalesFilter(\'minProfit\',this.value)" style="max-width:100px;">' +
        '<input type="number" id="sfMaxProfit" placeholder="أعلى ربح" value="' + sp.maxProfit +
        '" onchange="updateSalesFilter(\'maxProfit\',this.value)" style="max-width:100px;">' +
        '<input type="number" id="sfMinProfitPct" placeholder="أقل نسبة%" value="' + sp.minProfitPct +
        '" onchange="updateSalesFilter(\'minProfitPct\',this.value)" style="max-width:110px;">' +
        '<input type="number" id="sfMaxProfitPct" placeholder="أعلى نسبة%" value="' + sp.maxProfitPct +
        '" onchange="updateSalesFilter(\'maxProfitPct\',this.value)" style="max-width:110px;">' +
        '<button class="btn-sm outline" onclick="resetSalesFilters()">مسح الفلاتر</button>';
}

function debouncedSearchUpdate(value) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(function() { updateSalesFilter('searchTerm', value); }, 400);
}

function updateSalesFilter(key, value) {
    salesFilterParams[key] = value;
    salesPage = 0;
    salesQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
    renderSalesLog();
}

function resetSalesFilters() {
    salesFilterParams = { period: 'all', searchTerm: '', categoryId: '', productId: '', minQty: '', maxQty: '',
        minProfit: '', maxProfit: '', minProfitPct: '', maxProfitPct: '' };
    salesPage = 0;
    salesQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
    renderSalesLog();
}

function viewSaleDetail(saleId) {
    var s = allSales.find(function(x) { return x.saleId === saleId; });
    if (!s && salesQueryCache.currentPageItems.length) { s = salesQueryCache.currentPageItems.find(function(x) {
            return x.saleId === saleId; }); }
    if (!s) { db.collection('sales').doc(saleId).get().then(function(doc) { if (doc.exists) { var data = {
                        saleId: doc.id, ...doc.data() };
                    renderSaleDetailModal(data); } }).catch(function() {}); return; }
    renderSaleDetailModal(s);
}

function renderSaleDetailModal(s) {
    var cost = (s.purchasePriceAtTime || 0) * (s.quantity || 0);
    var profitPct = s.totalAmount > 0 ? ((s.profit || 0) / s.totalAmount * 100) : 0;
    var item = allItems.find(function(i) { return i.id === s.itemId; });
    document.getElementById('saleDetailContent').innerHTML =
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:0.85rem;">' +
        '<div><strong>رقم الفاتورة:</strong> ' + escHtml(s.saleId) + '</div><div><strong>التاريخ:</strong> ' +
        fmtDateTime(s.timestamp) + '</div>' +
        '<div><strong>المنتج:</strong> ' + escHtml(s.itemName || '--') + '</div><div><strong>الفئة:</strong> ' +
        escHtml(item ? item.categoryName || '--' : '--') + '</div>' +
        '<div><strong>الكمية:</strong> ' + (s.quantity || 0) + '</div><div><strong>سعر الوحدة:</strong> ' +
        formatMoney(s.unitPrice || 0) + '</div>' +
        '<div><strong>الإجمالي:</strong> ' + formatMoney(s.totalAmount || 0) +
        '</div><div><strong>التكلفة:</strong> ' + formatMoney(cost) + '</div>' +
        '<div><strong>الربح:</strong> <span class="' + ((s.profit || 0) >= 0 ? 'profit-positive' :
            'profit-negative') + '">' + formatMoney(s.profit || 0) + '</span></div>' +
        '<div><strong>نسبة الربح:</strong> ' + fmt(profitPct) + '%</div></div>';
    document.getElementById('saleDetailModal').classList.add('show');
}

window.viewSaleDetail = viewSaleDetail;

window.editSale = function(saleId) {
    var sale = allSales.find(function(s) { return s.saleId === saleId; });
    if (!sale) return;
    var prod = allItems.find(function(i) { return i.id === sale.itemId; });
    if (!prod) return alert('المنتج غير موجود');
    document.getElementById('editSaleId').value = sale.saleId;
    document.getElementById('editOriginalItemId').value = sale.itemId;
    document.getElementById('editOriginalQuantity').value = sale.quantity;
    document.getElementById('editSaleCurrency').value = sale.saleCurrency || 'primary';
    document.getElementById('editProductName').innerText = sale.itemName;
    document.getElementById('editQuantity').value = sale.quantity;
    document.getElementById('editQuantity').max = prod.quantity + sale.quantity;
    tempEditCurrency = (sale.saleCurrency === 'secondary');
    document.getElementById('editPriceLabel').innerHTML = 'السعر (' + (tempEditCurrency ? currencySettings
        .secondaryCurrencySymbol : '$') + ')';
    document.getElementById('editPrice').value = tempEditCurrency ? fmt(convertToSecondary(sale.unitPrice)) : sale
        .unitPrice;
    updateEditSalePriceDisplay();
    document.getElementById('editSaleModal').classList.add('show');
};

document.getElementById('editSaleForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var saleId = document.getElementById('editSaleId').value;
    var itemId = document.getElementById('editOriginalItemId').value;
    var oldQty = parseInt(document.getElementById('editOriginalQuantity').value);
    var newQty = parseInt(document.getElementById('editQuantity').value);
    var price = tempEditCurrency ? convertToPrimary(parseFloat(document.getElementById('editPrice').value) || 0) :
        parseFloat(document.getElementById('editPrice').value) || 0;
    var sale = allSales.find(function(s) { return s.saleId === saleId; });
    var prod = allItems.find(function(i) { return i.id === itemId; });
    if (!sale || !prod) return;
    var diff = newQty - oldQty;
    if (diff > 0 && prod.quantity < diff) return alert('كمية غير متوفرة');
    prod.quantity -= diff;
    await db.collection('items').doc(prod.id).update({ quantity: prod.quantity, updatedAt: Date.now() });
    var oldProfit = sale.profit || 0;
    var newTotal = newQty * price;
    var newProfit = (price - prod.purchasePrice) * newQty;
    var profitDiff = newProfit - oldProfit;
    var upd = { ...sale, quantity: newQty, unitPrice: price, totalAmount: newTotal, profit: newProfit,
        saleCurrency: tempEditCurrency ? 'secondary' : 'primary' };
    await db.collection('sales').doc(saleId).set(upd);
    if (profitDiff !== 0) {
        await db.collection('stats').doc('totals').set({
            allTimeProfit: firebase.firestore.FieldValue.increment(profitDiff),
            updatedAt: Date.now()
        }, { merge: true });
        window._cachedStats.allTimeProfit = (window._cachedStats.allTimeProfit || 0) + profitDiff;
    }
    await logActivity('update', 'sale', saleId, 'تعديل بيع: ' + sale.itemName + '، الكمية الجديدة: ' + newQty + '، السعر: ' + fmt(price), { oldQuantity: oldQty, newQuantity: newQty, oldProfit: oldProfit, newProfit: newProfit });
    allItems = allItems.map(function(i) { return i.id === prod.id ? prod : i; });
    Object.assign(sale, upd);
    closeModalById('editSaleModal');
    showToast('تم تعديل البيع');
    if (currentSection === 'salesLog') renderSalesLog();
    if (currentSection === 'dashboard') renderDashboard();
});

window.cancelSale = async function(saleId) {
    if (!confirm('إلغاء البيع؟')) return;
    var sale = allSales.find(function(s) { return s.saleId === saleId; });
    var prod = allItems.find(function(i) { return i.id === sale.itemId; });
    if (!prod) return;
    prod.quantity += sale.quantity;
    await db.collection('items').doc(prod.id).update({ quantity: prod.quantity, updatedAt: Date.now() });
    await db.collection('sales').doc(saleId).delete();
    await db.collection('stats').doc('totals').set({
        allTimeProfit: firebase.firestore.FieldValue.increment(-(sale.profit || 0)),
        updatedAt: Date.now()
    }, { merge: true });
    window._cachedStats.allTimeProfit = (window._cachedStats.allTimeProfit || 0) - (sale.profit || 0);
    await logActivity('delete', 'sale', saleId, 'إلغاء بيع: ' + sale.itemName + '، الكمية: ' + sale.quantity + '، الربح: ' + fmt(sale.profit || 0), { itemId: sale.itemId, itemName: sale.itemName, quantity: sale.quantity, profit: sale.profit });
    allItems = allItems.map(function(i) { return i.id === prod.id ? prod : i; });
    allSales = allSales.filter(function(s) { return s.saleId !== saleId; });
    showToast('تم إلغاء البيع');
    if (currentSection === 'salesLog') renderSalesLog();
    if (currentSection === 'dashboard') renderDashboard();
};

document.getElementById('archiveSalesBtn').addEventListener('click', async function() {
    var oneYearAgo = Date.now() - 365 * 86400000;
    var snap = await db.collection('sales').where('timestamp', '<=', oneYearAgo).get();
    if (snap.empty) { showToast('لا توجد سجلات قديمة'); return; }
    var batch = db.batch();
    snap.docs.forEach(function(doc) { var ref = db.collection('sales_archive').doc(doc.id);
        batch.set(ref, doc.data());
        batch.delete(doc.ref); });
    await batch.commit();
    await logActivity('archive', 'salesArchive', null, 'أرشفة ' + snap.size + ' عملية مبيعات قديمة', { count: snap.size });
    showToast('تمت أرشفة ' + snap.size + ' عملية');
});
document.getElementById('viewArchivedSalesBtn').addEventListener('click', async function() {
    var snap = await db.collection('sales_archive').orderBy('timestamp', 'desc').limit(100).get();
    var html = '';
    snap.docs.forEach(function(d) { var s = d.data();
        html += '<tr><td>' + fmtDateTime(s.timestamp) + '</td><td>' + escHtml(s.itemName || '') +
            '</td><td>' + formatMoney(s.totalAmount || 0) + '</td><td>' + formatMoney(s.profit || 0) +
            '</td></tr>'; });
    if (!html) html = '<tr><td colspan="4">لا توجد سجلات</td></tr>';
    document.getElementById('archivedSalesBody').innerHTML = html;
    document.getElementById('archivedSalesModal').classList.add('show');
});

function renderProductAnalytics() {
    var map = {};
    allSales.forEach(function(s) { if (!map[s.itemId]) map[s.itemId] = { name: s.itemName || 'منتج ' + s.itemId,
            categoryName: '', saleCount: 0, totalQty: 0, totalRevenue: 0, totalProfit: 0,
            lastSale: 0 };
        map[s.itemId].saleCount++;
        map[s.itemId].totalQty += s.quantity || 0;
        map[s.itemId].totalRevenue += s.totalAmount || 0;
        map[s.itemId].totalProfit += s.profit || 0; if (s.timestamp > map[s.itemId].lastSale) map[s.itemId].lastSale =
            s.timestamp; });
    allItems.forEach(function(item) { if (!map[item.id]) map[item.id] = { name: item.name, categoryName: item
                .categoryName || '', saleCount: 0, totalQty: 0, totalRevenue: 0, totalProfit: 0,
            lastSale: 0 }; else map[item.id].categoryName = item.categoryName || ''; });
    var arr = Object.values(map);
    var totalAllProfit = arr.reduce(function(a, p) { return a + p.totalProfit; }, 0);
    var search = document.getElementById('prodSearchInput') ? document.getElementById('prodSearchInput').value.trim() :
        '';
    if (search) arr = arr.filter(function(p) { return p.name.toLowerCase().includes(search.toLowerCase()); });
    arr.sort(function(a, b) { return b.totalProfit - a.totalProfit; });
    var html = '';
    arr.forEach(function(p) { var contrib = totalAllProfit > 0 ? (p.totalProfit / totalAllProfit * 100) : 0; var
            avgProfit = p.totalQty > 0 ? p.totalProfit / p.totalQty : 0;
        html += '<tr><td>' + escHtml(p.name) + '</td><td>' + escHtml(p.categoryName || '--') + '</td><td>' + p
            .saleCount + '</td><td>' + p.totalQty + '</td><td>' + formatMoney(p.totalRevenue) +
            '</td><td class="profit-positive">' + formatMoney(p.totalProfit) + '</td><td>' + fmt(contrib) +
            '%</td><td>' + (p.lastSale ? fmtDate(p.lastSale) : '--') + '</td><td>' + formatMoney(avgProfit) +
            '</td></tr>'; });
    if (!arr.length) html = '<tr><td colspan="9" style="padding:30px;color:var(--text3);">لا توجد بيانات</td></tr>';
    document.getElementById('productAnalyticsBody').innerHTML = html;
    document.getElementById('prodResultCount').textContent = 'النتائج: ' + arr.length;
}
document.getElementById('prodSearchInput').addEventListener('input', renderProductAnalytics);

function renderProfitAnalysis() {
    var now = Date.now();
    var ds = getStartOfDay(),
        ws = getStartOfWeek(),
        ms = getStartOfMonth(),
        ys = getStartOfYear();
    var periods = [{ label: 'اليوم', start: ds }, { label: 'الأسبوع', start: ws }, { label: 'الشهر', start: ms },
    { label: 'السنة', start: ys }, { label: 'الكلي', start: 0 }];
    var statsHtml = '',
        tableHtml = '';
    periods.forEach(function(p) {
        var s = allSales.filter(function(x) { return x.timestamp >= p.start; });
        var rev = s.reduce(function(a, x) { return a + (x.totalAmount || 0); }, 0);
        var cost = s.reduce(function(a, x) { return a + (x.purchasePriceAtTime || 0) * (x.quantity || 0); },
            0);
        var prof = s.reduce(function(a, x) { return a + (x.profit || 0); }, 0);
        var expenses = getExpensesSum(p.start);
        var netProf = prof - expenses;
        var avgProf = s.length > 0 ? netProf / s.length : 0;
        statsHtml +=
            '<div class="stat-card"><div class="stat-label">' + p.label +
            '</div><div class="stat-value">' + formatMoney(prof) + '</div><div class="stat-sub">الصافي بعد المصاريف: ' + formatMoney(netProf) + '</div><div class="stat-sub">' + s
            .length + ' عملية | إيرادات: ' + formatMoney(rev) + ' | مصاريف: ' + formatMoney(expenses) +
            '</div></div>';
        tableHtml += '<tr><td>' + p.label + '</td><td>' + s.length + '</td><td>' + formatMoney(rev) +
            '</td><td>' + formatMoney(cost) + '</td><td class="profit-positive">' + formatMoney(netProf) +
            '</td><td>' + formatMoney(avgProf) + '</td></tr>';
    });
    document.getElementById('profitStatsGrid').innerHTML = statsHtml;
    document.getElementById('profitPeriodBody').innerHTML = tableHtml;
    var sortedSales = [...allSales].sort(function(a, b) { return a.timestamp - b.timestamp; });
    var cumData = [],
        cum = 0;
    sortedSales.forEach(function(s) { cum += s.profit || 0;
        cumData.push({ x: s.timestamp, y: cum }); });
    createChart('chartCumulativeProfit', {
        type: 'line',
        data: { datasets: [{ label: 'الأرباح التراكمية', data: cumData, borderColor: '#27ae60',
                backgroundColor: 'rgba(39,174,96,0.1)', fill: true, tension: 0.3, pointRadius: 1,
                borderWidth: 2.5
            }] },
        options: {
            ...getArabicChartDefaults(),
            scales: { x: { type: 'time', time: { unit: 'month', tooltipFormat: 'yyyy-MM-dd' }, ticks: { font: {
                            family: 'Cairo', size: 10 } } }, y: { ...getArabicChartDefaults().scales
                    .y } }
        }
    });
}

function getComparisonDiffText(revenueDiff, profitDiff) {
    function fmtDiff(name, value) {
        if (value > 0) return name + ': <span class="profit-positive">+' + formatMoney(value) + '</span>';
        if (value < 0) return name + ': <span class="profit-negative">-' + formatMoney(Math.abs(value)) + '</span>';
        return name + ': <span style="color:var(--text3);">0</span>';
    }
    return '<span class="comparison-diff-text">' + fmtDiff('إيرادات', revenueDiff) + ' | ' + fmtDiff('ربح', profitDiff) + '</span>';
}

function getComparisonRowDiff(current, previous) {
    if (!previous) return '--';
    var revenueDiff = current.revenue - previous.revenue;
    var profitDiff = current.netProfit - previous.netProfit;
    return getComparisonDiffText(revenueDiff, profitDiff);
}

function renderComparison() {
    var latestSaleTs = allSales.reduce(function(max, s) { return Math.max(max, s.timestamp || 0); }, 0);
    var currentDate = new Date();
    var year = currentDate.getFullYear();
    var lastMonthIndex = currentDate.getMonth();
    if (latestSaleTs) {
        var latestSaleDate = new Date(latestSaleTs);
        year = latestSaleDate.getFullYear();
        lastMonthIndex = latestSaleDate.getMonth();
    }
    var monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    var rows = '';
    var prevMonth = null;
    for (var i = 0; i <= lastMonthIndex; i++) {
        var start = new Date(year, i, 1).getTime();
        var end = new Date(year, i + 1, 1).getTime();
        var monthSales = allSales.filter(function(s) { return s.timestamp >= start && s.timestamp < end; });
        var revenue = monthSales.reduce(function(acc, x) { return acc + (x.totalAmount || 0); }, 0);
        var salesCount = monthSales.length;
        var expenses = getExpensesSum(start, end);
        var profit = monthSales.reduce(function(acc, x) { return acc + (x.profit || 0); }, 0);
        var netProfit = profit - expenses;
        var profitMargin = revenue !== 0 ? netProfit / revenue * 100 : 0;
        var rowClass = i === lastMonthIndex ? ' class="comparison-last-month"' : '';
        rows += '<tr' + rowClass + '>' +
            '<td>' + monthNames[i] + '</td>' +
            '<td>' + salesCount + '</td>' +
            '<td>' + formatMoney(revenue) + '</td>' +
            '<td>' + formatMoney(expenses) + '</td>' +
            '<td>' + formatMoney(netProfit) + '</td>' +
            '<td>' + fmt(profitMargin) + '%</td>' +
            '<td style="white-space:normal;text-align:left;">' + getComparisonRowDiff({ revenue: revenue, netProfit: netProfit }, prevMonth) + '</td>' +
            '</tr>';
        prevMonth = { revenue: revenue, netProfit: netProfit };
    }
    document.getElementById('comparisonStats').innerHTML =
        '<div class="table-container"><div class="table-header"><h3>مقارنة من بداية السنة حتى آخر شهر فيه عملية بيع</h3></div>' +
        '<div class="table-scroll"><table>' +
        '<thead><tr><th>الشهر</th><th>عدد المبيعات</th><th>قيمة المبيعات</th><th>المصاريف</th><th>صافي الربح</th><th>نسبة الربح</th><th>الفرق عن الشهر السابق</th></tr></thead>' +
        '<tbody>' + rows;
    if (comparisonManualRows) {
        var firstDiff = '--';
        var secondDiff = getComparisonDiffText(comparisonManualRows.second.revenue - comparisonManualRows.first.revenue,
            comparisonManualRows.second.netProfit - comparisonManualRows.first.netProfit);
        rows += '<tr class="comparison-manual-row"><td>الفترة الأولى</td><td>' + comparisonManualRows.first.count + '</td><td>' + formatMoney(comparisonManualRows.first.revenue) + '</td><td>' + formatMoney(comparisonManualRows.first.expenses) + '</td><td>' + formatMoney(comparisonManualRows.first.netProfit) + '</td><td>' + fmt(comparisonManualRows.first.margin) + '%</td><td style="white-space:normal;text-align:left;">' + firstDiff + '</td></tr>';
        rows += '<tr class="comparison-manual-row"><td>الفترة الثانية</td><td>' + comparisonManualRows.second.count + '</td><td>' + formatMoney(comparisonManualRows.second.revenue) + '</td><td>' + formatMoney(comparisonManualRows.second.expenses) + '</td><td>' + formatMoney(comparisonManualRows.second.netProfit) + '</td><td>' + fmt(comparisonManualRows.second.margin) + '%</td><td style="white-space:normal;text-align:left;">' + secondDiff + '</td></tr>';
    }
    document.getElementById('comparisonStats').innerHTML += '</tbody></table></div></div>';
    document.getElementById('comparisonChartCard').style.display = 'none';
}
document.getElementById('compareBtn').addEventListener('click', function() {
    var s1 = parseDateString(document.getElementById('compStart1Val').value, false);
    var e1 = parseDateString(document.getElementById('compEnd1Val').value, true);
    var s2 = parseDateString(document.getElementById('compStart2Val').value, false);
    var e2 = parseDateString(document.getElementById('compEnd2Val').value, true);
    if (!s1 || !e1 || !s2 || !e2) { showToast('يرجى إدخال تواريخ صحيحة للفترتين'); return; }
    var f1 = allSales.filter(function(s) { return s.timestamp >= s1 && s.timestamp <= e1; });
    var f2 = allSales.filter(function(s) { return s.timestamp >= s2 && s.timestamp <= e2; });
    var stats = function(arr, label) { var rev = arr.reduce(function(a, x) { return a + (x.totalAmount || 0); }, 0); var prof = arr.reduce(function(a, x) { return a + (x.profit || 0); }, 0); var cnt = arr.length,
            qty = arr.reduce(function(a, x) { return a + (x.quantity || 0); }, 0); return { label: label, rev: rev,
            prof: prof, cnt: cnt, qty: qty, avgInv: cnt > 0 ? rev / cnt : 0 }; };
    var r1 = stats(f1, 'الفترة الأولى'),
        r2 = stats(f2, 'الفترة الثانية');
    var diff = function(a, b) { var d = a - b; return d >= 0 ? '<span class="profit-positive">+' + formatMoney(
            d) + '</span>' : '<span class="profit-negative">-' + formatMoney(Math.abs(d)) + '</span>'; };
    comparisonManualRows = {
        first: { count: r1.cnt, revenue: r1.rev, expenses: r1.expenses || 0, netProfit: r1.prof, margin: r1.rev !== 0 ? r1.prof / r1.rev * 100 : 0 },
        second: { count: r2.cnt, revenue: r2.rev, expenses: r2.expenses || 0, netProfit: r2.prof, margin: r2.rev !== 0 ? r2.prof / r2.rev * 100 : 0 }
    };
    renderComparison();
    return;

    document.getElementById('comparisonStats').innerHTML =
        '<div class="stat-card"><div class="stat-label">' + r1.label +
        ' - الإيرادات</div><div class="stat-value">' + formatMoney(r1.rev) + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">' + r2.label +
        ' - الإيرادات</div><div class="stat-value">' + formatMoney(r2.rev) +
        '</div><div class="stat-sub">الفرق: ' + diff(r2.rev, r1.rev) + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">' + r1.label +
        ' - الأرباح</div><div class="stat-value">' + formatMoney(r1.prof) + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">' + r2.label +
        ' - الأرباح</div><div class="stat-value">' + formatMoney(r2.prof) +
        '</div><div class="stat-sub">الفرق: ' + diff(r2.prof, r1.prof) + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">' + r1.label +
        ' - العمليات</div><div class="stat-value">' + r1.cnt + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">' + r2.label +
        ' - العمليات</div><div class="stat-value">' + r2.cnt +
        '</div><div class="stat-sub">الفرق: ' + (r2.cnt - r1.cnt >= 0 ? '+' : '') + (r2.cnt - r1.cnt) +
        '</div></div>' +
        '<div class="stat-card"><div class="stat-label">' + r1.label +
        ' - القطع المباعة</div><div class="stat-value">' + r1.qty + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">' + r2.label +
        ' - القطع المباعة</div><div class="stat-value">' + r2.qty +
        '</div><div class="stat-sub">الفرق: ' + (r2.qty - r1.qty >= 0 ? '+' : '') + (r2.qty - r1.qty) +
        '</div></div>';
    document.getElementById('comparisonChartCard').style.display = 'block';
    createChart('chartComparison', {
        type: 'bar',
        data: { labels: ['الإيرادات', 'الأرباح'], datasets: [{ label: r1.label, data: [r1.rev, r1.prof],
                backgroundColor: '#2b6cb0' }, { label: r2.label, data: [r2.rev, r2.prof],
                backgroundColor: '#27ae60'
            }] },
        options: getArabicChartDefaults()
    });
});

function renderInsights() {
    var now = Date.now();
    var ds = getStartOfDay(),
        ms = getStartOfMonth();
    var todaySales = allSales.filter(function(s) { return s.timestamp >= ds; });
    var monthSales = allSales.filter(function(s) { return s.timestamp >= ms; });
    var monthProfit = monthSales.reduce(function(a, s) { return a + (s.profit || 0); }, 0);
    var dayMap = {};
    allSales.forEach(function(s) { var dk = getDayKey(s.timestamp); if (!dayMap[dk]) dayMap[dk] = { profit: 0,
            revenue: 0, count: 0 };
        dayMap[dk].profit += s.profit || 0;
        dayMap[dk].revenue += s.totalAmount || 0;
        dayMap[dk].count++; });
    var daysArr = Object.entries(dayMap).map(function(e) { return { day: e[0], ...e[1] }; }).sort(function(a, b) {
        return b.profit - a.profit; });
    var bestDay = daysArr[0],
        worstDay = daysArr[daysArr.length - 1];
    var hourMap = {};
    allSales.forEach(function(s) { var h = new Date(s.timestamp).getHours(); if (!hourMap[h]) hourMap[h] = 0;
        hourMap[h]++; });
    var peakHour = Object.entries(hourMap).sort(function(a, b) { return b[1] - a[1]; })[0];
    var soldIds = new Set(allSales.map(function(s) { return s.itemId; }));
    var slowMovers = allItems.filter(function(i) { return !soldIds.has(i.id) && i.quantity > 0; });
    var fastMovers = getTopProducts(5);
    var prevMonthStart = getStartOfMonth(new Date(now - 30 * 86400000));
    var prevMonthSales = allSales.filter(function(s) { return s.timestamp >= prevMonthStart && s.timestamp < ms; });
    var prevMonthProfit = prevMonthSales.reduce(function(a, s) { return a + (s.profit || 0); }, 0);
    var profitGrowth = prevMonthProfit > 0 ? ((monthProfit - prevMonthProfit) / prevMonthProfit * 100) : 0;
    document.getElementById('insightsGrid').innerHTML =
        '<div class="stat-card"><div class="stat-icon" style="background:var(--gradient-2);"><i class="fas fa-calendar-check"></i></div><div class="stat-label">أفضل يوم</div><div class="stat-value" style="font-size:1rem;">' +
        (bestDay ? bestDay.day : '--') + '</div><div class="stat-sub">ربح: ' + formatMoney(bestDay ? bestDay
            .profit : 0) + '</div></div>' +
        '<div class="stat-card"><div class="stat-icon" style="background:var(--gradient-3);"><i class="fas fa-calendar-times"></i></div><div class="stat-label">أسوأ يوم</div><div class="stat-value" style="font-size:1rem;">' +
        (worstDay ? worstDay.day : '--') + '</div><div class="stat-sub">ربح: ' + formatMoney(worstDay ? worstDay
            .profit : 0) + '</div></div>' +
        '<div class="stat-card"><div class="stat-icon" style="background:var(--gradient-4);"><i class="fas fa-clock"></i></div><div class="stat-label">ساعة الذروة</div><div class="stat-value">' +
        (peakHour ? peakHour[0] + ':00' : '--') + '</div><div class="stat-sub">' + (peakHour ? peakHour[1] +
            ' عملية' : '') + '</div></div>' +
        '<div class="stat-card"><div class="stat-icon" style="background:var(--gradient-5);"><i class="fas fa-percentage"></i></div><div class="stat-label">نمو الأرباح الشهري</div><div class="stat-value ' +
        (profitGrowth >= 0 ? 'profit-positive' : 'profit-negative') + '">' + fmt(profitGrowth) +
        '%</div></div>';
    var insightsHtml = '';
    if (bestDay) insightsHtml +=
        '<div class="insight-card"><i class="fas fa-trophy" style="color:#f6ad55;"></i><span class="insight-text">أعلى ربح يومي</span><span class="insight-val profit-positive">' +
        formatMoney(bestDay.profit) + '</span></div>';
    if (fastMovers.length) insightsHtml +=
        '<div class="insight-card"><i class="fas fa-rocket" style="color:#2b6cb0;"></i><span class="insight-text">سريعة الدوران: ' +
        fastMovers.map(function(p) { return escHtml(p.name); }).join('، ') + '</span></div>';
    if (slowMovers.length) insightsHtml +=
        '<div class="insight-card"><i class="fas fa-pause-circle" style="color:#e55353;"></i><span class="insight-text">راكدة: ' +
        slowMovers.slice(0, 5).map(function(i) { return escHtml(i.name); }).join('، ') + '</span></div>';
    var allTimeProfit = allSales.reduce(function(a, s) { return a + (s.profit || 0); }, 0) - getExpensesSum();
    var totalDays = allSales.length > 0 ? Math.max(1, Math.ceil((now - Math.min.apply(null, allSales.map(function(
        s) { return s.timestamp; }))) / 86400000)) : 1;
    insightsHtml +=
        '<div class="insight-card"><i class="fas fa-calculator" style="color:#6b46c1;"></i><span class="insight-text">متوسط الربح اليومي</span><span class="insight-val">' +
        formatMoney(allTimeProfit / totalDays) + '</span></div>';
    insightsHtml +=
        '<div class="insight-card"><i class="fas fa-calendar-alt" style="color:#0987a0;"></i><span class="insight-text">متوسط الربح الشهري</span><span class="insight-val">' +
        formatMoney(allTimeProfit / (totalDays / 30.44)) + '</span></div>';
    document.getElementById('insightsList').innerHTML = insightsHtml;
}

function renderExpenses() {
    var filtered = [...allExpenses];
    var filterDate = document.getElementById('expenseFilterDate') ? document.getElementById('expenseFilterDate')
        .value : '';
    if (filterDate) { var start = new Date(filterDate + 'T00:00:00').getTime(); var end = start + 86400000;
        filtered = filtered.filter(function(e) { return e.date >= start && e.date < end; }); }
    var html = '';
    filtered.forEach(function(e) { html += '<tr><td>' + fmtDate(e.date) + '</td><td>' + formatMoney(e.amount) +
            '</td><td>' + escHtml(e.description || '') +
            '</td><td><button onclick="deleteExpense(\'' + e.id +
            '\')" style="color:var(--danger);background:none;border:none;cursor:pointer;"><i class="fas fa-trash"></i></button></td></tr>'; });
    if (!filtered.length) html =
        '<tr><td colspan="4" style="padding:30px;color:var(--text3);">لا توجد مصاريف</td></tr>';
    document.getElementById('expensesBody').innerHTML = html;
}
document.getElementById('addExpenseBtn').addEventListener('click', function() { document.getElementById(
    'expenseModal').classList.add('show'); });
document.getElementById('saveExpenseBtn').addEventListener('click', async function() {
    var date = document.getElementById('expenseDate').value;
    var amount = parseFloat(document.getElementById('expenseAmount').value);
    var desc = document.getElementById('expenseDesc').value.trim();
    if (!date || !amount) { showToast('يرجى ملء البيانات'); return; }
    var expRef = await db.collection('expenses').add({ date: new Date(date + 'T00:00:00').getTime(), amount: amount,
        description: desc });
    await logActivity('expenseAdd', 'expense', expRef.id, 'إضافة مصروف: ' + desc + '، المبلغ: ' + amount, { amount: amount, description: desc });
    closeModalById('expenseModal');
    clearAllCaches();
    await fetchExpensesSmart();
    showToast('تمت الإضافة');
});
window.deleteExpense = async function(id) {
    if (confirm('حذف المصروف؟')) { await db.collection('expenses').doc(id).delete();
        await logActivity('expenseDelete', 'expense', id, 'حذف مصروف', { id: id });
        clearAllCaches();
        await fetchExpensesSmart();
        renderExpenses();
        showToast('تم الحذف'); }
};
document.getElementById('applyExpenseFilter').addEventListener('click', renderExpenses);

function renderCategories() {
    populateCategorySelect();
    renderCategoriesListUI();
    renderProductsChecklistForCategory('');
}

function renderCategoriesListUI() {
    var container = document.getElementById('categoriesList');
    if (!container) return;
    if (!allCategories.length) { container.innerHTML = '<div>لا توجد فئات</div>'; return; }
    var html = '';
    allCategories.forEach(function(cat) {
        var count = allItems.filter(function(i) { return i.categoryId === cat.id; }).length;
        var iconHtml = cat.icon ? '<i class="' + cat.icon + '"></i>' : '<i class="fas fa-tag"></i>';
        html += '<div class="cat-list-item"><div class="cat-name-icon">' + iconHtml + ' <strong>' + escHtml(cat
            .name) + '</strong> (' + count + ' منتج)</div><div class="cat-actions"><button class="edit-cat-icon" data-id="' +
            cat.id + '" data-name="' + escHtml(cat.name) + '" data-icon="' + escHtml(cat.icon || '') +
            '"><i class="fas fa-pencil-alt"></i></button><button class="delete-cat-icon" data-id="' + cat.id +
            '"><i class="fas fa-times"></i></button></div></div>';
    });
    container.innerHTML = html;
    document.querySelectorAll('.edit-cat-icon').forEach(function(btn) { btn.addEventListener('click', function() {
            var newName = prompt('الاسم الجديد', btn.dataset.name); if (newName) { var newIcon =
                prompt('الأيقونة الجديدة', btn.dataset.icon);
                updateCategory(btn.dataset.id, newName, newIcon || ''); } }); });
    document.querySelectorAll('.delete-cat-icon').forEach(function(btn) { btn.addEventListener('click', function() {
            deleteCategory(btn.dataset.id); }); });
}

async function updateCategory(catId, newName, newIcon) {
    await db.collection('categories').doc(catId).update({ name: newName, icon: newIcon });
    await logActivity('update', 'category', catId, 'تعديل فئة: ' + newName, { name: newName, icon: newIcon });
    var cat = allCategories.find(function(c) { return c.id === catId; });
    if (cat) { cat.name = newName;
        cat.icon = newIcon; }
    allCategories.sort(function(a, b) { return a.name.localeCompare(b.name, 'ar', { sensitivity: 'base' }); });
    renderCategoriesListUI();
    populateCategorySelect();
    showToast('تم التحديث');
}

async function deleteCategory(catId) {
    if (!confirm('حذف الفئة؟')) return;
    await db.collection('categories').doc(catId).delete();
    await logActivity('delete', 'category', catId, 'حذف فئة', { categoryId: catId });
    allCategories = allCategories.filter(function(c) { return c.id !== catId; });
    for (var pi = 0; pi < allItems.length; pi++) { if (allItems[pi].categoryId === catId) { allItems[pi].categoryId =
                null;
            allItems[pi].categoryName = '';
            await db.collection('items').doc(allItems[pi].id).update({ categoryId: null, categoryName: '' }); } }
    renderCategoriesListUI();
    populateCategorySelect();
    showToast('تم الحذف');
}
document.getElementById('createCategoryBtn').addEventListener('click', async function() {
    var name = document.getElementById('newCategoryName').value.trim();
    var icon = document.getElementById('newCategoryIcon').value.trim();
    if (!name) return;
    var ref = await db.collection('categories').add({ name: name, icon: icon || '', createdAt: Date.now() });
    await logActivity('create', 'category', ref.id, 'إضافة فئة: ' + name, { name: name, icon: icon });
    allCategories.push({ id: ref.id, name: name, icon: icon || '' });
    allCategories.sort(function(a, b) { return a.name.localeCompare(b.name, 'ar', { sensitivity: 'base' }); });
    renderCategoriesListUI();
    populateCategorySelect();
    document.getElementById('newCategoryName').value = '';
    document.getElementById('newCategoryIcon').value = '';
    showToast('تمت الإضافة');
});

function renderProductsChecklistForCategory(categoryId) {
    var container = document.getElementById('productsChecklist');
    if (!container) return;
    var filtered = [...allItems];
    var search = document.getElementById('assignProductSearch') ? document.getElementById('assignProductSearch')
        .value.trim() : '';
    if (search) { filtered = filtered.filter(function(p) { return p.name.includes(search); }); }
    filtered.sort(arabicAlphabeticalComparator);
    if (!filtered.length) { container.innerHTML = 'لا توجد منتجات'; return; }
    var html = '';
    filtered.forEach(function(prod) { var checked = (categoryId && prod.categoryId === categoryId);
        html += '<div class="product-check"><input type="checkbox" value="' + prod.id + '" id="prod_' + prod.id +
            '" ' + (checked ? 'checked' : '') + '> <label for="prod_' + prod.id + '">' + escHtml(prod.name) +
            '</label></div>'; });
    container.innerHTML = html;
}
document.getElementById('assignCategorySelect').addEventListener('change', function(e) {
    renderProductsChecklistForCategory(e.target.value);
});
document.getElementById('assignProductSearch').addEventListener('input', function() {
    var catId = document.getElementById('assignCategorySelect').value;
    renderProductsChecklistForCategory(catId);
});
document.getElementById('assignProductsBtn').addEventListener('click', async function() {
    var catId = document.getElementById('assignCategorySelect').value;
    if (!catId) return alert('اختر فئة');
    var checks = document.querySelectorAll('#productsChecklist input:checked');
    var productIds = Array.from(checks).map(function(ch) { return ch.value; });
    if (!productIds.length) return alert('اختر منتجات');
    var cat = allCategories.find(function(c) { return c.id === catId; });
    if (!cat) return;
    var batch = db.batch();
    for (var pi = 0; pi < productIds.length; pi++) { var pid = productIds[pi]; var p = allItems.find(function(i) {
            return i.id === pid; }); if (p) { p.categoryId = catId;
            p.categoryName = cat.name;
            batch.update(db.collection('items').doc(pid), { categoryId: catId, categoryName: cat.name }); } }
    await batch.commit();
    await logActivity('assign', 'item', null, 'تعيين منتجات للفئة: ' + cat.name, { categoryId: catId, categoryName: cat.name, products: productIds });
    showToast('تم التعيين');
});

function renderStoreInfo() {
    document.getElementById('storeName').value = storeInfoData.name || '';
    document.getElementById('storeAddress').value = storeInfoData.address || '';
    document.getElementById('storePhone').value = storeInfoData.phone || '';
    document.getElementById('storeMapLink').value = storeInfoData.googleMapsLink || '';
    document.getElementById('storeImageUrl').value = storeInfoData.imageUrl || '';
    document.getElementById('storeVideoUrl').value = storeInfoData.videoUrl || '';
    document.getElementById('storeHideOutOfStock').checked = storeInfoData.hideOutOfStock === true;
    loadSocialLinks(storeInfoData.socialLinks || []);
}

function addSocialRow(url, icon) {
    url = url || '';
    icon = icon || '';
    var div = document.createElement('div');
    div.className = 'social-row';
    div.innerHTML =
        '<input type="url" placeholder="الرابط" value="' + escHtml(url) +
        '"><input type="text" placeholder="أيقونة" value="' + escHtml(icon) +
        '"><button type="button" class="remove-social">✖</button>';
    div.querySelector('.remove-social').addEventListener('click', function() { div.remove(); });
    document.getElementById('socialLinksContainer').appendChild(div);
}

function collectSocialLinks() {
    var rows = document.querySelectorAll('#socialLinksContainer .social-row');
    var links = [];
    rows.forEach(function(row) { var inputs = row.querySelectorAll('input'); if (inputs[0] && inputs[0].value.trim())
            links.push({ network: '', url: inputs[0].value.trim(), icon: inputs[1] ? inputs[1].value.trim() :
                '' }); });
    return links;
}

function loadSocialLinks(links) {
    var container = document.getElementById('socialLinksContainer');
    container.innerHTML = '';
    if (links && links.length) links.forEach(function(l) { addSocialRow(l.url || '', l.icon || ''); });
    else addSocialRow('', '');
}
document.getElementById('addSocialBtn').addEventListener('click', function() { addSocialRow('', ''); });
document.getElementById('storeInfoForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var info = { name: document.getElementById('storeName').value.trim(), address: document.getElementById(
            'storeAddress').value.trim(), phone: document.getElementById('storePhone').value.trim(),
        googleMapsLink: document.getElementById('storeMapLink').value.trim(), imageUrl: document.getElementById(
            'storeImageUrl').value.trim(), videoUrl: document.getElementById('storeVideoUrl').value.trim(),
        socialLinks: collectSocialLinks(), hideOutOfStock: document.getElementById('storeHideOutOfStock')
            .checked };
    await db.collection('storeInfo').doc('info').set(info);
    await logActivity('storeUpdate', 'storeInfo', 'info', 'تحديث معلومات المتجر', info);
    storeInfoData = info;
    showToast('تم الحفظ');
});
document.getElementById('cancelStoreInfoBtn').addEventListener('click', function() { renderStoreInfo(); });

document.getElementById('currencySettingsForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var previousCurrency = JSON.parse(JSON.stringify(currencySettings));
    var ns = { secondaryCurrencyName: document.getElementById('secondaryCurrencyName').value.trim(),
        secondaryCurrencySymbol: document.getElementById('secondaryCurrencySymbol').value.trim(),
        exchangeRate: parseFloat(document.getElementById('exchangeRate').value),
        defaultInputCurrency: document.querySelector('input[name="defaultInputCurrency"]:checked').value,
        defaultSellCurrency: document.querySelector('input[name="defaultSellCurrency"]:checked').value };
    if (!ns.secondaryCurrencyName || !ns.secondaryCurrencySymbol || isNaN(ns.exchangeRate) || ns.exchangeRate <=
        0) return alert('بيانات غير صالحة');
    await db.collection('currencySettings').doc('settings').set(ns);
    var change = buildCurrencyChangeDetails(previousCurrency, ns);
    await logActivity('currencyUpdate', 'currencySettings', 'settings', change.details || 'تحديث إعدادات العملة', change.metadata);
    currencySettings = ns;
    tempPurchaseCurrency = (ns.defaultInputCurrency === 'secondary');
    tempSaleCurrency = (ns.defaultInputCurrency === 'secondary');
    tempSellCurrency = (ns.defaultSellCurrency === 'secondary');
    updatePriceLabels();
    showToast('تم حفظ الإعدادات');
});
document.getElementById('cancelCurrencySettingsBtn').addEventListener('click', function() {
    document.getElementById('secondaryCurrencyName').value = currencySettings.secondaryCurrencyName;
    document.getElementById('secondaryCurrencySymbol').value = currencySettings.secondaryCurrencySymbol;
    document.getElementById('exchangeRate').value = currencySettings.exchangeRate;
});

function renderSliderItems() {
    var filtered = getFilteredSliderItems();
    var container = document.getElementById('sliderItemsContainer');
    if (!container) return;
    if (filtered.length === 0) {
        container.innerHTML =
            '<div class="empty-state"><i class="fas fa-inbox"></i><h3>لا توجد عناصر</h3><p>اضغط على "إضافة جديد" للبدء</p></div>';
        return;
    }
    var html = '';
    filtered.forEach(function(item) {
        var status = getSliderItemStatus(item);
        var previewStyle = buildSliderPreviewStyle(item);
        var previewContent = buildSliderMiniPreview(item);
        html += '<div class="slider-item-card"><div class="slider-item-preview-mini" style="' + previewStyle +
            '">' + previewContent + '</div>' +
            '<div class="slider-item-info"><h3>' + escHtml(item.title || 'بدون عنوان') +
            ' <span class="meta-tag ' + status.class + '"><i class="fas ' + status.icon + '"></i> ' + status
            .label + '</span></h3>' +
            '<p>' + escHtml((item.subtitle || '').substring(0, 80)) + ((item.subtitle || '').length > 80 ? '...' :
                '') + '</p>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">' + (item.priority ?
                '<span class="meta-tag"><i class="fas fa-sort-up"></i> أولوية ' + item.priority + '</span>' :
                '') + (item.startDate ? '<span class="meta-tag"><i class="fas fa-calendar"></i> ' + new Date(
                item.startDate).toLocaleDateString('ar') + '</span>' : '') + (item.endDate ?
                '<span class="meta-tag"><i class="fas fa-calendar-check"></i> ' + new Date(item.endDate)
                .toLocaleDateString('ar') + '</span>' : '') + '</div></div>' +
            '<div class="slider-item-actions">' +
            '<button class="icon-btn edit-btn" data-id="' + item.id +
            '" title="تعديل"><i class="fas fa-pen"></i></button>' +
            '<button class="icon-btn duplicate-btn" data-id="' + item.id +
            '" title="نسخ"><i class="fas fa-copy"></i></button>' +
            '<button class="icon-btn hide-btn" data-id="' + item.id + '" title="' + (item.hidden ? 'إظهار' :
                'إخفاء') + '"><i class="fas ' + (item.hidden ? 'fa-eye-slash' : 'fa-eye') +
            '"></i></button>' +
            '<button class="icon-btn delete-btn" data-id="' + item.id +
            '" title="حذف"><i class="fas fa-trash"></i></button></div></div>';
    });
    container.innerHTML = html;
    bindSliderItemActions();
}

function getFilteredSliderItems() {
    var filtered = [...allSliderItems];
    var now = new Date();
    if (sliderSearchQuery) { var q = sliderSearchQuery.toLowerCase();
        filtered = filtered.filter(function(i) { return (i.title || '').toLowerCase().includes(q) || (i.subtitle ||
                '').toLowerCase().includes(q); }); }
    if (sliderActiveFilter === 'active') { filtered = filtered.filter(function(i) { return !i.hidden &&
                isSliderItemActive(i, now); }); } else if (sliderActiveFilter === 'hidden') { filtered = filtered
            .filter(function(i) { return i.hidden; }); } else if (sliderActiveFilter === 'scheduled') { filtered =
            filtered.filter(function(i) { return i.startDate || i.endDate; }); }
    return filtered;
}

function isSliderItemActive(item, now) {
    if (item.hidden) return false;
    if (item.startDate && new Date(item.startDate) > now) return false;
    if (item.endDate && new Date(item.endDate) < now) return false;
    return true;
}

function getSliderItemStatus(item) {
    var now = new Date();
    if (item.hidden) return { label: 'مخفي', class: 'status-hidden', icon: 'fa-eye-slash' };
    if (item.startDate && new Date(item.startDate) > now) return { label: 'مجدول', class: 'status-scheduled',
        icon: 'fa-clock' };
    if (item.endDate && new Date(item.endDate) < now) return { label: 'منتهي', class: 'status-hidden',
        icon: 'fa-calendar-xmark' };
    return { label: 'مفعل', class: 'status-active', icon: 'fa-circle-check' };
}

function buildSliderPreviewStyle(item) {
    var bg = item.backgroundColor || '#ffffff';
    if (item.gradient1 && item.gradient2) { bg = 'linear-gradient(' + (item.gradientDir || 'to right') + ', ' + item
            .gradient1 + ', ' + item.gradient2 + ')'; }
    if (item.bgImage) { bg = 'url(' + item.bgImage + ') center/cover no-repeat'; }
    var borderW = item.borderWidth || 1;
    var borderC = item.borderColor || '#e2e8f0';
    var radius = (item.borderRadius !== undefined) ? item.borderRadius + 'px' : '16px';
    var shadow = item.shadow || '0 2px 8px rgba(0,0,0,0.08)';
    return 'background:' + bg + ';color:' + (item.textColor || '#1e293b') + ';border:' + borderW + 'px solid ' +
        borderC + ';border-radius:' + radius + ';box-shadow:' + shadow + ';';
}

function buildSliderMiniPreview(item) {
    var html = '';
    if (item.imageUrl) { html += '<img src="' + item.imageUrl +
            '" alt="" loading="lazy" onerror="this.style.display=\'none\';" style="border-radius:' + (item
            .imageShape || '8px') + ';width:36px;height:36px;object-fit:cover;">'; } else if (item.icon) { html +=
            '<span style="font-size:1.5rem;"><i class="' + item.icon + '"></i></span>'; }
    html += '<span style="font-size:0.75rem;font-weight:700;">' + escHtml((item.title || '').substring(0, 30)) +
        '</span>';
    return html;
}

function bindSliderItemActions() {
    document.querySelectorAll('#sliderItemsContainer .edit-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { openSliderEditModal(btn.dataset.id); });
    });
    document.querySelectorAll('#sliderItemsContainer .hide-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { toggleSliderHide(btn.dataset.id); });
    });
    document.querySelectorAll('#sliderItemsContainer .duplicate-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { duplicateSliderItem(btn.dataset.id); });
    });
    document.querySelectorAll('#sliderItemsContainer .delete-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { deleteSliderItem(btn.dataset.id); });
    });
}

function openSliderEditModal(id) {
    currentSliderEditId = id || null;
    currentThumbnails = [];
    if (id) {
        var item = allSliderItems.find(function(i) { return i.id === id; });
        if (!item) return;
        document.getElementById('sliderEditTitle').value = item.title || '';
        document.getElementById('sliderEditSubtitle').value = item.subtitle || '';
        document.getElementById('sliderEditIcon').value = item.icon || '';
        document.getElementById('sliderIconPreview').innerHTML = item.icon ? '<i class="' + item.icon +
            '"></i>' : '<i class="fas fa-icons"></i>';
        document.getElementById('sliderEditIconAlign').value = item.iconAlign || 'center';
        document.getElementById('sliderEditImageUrl').value = item.imageUrl || '';
        document.getElementById('sliderEditImageAlign').value = item.imageAlign || 'center';
        document.getElementById('sliderEditImageShape').value = item.imageShape || '12px';
        currentThumbnails = item.thumbnails || [];
        document.getElementById('sliderEditThumbnails').value = JSON.stringify(currentThumbnails);
        document.getElementById('sliderEditThumbsAlign').value = item.thumbsAlign || 'center';
        document.getElementById('sliderEditThumbsShape').value = item.thumbsShape || '8px';
        document.getElementById('sliderEditButtonText').value = item.buttonText || '';
        document.getElementById('sliderEditButtonLink').value = item.buttonLink || '';
        document.getElementById('sliderEditTextAlign').value = item.textAlign || 'center';
        document.getElementById('sliderEditBgColor').value = item.backgroundColor || '#ffffff';
        document.getElementById('sliderEditGradient1').value = item.gradient1 || '#ffffff';
        document.getElementById('sliderEditGradient2').value = item.gradient2 || '#f8fafc';
        document.getElementById('sliderEditGradientDir').value = item.gradientDir || 'to right';
        document.getElementById('sliderEditBgImage').value = item.bgImage || '';
        document.getElementById('sliderEditTextColor').value = item.textColor || '#1e293b';
        document.getElementById('sliderEditBorderColor').value = item.borderColor || '#e2e8f0';
        document.getElementById('sliderEditBorderWidth').value = item.borderWidth || 1;
        document.getElementById('sliderBorderWidthVal').textContent = (item.borderWidth || 1) + 'px';
        document.getElementById('sliderEditBorderRadius').value = (item.borderRadius !== undefined) ? item
            .borderRadius : 16;
        document.getElementById('sliderBorderRadiusVal').textContent = ((item.borderRadius !== undefined) ? item
            .borderRadius : 16) + 'px';
        document.getElementById('sliderEditShadow').value = item.shadow || '0 8px 24px rgba(0,0,0,0.12)';
        document.getElementById('sliderEditAutoSlideDelay').value = item.autoSlideDelay || 0;
        document.getElementById('sliderEditStartDate').value = item.startDate ? new Date(item.startDate)
            .toISOString().slice(0, 16) : '';
        document.getElementById('sliderEditEndDate').value = item.endDate ? new Date(item.endDate).toISOString()
            .slice(0, 16) : '';
        document.getElementById('sliderEditPriority').value = item.priority || 0;
        document.getElementById('sliderModalTitle').innerHTML =
            '<i class="fas fa-pen-to-square"></i> تعديل العنصر';
    } else {
        document.getElementById('sliderEditTitle').value = '';
        document.getElementById('sliderEditSubtitle').value = '';
        document.getElementById('sliderEditIcon').value = '';
        document.getElementById('sliderIconPreview').innerHTML = '<i class="fas fa-icons"></i>';
        document.getElementById('sliderEditIconAlign').value = 'center';
        document.getElementById('sliderEditImageUrl').value = '';
        document.getElementById('sliderEditImageAlign').value = 'center';
        document.getElementById('sliderEditImageShape').value = '12px';
        currentThumbnails = [];
        document.getElementById('sliderEditThumbnails').value = '[]';
        document.getElementById('sliderEditThumbsAlign').value = 'center';
        document.getElementById('sliderEditThumbsShape').value = '8px';
        document.getElementById('sliderEditButtonText').value = '';
        document.getElementById('sliderEditButtonLink').value = '';
        document.getElementById('sliderEditTextAlign').value = 'center';
        document.getElementById('sliderEditBgColor').value = '#ffffff';
        document.getElementById('sliderEditGradient1').value = '#ffffff';
        document.getElementById('sliderEditGradient2').value = '#f8fafc';
        document.getElementById('sliderEditGradientDir').value = 'to right';
        document.getElementById('sliderEditBgImage').value = '';
        document.getElementById('sliderEditTextColor').value = '#1e293b';
        document.getElementById('sliderEditBorderColor').value = '#e2e8f0';
        document.getElementById('sliderEditBorderWidth').value = 1;
        document.getElementById('sliderBorderWidthVal').textContent = '1px';
        document.getElementById('sliderEditBorderRadius').value = 16;
        document.getElementById('sliderBorderRadiusVal').textContent = '16px';
        document.getElementById('sliderEditShadow').value = '0 8px 24px rgba(0,0,0,0.12)';
        document.getElementById('sliderEditAutoSlideDelay').value = 0;
        document.getElementById('sliderEditStartDate').value = '';
        document.getElementById('sliderEditEndDate').value = '';
        document.getElementById('sliderEditPriority').value = 0;
        document.getElementById('sliderModalTitle').innerHTML =
            '<i class="fas fa-pen-to-square"></i> إضافة عنصر جديد';
    }
    renderSliderThumbnailsEditor();
    updateSliderLivePreview();
    document.getElementById('sliderEditModal').classList.add('show');
}

function renderSliderThumbnailsEditor() {
    var editor = document.getElementById('sliderThumbnailsEditor');
    if (!editor) return;
    editor.innerHTML = '';
    currentThumbnails.forEach(function(url, index) {
        var div = document.createElement('div');
        div.style.position = 'relative';
        div.innerHTML = '<img src="' + url +
            '" class="image-thumb-item" loading="lazy" onerror="this.parentElement.remove();"><button class="remove-thumb" data-index="' +
            index + '" title="حذف"><i class="fas fa-xmark"></i></button>';
        div.querySelector('.remove-thumb').addEventListener('click', function() {
            currentThumbnails.splice(index, 1);
            document.getElementById('sliderEditThumbnails').value = JSON.stringify(
                currentThumbnails);
            renderSliderThumbnailsEditor();
            updateSliderLivePreview();
        });
        editor.appendChild(div);
    });
    var addBtn = document.createElement('button');
    addBtn.className = 'add-thumb-btn';
    addBtn.innerHTML = '<i class="fas fa-plus"></i>';
    addBtn.addEventListener('click', function() {
        var url = document.getElementById('sliderEditThumbUrl').value.trim();
        if (url) { currentThumbnails.push(url);
            document.getElementById('sliderEditThumbnails').value = JSON.stringify(currentThumbnails);
            document.getElementById('sliderEditThumbUrl').value = '';
            renderSliderThumbnailsEditor();
            updateSliderLivePreview(); }
    });
    editor.appendChild(addBtn);
    document.getElementById('sliderEditThumbnails').value = JSON.stringify(currentThumbnails);
}

function updateSliderLivePreview() {
    var card = document.getElementById('sliderLivePreview');
    if (!card) return;
    var bg = document.getElementById('sliderEditBgColor').value || '#ffffff';
    var g1 = document.getElementById('sliderEditGradient1').value || '#ffffff';
    var g2 = document.getElementById('sliderEditGradient2').value || '#f8fafc';
    var gDir = document.getElementById('sliderEditGradientDir').value || 'to right';
    var bgImg = document.getElementById('sliderEditBgImage').value.trim();
    var txtColor = document.getElementById('sliderEditTextColor').value || '#1e293b';
    var borderW = parseFloat(document.getElementById('sliderEditBorderWidth').value) || 1;
    var borderC = document.getElementById('sliderEditBorderColor').value || '#e2e8f0';
    var radius = parseInt(document.getElementById('sliderEditBorderRadius').value) || 16;
    var shadow = document.getElementById('sliderEditShadow').value || '0 8px 24px rgba(0,0,0,0.12)';
    var title = document.getElementById('sliderEditTitle').value || 'عنوان تجريبي';
    var subtitle = document.getElementById('sliderEditSubtitle').value || '';
    var iconClass = document.getElementById('sliderEditIcon').value.trim();
    var imgUrl = document.getElementById('sliderEditImageUrl').value.trim();
    var btnText = document.getElementById('sliderEditButtonText').value.trim();
    var imageShape = document.getElementById('sliderEditImageShape').value || '12px';
    var bgStyle = bg;
    if (g1 !== g2) bgStyle = 'linear-gradient(' + gDir + ', ' + g1 + ', ' + g2 + ')';
    if (bgImg) bgStyle = 'url(' + bgImg + ') center/cover no-repeat';
    var mediaHtml = '';
    if (imgUrl) { mediaHtml =
            '<img src="' + imgUrl +
            '" style="width:60px;height:60px;border-radius:' + imageShape +
            ';object-fit:cover;flex-shrink:0;" onerror="this.style.display=\'none\';">'; } else if (iconClass) { mediaHtml =
            '<i class="' + iconClass + '" style="font-size:2rem;flex-shrink:0;"></i>'; }
    var btnHtml = '';
    if (btnText) { btnHtml =
            '<a href="#" style="display:inline-block;background:' + txtColor + ';color:' + bg +
            ';padding:7px 18px;border-radius:30px;text-decoration:none;font-weight:700;font-size:0.8rem;margin-top:6px;">' +
            escHtml(btnText) + '</a>'; }
    card.style.background = bgStyle;
    card.style.color = txtColor;
    card.style.border = borderW + 'px solid ' + borderC;
    card.style.borderRadius = radius + 'px';
    card.style.boxShadow = shadow;
    card.innerHTML = '<span class="preview-label">معاينة</span><div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;width:100%;">' +
        mediaHtml +
        '<div style="flex:1;min-width:140px;"><div style="font-weight:800;font-size:1.1rem;">' + escHtml(title) +
        '</div>' + (subtitle ? '<div style="font-size:0.85rem;opacity:0.85;">' + escHtml(subtitle) + '</div>' :
            '') + btnHtml + '</div></div>';
}

var sliderFormInputs = ['sliderEditTitle', 'sliderEditSubtitle', 'sliderEditIcon', 'sliderEditIconAlign',
    'sliderEditImageUrl', 'sliderEditImageAlign', 'sliderEditImageShape', 'sliderEditThumbsAlign',
    'sliderEditThumbsShape', 'sliderEditButtonText', 'sliderEditButtonLink', 'sliderEditTextAlign',
    'sliderEditBgColor', 'sliderEditGradient1', 'sliderEditGradient2', 'sliderEditGradientDir',
    'sliderEditBgImage', 'sliderEditTextColor', 'sliderEditBorderColor', 'sliderEditShadow',
    'sliderEditAutoSlideDelay', 'sliderEditStartDate', 'sliderEditEndDate', 'sliderEditPriority'
];
sliderFormInputs.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.addEventListener('input', updateSliderLivePreview);
        el.addEventListener('change', updateSliderLivePreview); }
});
document.getElementById('sliderEditBorderWidth').addEventListener('input', function() {
    document.getElementById('sliderBorderWidthVal').textContent = document.getElementById('sliderEditBorderWidth')
        .value + 'px';
    updateSliderLivePreview();
});
document.getElementById('sliderEditBorderRadius').addEventListener('input', function() {
    document.getElementById('sliderBorderRadiusVal').textContent = document.getElementById(
        'sliderEditBorderRadius').value + 'px';
    updateSliderLivePreview();
});
document.getElementById('addSliderThumbBtn').addEventListener('click', function() {
    var url = document.getElementById('sliderEditThumbUrl').value.trim();
    if (url) { currentThumbnails.push(url);
        document.getElementById('sliderEditThumbnails').value = JSON.stringify(currentThumbnails);
        document.getElementById('sliderEditThumbUrl').value = '';
        renderSliderThumbnailsEditor();
        updateSliderLivePreview(); }
});

document.getElementById('saveSliderItemBtn').addEventListener('click', async function() {
    var title = document.getElementById('sliderEditTitle').value.trim();
    if (!title) { showToast('العنوان مطلوب', 'error'); return; }
    var itemData = {
        title: title,
        subtitle: document.getElementById('sliderEditSubtitle').value.trim(),
        icon: document.getElementById('sliderEditIcon').value.trim(),
        iconAlign: document.getElementById('sliderEditIconAlign').value,
        imageUrl: document.getElementById('sliderEditImageUrl').value.trim(),
        imageAlign: document.getElementById('sliderEditImageAlign').value,
        imageShape: document.getElementById('sliderEditImageShape').value,
        thumbnails: currentThumbnails,
        thumbsAlign: document.getElementById('sliderEditThumbsAlign').value,
        thumbsShape: document.getElementById('sliderEditThumbsShape').value,
        buttonText: document.getElementById('sliderEditButtonText').value.trim(),
        buttonLink: document.getElementById('sliderEditButtonLink').value.trim(),
        textAlign: document.getElementById('sliderEditTextAlign').value,
        backgroundColor: document.getElementById('sliderEditBgColor').value,
        gradient1: document.getElementById('sliderEditGradient1').value,
        gradient2: document.getElementById('sliderEditGradient2').value,
        gradientDir: document.getElementById('sliderEditGradientDir').value,
        bgImage: document.getElementById('sliderEditBgImage').value.trim(),
        textColor: document.getElementById('sliderEditTextColor').value,
        borderColor: document.getElementById('sliderEditBorderColor').value,
        borderWidth: parseFloat(document.getElementById('sliderEditBorderWidth').value) || 1,
        borderRadius: parseInt(document.getElementById('sliderEditBorderRadius').value) || 16,
        shadow: document.getElementById('sliderEditShadow').value,
        autoSlideDelay: parseInt(document.getElementById('sliderEditAutoSlideDelay').value) || 0,
        startDate: document.getElementById('sliderEditStartDate').value || null,
        endDate: document.getElementById('sliderEditEndDate').value || null,
        priority: parseInt(document.getElementById('sliderEditPriority').value) || 0,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    try {
        if (currentSliderEditId) {
            var existing = allSliderItems.find(function(i) { return i.id === currentSliderEditId; });
            itemData.hidden = existing ? existing.hidden || false : false;
            itemData.order = existing ? existing.order || 0 : 0;
            await db.collection('sliderTips').doc(currentSliderEditId).update(itemData);
            await logActivity('sliderUpdate', 'sliderItem', currentSliderEditId, 'تحديث عنصر السلايدر: ' + title, { title: title, id: currentSliderEditId });
            var idx = allSliderItems.findIndex(function(i) { return i.id === currentSliderEditId; });
            if (idx !== -1) allSliderItems[idx] = { id: currentSliderEditId, ...itemData };
            showToast('تم التحديث');
        } else {
            itemData.hidden = false;
            itemData.order = allSliderItems.length > 0 ? Math.max.apply(null, allSliderItems.map(function(i) {
                return i.order || 0; })) + 1 : 1;
            itemData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            var docRef = await db.collection('sliderTips').add(itemData);
            allSliderItems.push({ id: docRef.id, ...itemData });
            await logActivity('sliderCreate', 'sliderItem', docRef.id, 'إضافة عنصر سلايدر: ' + title, { title: title, id: docRef.id });
            showToast('تمت الإضافة');
        }
        allSliderItems.sort(function(a, b) { return (b.priority || 0) - (a.priority || 0) || (a.order || 0) - (b.order || 0); });
        closeModalById('sliderEditModal');
        renderSliderItems();
    } catch (err) { showToast('خطأ: ' + err.message, 'error'); }
});

async function toggleSliderHide(id) {
    var item = allSliderItems.find(function(i) { return i.id === id; });
    if (!item) return;
    await db.collection('sliderTips').doc(id).update({ hidden: !item.hidden });
    item.hidden = !item.hidden;
    await logActivity('sliderHide', 'sliderItem', id, item.hidden ? 'إخفاء عنصر السلايدر: ' + item.title : 'إظهار عنصر السلايدر: ' + item.title, { title: item.title, hidden: item.hidden });
    renderSliderItems();
    showToast(item.hidden ? 'تم الإخفاء' : 'تم الإظهار');
}

async function duplicateSliderItem(id) {
    var item = allSliderItems.find(function(i) { return i.id === id; });
    if (!item) return;
    var newData = { ...item };
    delete newData.id;
    delete newData.createdAt;
    delete newData.updatedAt;
    newData.title = (newData.title || '') + ' (نسخة)';
    newData.order = allSliderItems.length > 0 ? Math.max.apply(null, allSliderItems.map(function(i) { return i
            .order || 0; })) + 1 : 1;
    newData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    var docRef = await db.collection('sliderTips').add(newData);
    allSliderItems.push({ id: docRef.id, ...newData });
    await logActivity('sliderDuplicate', 'sliderItem', docRef.id, 'نسخ عنصر السلايدر: ' + item.title, { originalId: id, newId: docRef.id });
    allSliderItems.sort(function(a, b) { return (b.priority || 0) - (a.priority || 0) || (a.order || 0) - (b.order ||
        0); });
    renderSliderItems();
    showToast('تم النسخ');
}

async function deleteSliderItem(id) {
    if (!confirm('حذف العنصر نهائياً؟')) return;
    var item = allSliderItems.find(function(i) { return i.id === id; });
    await db.collection('sliderTips').doc(id).delete();
    await logActivity('sliderDelete', 'sliderItem', id, 'حذف عنصر السلايدر: ' + (item ? item.title : id), { title: item ? item.title : '', id: id });
    allSliderItems = allSliderItems.filter(function(i) { return i.id !== id; });
    renderSliderItems();
    showToast('تم الحذف');
}

document.getElementById('addSliderItemBtn').addEventListener('click', function() { openSliderEditModal(null); });
document.getElementById('sliderSearchInput').addEventListener('input', function() {
    sliderSearchQuery = document.getElementById('sliderSearchInput').value.trim();
    renderSliderItems();
});
document.getElementById('sliderFilterChips').addEventListener('click', function(e) {
    if (e.target.classList.contains('filter-chip')) {
        document.querySelectorAll('#sliderFilterChips .filter-chip').forEach(function(c) { c.classList.remove(
                'active'); });
        e.target.classList.add('active');
        sliderActiveFilter = e.target.dataset.filter;
        renderSliderItems();
    }
});
document.getElementById('saveDelayBtn').addEventListener('click', async function() {
    var delay = parseInt(document.getElementById('autoSlideDelayInput').value) || 5000;
    await db.collection('sliderSettings').doc('settings').set({ autoSlideDelay: delay }, { merge: true });
    await logActivity('sliderUpdate', 'sliderItem', 'settings', 'تحديث مدة عرض السلايدر: ' + delay, { autoSlideDelay: delay });
    globalAutoSlideDelay = delay;
    showToast('تم حفظ المدة');
});
document.getElementById('openSliderIconPicker').addEventListener('click', function() {
    document.getElementById('sliderIconPickerModal').classList.add('active');
    document.getElementById('sliderIconSearchInput').value = '';
    renderSliderIconsGrid();
});
document.getElementById('closeSliderIconPicker').addEventListener('click', function() {
    document.getElementById('sliderIconPickerModal').classList.remove('active');
});
document.getElementById('clearSliderIcon').addEventListener('click', function() {
    document.getElementById('sliderEditIcon').value = '';
    document.getElementById('sliderIconPreview').innerHTML = '<i class="fas fa-icons"></i>';
    updateSliderLivePreview();
});
document.getElementById('sliderIconSearchInput').addEventListener('input', function() {
    renderSliderIconsGrid(document.getElementById('sliderIconSearchInput').value);
});
document.getElementById('sliderIconPickerModal').addEventListener('click', function(e) {
    if (e.target === document.getElementById('sliderIconPickerModal')) document.getElementById(
        'sliderIconPickerModal').classList.remove('active');
});

function renderSliderIconsGrid(filter) {
    filter = filter || '';
    var filtered = popularIcons.filter(function(icon) { return icon.toLowerCase().includes(filter.toLowerCase()); });
    var currentIcon = document.getElementById('sliderEditIcon').value.trim();
    var grid = document.getElementById('sliderIconsGrid');
    grid.innerHTML = filtered.map(function(icon) { return '<div class="icon-option ' + (icon === currentIcon ?
            'selected' : '') + '" data-icon="' + icon + '"><i class="' + icon + '"></i></div>'; }).join('');
    document.querySelectorAll('#sliderIconsGrid .icon-option').forEach(function(opt) {
        opt.addEventListener('click', function() {
            var si = opt.dataset.icon;
            document.getElementById('sliderEditIcon').value = si;
            document.getElementById('sliderIconPreview').innerHTML = '<i class="' + si + '"></i>';
            document.getElementById('sliderIconPickerModal').classList.remove('active');
            updateSliderLivePreview();
        });
    });
}

function applySalesFiltersClient() {
    var filtered = [...allSales];
    var sp = salesFilterParams;
    var now = Date.now();
    if (sp.period === 'today') { var ds = getStartOfDay();
        filtered = filtered.filter(function(s) { return s.timestamp >= ds; }); } else if (sp.period === 'week') { var ws =
            getStartOfWeek();
        filtered = filtered.filter(function(s) { return s.timestamp >= ws; }); } else if (sp.period === 'month') { var
            ms = getStartOfMonth();
        filtered = filtered.filter(function(s) { return s.timestamp >= ms; }); } else if (sp.period === 'year') { var ys =
            getStartOfYear();
        filtered = filtered.filter(function(s) { return s.timestamp >= ys; }); } else if (sp.period === '7days') { var
            d7 = now - 7 * 86400000;
        filtered = filtered.filter(function(s) { return s.timestamp >= d7; }); } else if (sp.period === '30days') { var
            d30 = now - 30 * 86400000;
        filtered = filtered.filter(function(s) { return s.timestamp >= d30; }); } else if (sp.period === '90days') { var
            d90 = now - 90 * 86400000;
        filtered = filtered.filter(function(s) { return s.timestamp >= d90; }); } else if (sp.period === 'custom' &&
        sp.customStart) { filtered = filtered.filter(function(s) { return s.timestamp >= sp.customStart; }); if (sp
            .customEnd) filtered = filtered.filter(function(s) { return s.timestamp <= sp.customEnd; }); }
    if (sp.searchTerm) { var t = sp.searchTerm.toLowerCase();
        filtered = filtered.filter(function(s) { return (s.itemName || '').toLowerCase().includes(t); }); }
    if (sp.productId) filtered = filtered.filter(function(s) { return s.itemId === sp.productId; });
    if (sp.categoryId) { var catItems = allItems.filter(function(i) { return i.categoryId === sp.categoryId; }).map(
            function(i) { return i.id; });
        filtered = filtered.filter(function(s) { return catItems.includes(s.itemId); }); }
    if (sp.minProfit !== '') filtered = filtered.filter(function(s) { return (s.profit || 0) >= parseFloat(sp
            .minProfit); });
    if (sp.maxProfit !== '') filtered = filtered.filter(function(s) { return (s.profit || 0) <= parseFloat(sp
            .maxProfit); });
    if (sp.minQty !== '') filtered = filtered.filter(function(s) { return (s.quantity || 0) >= parseInt(sp.minQty); });
    if (sp.maxQty !== '') filtered = filtered.filter(function(s) { return (s.quantity || 0) <= parseInt(sp.maxQty); });
    if (sp.minProfitPct !== '' || sp.maxProfitPct !== '') {
        filtered = filtered.filter(function(s) { var pct = s.totalAmount > 0 ? ((s.profit || 0) / s.totalAmount *
                100) : 0; if (sp.minProfitPct !== '' && pct < parseFloat(sp.minProfitPct)) return false; if (sp
                .maxProfitPct !== '' && pct > parseFloat(sp.maxProfitPct)) return false; return true; });
    }
    return filtered;
}

function exportToCSV() {
    var filtered = applySalesFiltersClient();
    var rows = [
        ['#', 'التاريخ', 'المنتج', 'الكمية', 'سعر الوحدة', 'الإجمالي', 'التكلفة', 'الربح', 'نسبة الربح']
    ];
    filtered.forEach(function(s, i) {
        var cost = (s.purchasePriceAtTime || 0) * (s.quantity || 0);
        var profitPct = s.totalAmount > 0 ? ((s.profit || 0) / s.totalAmount * 100) : 0;
        rows.push([i + 1, fmtDateTime(s.timestamp), s.itemName || '', s.quantity || 0, formatMoneyPlain(s
            .unitPrice || 0), formatMoneyPlain(s.totalAmount || 0), formatMoneyPlain(cost),
            formatMoneyPlain(s.profit || 0), fmt(profitPct) + '%'
        ]);
    });
    var csv = rows.map(function(r) { return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') +
            '"'; }).join(','); }).join('\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'xmetal_report_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('✅ تم تصدير CSV');
}

function exportToPDF() {
    var filtered = applySalesFiltersClient();
    var doc = new jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFont('Cairo');
    doc.setFontSize(18);
    doc.text('تقرير مبيعات X METAL', 140, 15, { align: 'center' });
    doc.setFontSize(11);
    doc.text('تاريخ التصدير: ' + fmtDateTime(Date.now()) + ' | عدد العمليات: ' + filtered.length, 14, 22);
    var rows = filtered.map(function(s, i) { return [i + 1, fmtDateTime(s.timestamp), s.itemName || '', s
            .quantity || 0, formatMoneyPlain(s.unitPrice || 0), formatMoneyPlain(s.totalAmount || 0),
            formatMoneyPlain(s.profit || 0)
        ]; });
    doc.autoTable({
        head: [
            ['#', 'التاريخ', 'المنتج', 'الكمية', 'سعر الوحدة', 'الإجمالي', 'الربح']
        ],
        body: rows,
        startY: 28,
        styles: { font: 'Cairo', halign: 'center', fontSize: 10 },
        headStyles: { fillColor: [43, 108, 176] }
    });
    doc.save('xmetal_report_' + new Date().toISOString().split('T')[0] + '.pdf');
    showToast('✅ تم تنزيل PDF');
}

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeMobileSidebar();
        document.querySelectorAll('.modal-overlay.show').forEach(function(m) { m.classList.remove(
            'show'); });
        var iconModal = document.getElementById('sliderIconPickerModal');
        if (iconModal) iconModal.classList.remove('active');
    }
    if (e.ctrlKey && e.key === 's' && document.getElementById('sliderEditModal').classList.contains('show')) {
        e.preventDefault();
        document.getElementById('saveSliderItemBtn').click();
    }
});
window.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('show')) e.target
        .classList.remove('show');
    if (e.target.id === 'sliderIconPickerModal' && e.target.classList.contains('active')) e.target.classList
        .remove('active');
});

applyDarkMode();
console.log('🚀 X METAL Unified Dashboard Ready');
