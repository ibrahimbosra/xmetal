// Initialize Firebase (using firebase-config.js)
const auth = window.firebaseAuth;
const db = window.firebaseDb;

if (!auth) {
    console.error('Firebase auth is not initialized. Check js/firebase-config.js for a valid configuration.');
}

// Use unified appState instead of global variables
// All state is now in: window.appState (defined in appState.js)

// Legacy variable shims for backward compatibility
// These will be removed in future refactoring
let allSales = [];
let allItems = [];
let allCategories = [];
let allExpenses = [];
let allSliderItems = [];
let allActivity = [];
let allActivityFullLoaded = false;

// Sync functions to keep legacy code working
function syncStateToLegacy() {
    allSales = appState.data.sales;
    allItems = appState.data.items;
    allCategories = appState.data.categories;
    allExpenses = appState.data.expenses;
    allSliderItems = appState.data.sliderItems;
}

function syncLegacyToState() {
    appState.data.sales = allSales;
    appState.data.items = allItems;
    appState.data.categories = allCategories;
    appState.data.expenses = allExpenses;
    appState.data.sliderItems = allSliderItems;
}

// Helpers to update legacy lists and reflect into appState + UI
function updateAllItems(items) {
    allItems = items || [];
    try { if (window.appState && appState.setState) appState.setState('data.items', allItems); } catch (e) {}
    try { if (document.getElementById('itemsList')) renderInventory(); } catch (e) {}
}

function updateAllSales(sales) {
    allSales = sales || [];
    try { if (window.appState && appState.setState) appState.setState('data.sales', allSales); } catch (e) {}
    try { renderSalesLog(); } catch (e) {}
}

function updateAllCategories(categories) {
    allCategories = categories || [];
    try { if (window.appState && appState.setState) appState.setState('data.categories', allCategories); } catch (e) {}
}

// Compute average unit purchase price for an item (total capital / total qty)
function computeAveragePurchasePrice(item) {
    var totalQty = 0;
    var totalCost = 0;
    if (item.purchaseBatches && Array.isArray(item.purchaseBatches) && item.purchaseBatches.length) {
        item.purchaseBatches.forEach(function(b) {
            var q = Number(b.quantity) || 0;
            var c = Number(b.unitCost) || 0;
            totalQty += q;
            totalCost += q * c;
        });
        return totalQty > 0 ? totalCost / totalQty : (Number(item.purchasePrice) || 0);
    }
    return Number(item.purchasePrice) || 0;
}

function getItemInventoryCapital(item) {
    if (item.purchaseBatches && Array.isArray(item.purchaseBatches) && item.purchaseBatches.length) {
        return item.purchaseBatches.reduce(function(acc, b) {
            return acc + ((Number(b.quantity) || 0) * (Number(b.unitCost) || 0));
        }, 0);
    }
    return (Number(item.purchasePrice) || 0) * (Number(item.quantity) || 0);
}

function commitItemUpdate(item) {
    allItems = allItems.map(function(i) { return i.id === item.id ? item : i; });
    updateAllItems(allItems);
}

function addSaleLocally(sale) {
    allSales = [sale].concat(allSales);
    updateAllSales(allSales);
}

function replaceSaleLocally(saleId, sale) {
    allSales = allSales.map(function(s) { return s.saleId === saleId ? sale : s; });
    updateAllSales(allSales);
}

function removeSaleLocally(saleId) {
    allSales = allSales.filter(function(s) { return s.saleId !== saleId; });
    updateAllSales(allSales);
}

function applyInventoryDelta(item, delta) {
    item.quantity = (Number(item.quantity) || 0) + Number(delta);
    return item;
}

// Basic sale calculators
function calculateSaleTotal(unitPrice, quantity) {
    return Number(unitPrice || 0) * Number(quantity || 0);
}

function calculateSaleProfit(unitPrice, purchasePriceAtTime, quantity) {
    return (Number(unitPrice || 0) - Number(purchasePriceAtTime || 0)) * Number(quantity || 0);
}

// Update item quantity using a Firestore transaction to avoid race conditions
async function updateItemQuantityTransaction(itemId, delta) {
    var ref = db.collection('items').doc(itemId);
    return db.runTransaction(async function(tx) {
        var doc = await tx.get(ref);
        if (!doc.exists) throw new Error('Item not found');
        var current = Number(doc.data().quantity) || 0;
        var newQty = current + Number(delta);
        if (newQty < 0) throw new Error('Insufficient stock');
        tx.update(ref, { quantity: newQty, updatedAt: Date.now() });
        return newQty;
    });
}

// Compute allocations from purchaseBatches (FIFO) without mutating originals
function computeBatchAllocations(item, qtyToConsume) {
    var remaining = Number(qtyToConsume) || 0;
    var allocations = [];
    if (!item.purchaseBatches || !Array.isArray(item.purchaseBatches) || item.purchaseBatches.length === 0) {
        return allocations;
    }
    // sort by timestamp ascending
    var sorted = item.purchaseBatches.slice().sort(function(a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
    for (var i = 0; i < sorted.length && remaining > 0; i++) {
        var b = sorted[i];
        var avail = Number(b.quantity) || 0;
        if (avail <= 0) continue;
        var take = Math.min(avail, remaining);
        allocations.push({ timestamp: b.timestamp || null, unitCost: b.unitCost || 0, quantity: take });
        remaining -= take;
    }
    if (remaining > 0) {
        // not enough in batches, allocations incomplete
        return [];
    }
    return allocations;
}

// Apply allocations (consume) in a transaction: subtract quantities from matching batches and update total quantity
async function applyBatchAllocationsTransaction(itemId, allocations) {
    var ref = db.collection('items').doc(itemId);
    return db.runTransaction(async function(tx) {
        var doc = await tx.get(ref);
        if (!doc.exists) throw new Error('Item not found');
        var data = doc.data();
        var batches = Array.isArray(data.purchaseBatches) ? data.purchaseBatches.slice() : [];
        // create map by timestamp to allow matching
        for (var a = 0; a < allocations.length; a++) {
            var alloc = allocations[a];
            var remaining = Number(alloc.quantity) || 0;
            // try to match by timestamp first
            for (var i = 0; i < batches.length && remaining > 0; i++) {
                if (alloc.timestamp != null && batches[i].timestamp && batches[i].timestamp === alloc.timestamp) {
                    var curr = Number(batches[i].quantity) || 0;
                    if (curr < remaining) throw new Error('Insufficient batch quantity during transaction');
                    batches[i].quantity = curr - remaining;
                    remaining = 0;
                }
            }
            // if still remaining, consume FIFO from any available batches
            for (var j = 0; j < batches.length && remaining > 0; j++) {
                var curr2 = Number(batches[j].quantity) || 0;
                if (curr2 <= 0) continue;
                var take = Math.min(curr2, remaining);
                batches[j].quantity = curr2 - take;
                remaining -= take;
            }
            if (remaining > 0) throw new Error('Insufficient batch quantity during transaction');
        }
        // compute new total quantity
        var totalQty = batches.reduce(function(acc, b) { return acc + (Number(b.quantity) || 0); }, 0);
        tx.update(ref, { purchaseBatches: batches, quantity: totalQty, updatedAt: Date.now() });
        return { purchaseBatches: batches, quantity: totalQty };
    });
}

// Restore allocations (add back quantities) in a transaction
async function restoreBatchAllocationsTransaction(itemId, allocations) {
    var ref = db.collection('items').doc(itemId);
    return db.runTransaction(async function(tx) {
        var doc = await tx.get(ref);
        if (!doc.exists) throw new Error('Item not found');
        var data = doc.data();
        var batches = Array.isArray(data.purchaseBatches) ? data.purchaseBatches.slice() : [];
        for (var a = 0; a < allocations.length; a++) {
            var alloc = allocations[a];
            var remaining = Number(alloc.quantity) || 0;
            // try to match by timestamp to restore to the same batch
            var matched = false;
            for (var i = 0; i < batches.length && remaining > 0; i++) {
                if (alloc.timestamp != null && batches[i].timestamp && batches[i].timestamp === alloc.timestamp) {
                    batches[i].quantity = (Number(batches[i].quantity) || 0) + remaining;
                    remaining = 0; matched = true; break;
                }
            }
            if (!matched) {
                // if no matching batch, append a new batch with allocation details
                batches.push({ quantity: remaining, unitCost: alloc.unitCost || 0, supplier: alloc.supplier || '', note: alloc.note || '', timestamp: alloc.timestamp || Date.now() });
                remaining = 0;
            }
        }
        var totalQty = batches.reduce(function(acc, b) { return acc + (Number(b.quantity) || 0); }, 0);
        tx.update(ref, { purchaseBatches: batches, quantity: totalQty, updatedAt: Date.now() });
        return { purchaseBatches: batches, quantity: totalQty };
    });
}

function buildSaleObject(item, qty, price, currency, purchasePriceAtTime) {
    var costBasis = purchasePriceAtTime != null ? purchasePriceAtTime : item.purchasePrice;
    return {
        itemId: item.id,
        itemName: item.name,
        quantity: qty,
        unitPrice: price,
        totalAmount: calculateSaleTotal(price, qty),
        profit: calculateSaleProfit(price, costBasis, qty),
        purchasePriceAtTime: costBasis,
        timestamp: Date.now(),
        saleCurrency: currency
    };
}

let allSalesFullLoaded = false;
let currencySettings = { secondaryCurrencyName: 'ريال سعودي', secondaryCurrencySymbol: '﷼', exchangeRate: 3.75,
    defaultInputCurrency: 'primary', defaultSellCurrency: 'primary', enablePurchaseBatches: false };
let storeInfoData = {};
let currentSection = 'dashboard';
let salesPage = 0,
    salesQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
let salesPageSize = 25;
let salesPageCursors = [null];
let salesPageItemsCache = {};
let salesFilterParams = { period: 'all', searchTerm: '', categoryId: '', productId: '', minQty: '', maxQty: '',
    minProfit: '', maxProfit: '', minProfitPct: '', maxProfitPct: '' };
let activityPage = 0,
    activityPageSize = 25,
    activityQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
let activityPageCursors = [null];
let activityPageItemsCache = {};
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
// Advanced fields lazy-load state
window.advancedFieldsLoaded = false;
window.pendingEditItem = null;
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
function fmtMoney(n) {
    var num = Number(n || 0);
    if (isNaN(num)) return '0';
    if (Number.isInteger(num)) return String(num);
    var formatted = Number(num.toFixed(2));
    return String(formatted).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
}
function fmtQty(n) {
    var num = Number(n || 0);
    if (isNaN(num)) return '0';
    if (Number.isInteger(num)) return String(num);
    return String(Number(num.toFixed(2))).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
}
function fmtInt(n) { return parseInt(n || 0, 10); }
// Robust numeric parser for user input. Returns null for empty/invalid input.
function parseInputNumber(value) {
    if (value === null || value === undefined) return null;
    var s = String(value).trim();
    if (s === '') return null;
    // Accept both comma and dot decimals, strip currency symbols/spaces
    s = s.replace(/,/g, '.');
    s = s.replace(/[^0-9.\-]/g, '');
    if (s === '' || s === '.' || s === '-' ) return null;
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
}
function formatDateString(ts, includeTime) {
    var d = new Date(ts);
    if (!ts || isNaN(d.getTime())) return '';
    var year = d.getFullYear();
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var datePart = day + '/' + month + '/' + year;
    if (includeTime) {
        var hours = String(d.getHours()).padStart(2, '0');
        var minutes = String(d.getMinutes()).padStart(2, '0');
        return datePart + ' ' + hours + ':' + minutes;
    }
    return datePart;
}
function fmtDate(ts) { return formatDateString(ts, false); }
function fmtDateTime(ts) { return formatDateString(ts, true); }
function formatDateSeparatorLabel(ts) {
    var d = new Date(ts);
    if (!ts || isNaN(d.getTime())) return '';
    var weekday = d.toLocaleDateString('ar-EG', { weekday: 'long' });
    return weekday + ' ' + formatDateString(ts, false);
}
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
    // Use unified error handler
    const error = errorHandler.handleFirebaseError(e, context);
    showErrorToast(error.message);
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
    if (displaySecondaryCurrency) { return currencySettings.secondaryCurrencySymbol + ' ' + fmtMoney(num * currencySettings
            .exchangeRate); }
    return '$' + fmtMoney(num);
}
function formatMoneyPlain(amount) {
    var num = Number(amount || 0);
    if (displaySecondaryCurrency) return fmtMoney(num * currencySettings.exchangeRate);
    return fmtMoney(num);
}

var cairoCairoRegularWoff2Base64 = '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';

function registerCairoPdfFont(doc) {
    if (!doc || typeof doc.addFileToVFS !== 'function' || typeof doc.addFont !== 'function') return;
    if (doc.internal && doc.internal.events && doc.internal.events['getFontList'] && doc.getFontList && doc.getFontList().Cairo) return;
    try {
        doc.addFileToVFS('Cairo-Regular.woff2', cairoCairoRegularWoff2Base64);
        doc.addFont('Cairo-Regular.woff2', 'Cairo', 'normal');
    } catch (e) {
        console.warn('Failed to register Cairo font for PDF export:', e);
    }
}

async function logActivity(actionType, entity, entityId, details, metadata) {
    try {
        var docRef = await db.collection('activityLog').add({
            timestamp: Date.now(),
            actionType: actionType || '',
            entity: entity || '',
            entityId: entityId || null,
            details: details || '',
            user: (auth.currentUser && auth.currentUser.email) ? auth.currentUser.email : 'unknown',
            metadata: metadata || {}
        });
        if (allActivityFullLoaded) {
            allActivity.unshift({
                id: docRef.id,
                timestamp: Date.now(),
                actionType: actionType || '',
                entity: entity || '',
                entityId: entityId || null,
                details: details || '',
                user: (auth.currentUser && auth.currentUser.email) ? auth.currentUser.email : 'unknown',
                metadata: metadata || {}
            });
        }
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
    return 'سعر الشراء: ' + fmtMoney(item.purchasePrice) + '، سعر البيع: ' + fmtMoney(item.salePrice) + '، الكمية: ' + (item.quantity || 0) + '، الفئة: ' + (item.categoryName || 'بدون فئة') + '، إخفاء المنتج: ' + (item.hidden ? 'نعم' : 'لا') + '، عرض السعر: ' + (item.showPrice ? 'نعم' : 'لا') + (item.discountEnabled ? '، الخصم: ' + fmtMoney(item.discountValue) : '');
}

function buildCurrencyChangeDetails(oldSettings, newSettings) {
    var fields = [
        { key: 'secondaryCurrencyName', label: 'اسم العملة' },
        { key: 'secondaryCurrencySymbol', label: 'رمز العملة' },
        { key: 'exchangeRate', label: 'سعر الصرف', formatter: function(v) { return v === null || v === undefined ? '--' : fmt(v); } },
        { key: 'enablePurchaseBatches', label: 'تفعيل دفعات الشراء', formatter: function(v) { return v ? 'مفعل' : 'معطل'; } },
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
                    '<button onclick="editActivityLogDetail(\'' + escJsString(item.id) + '\')" style="background:var(--accent-light);color:var(--accent);border:none;border-radius:20px;padding:5px 12px;cursor:pointer;font-size:0.72rem;font-weight:600;margin-left:6px;">تعديل</button>' +
                    '</td></tr>';
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
    return fmtDate(ts);
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
    activityPageCursors = [null];
    activityPageItemsCache = {};
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
    if (!activityQueryCache.currentPageItems.length && !activityQueryCache.hasMore) {
        return '';
    }
    var html = '';
    html += '<button ' + (activityPage === 0 ? 'disabled' : '') + ' onclick="goToActivityPage(' + (activityPage - 1) + ')">السابق</button>';
    html += '<button class="active">صفحة ' + (activityPage + 1) + '</button>';
    html += '<button ' + (!activityQueryCache.hasMore ? 'disabled' : '') + ' onclick="goToActivityPage(' + (activityPage + 1) + ')">التالي</button>';
    return html;
}

function getActivityRowsHtml(items) {
    if (!items.length) return '<tr><td colspan="7" style="padding:30px;color:var(--text3);">لا توجد سجلات</td></tr>';
    var html = '';
    var lastDayKey = null;
    items.forEach(function(item, i) {
        var dayKey = getDayKey(item.timestamp);
        if (dayKey !== lastDayKey) {
            html += getDateSeparatorRowHtml(item.timestamp, 7);
            lastDayKey = dayKey;
        }
        html += getActivityTableRow(item, i);
    });
    return html;
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
    if (!els.body) return;
    if (els.summary) els.summary.innerHTML = getActivitySummaryHtml(items);
    els.body.innerHTML = getActivityRowsHtml(items);
    if (document.getElementById('activityLoadMoreRow')) renderActivityLoadMore();
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
    if (activityQueryCache.loading || !activityQueryCache.hasMore) return;
    activityQueryCache.loading = true;
    updateActivityLoadMoreButton();

    var query = db.collection('activityLog').orderBy('timestamp', 'desc').limit(activityPageSize + 1);
    if (activityQueryCache.lastDoc) query = query.startAfter(activityQueryCache.lastDoc);
    try {
        var snap = await query.get();
        var rawItems = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
        var nextCursor = null;
        if (rawItems.length > activityPageSize) {
            nextCursor = snap.docs[activityPageSize - 1];
            rawItems = rawItems.slice(0, activityPageSize);
        }
        activityQueryCache.currentPageItems = (activityQueryCache.currentPageItems || []).concat(rawItems);
        activityQueryCache.lastDoc = nextCursor;
        activityQueryCache.hasMore = !!nextCursor;
    } catch (e) {
        activityQueryCache.hasMore = false;
        showFirestoreError(e, 'تعذّر تحميل سجل العمليات');
    } finally {
        activityQueryCache.loading = false;
        updateActivityLoadMoreButton();
    }
}

function renderActivityLog() {
    if (!activityQueryCache.currentPageItems.length) {
        renderActivityTable();
        fetchActivityPage().then(renderActivityTable);
    } else {
        renderActivityTable();
    }
}

function renderActivityTable() {
    var currentCount = (activityQueryCache.currentPageItems || []).length;
    var activityLabel = document.getElementById('activityCountLabel');
    if (activityLabel) {
        activityLabel.textContent = currentCount > 0 ? 'عرض ' + currentCount + ' من السجلات' : (activityQueryCache.loading ? 'جاري تحميل السجلات...' : 'لا توجد سجلات');
    }
    var body = document.getElementById('activityLogBody');
    if (body) body.innerHTML = getActivityRowsHtml(activityQueryCache.currentPageItems || []);
    renderActivityLoadMore();
}

function renderActivityLoadMore() {
    var row = document.getElementById('activityLoadMoreRow');
    if (!row) return;
    if (!activityQueryCache.hasMore && (activityQueryCache.currentPageItems || []).length > 0) {
        row.style.display = 'none';
        return;
    }
    row.style.display = 'flex';
    updateActivityLoadMoreButton();
}

function updateActivityLoadMoreButton() {
    var btn = document.getElementById('activityLoadMoreBtn');
    var info = document.getElementById('activityLoadMoreInfo');
    if (!btn || !info) return;
    btn.disabled = !!activityQueryCache.loading || !activityQueryCache.hasMore;
    btn.textContent = activityQueryCache.loading ? 'جاري التحميل...' : 'تحميل المزيد';
    info.textContent = activityQueryCache.hasMore ? '' : ((activityQueryCache.currentPageItems || []).length ? 'تم تحميل جميع السجلات.' : 'لا توجد سجلات إضافية.');
}

function loadMoreActivity() {
    if (activityQueryCache.loading || !activityQueryCache.hasMore) return;
    fetchActivityPage().then(renderActivityTable);
}

function renderActivityPagination() {
    if (!document.getElementById('activityPagination')) return;
    document.getElementById('activityPagination').innerHTML = getActivityPaginationButtons();
}

function goToActivityPage(p) {
    activityPage = Math.max(0, p);
    renderActivityLog();
}

function debouncedActivitySearchUpdate(value) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(function() { updateActivityFilter('searchTerm', value); }, 400);
}

function updateActivityFilter(key, value) {
    activityFilterParams[key] = value;
    activityPage = 0;
    activityPageCursors = [null];
    activityPageItemsCache = {};
    activityQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
    renderActivityLog();
}

function resetActivityFilters() {
    activityFilterParams = { period: 'all', searchTerm: '', actionType: '', entity: '', user: '', customStart: null, customEnd: null };
    activityPage = 0;
    activityPageCursors = [null];
    activityPageItemsCache = {};
    activityQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
    renderActivityLog();
}

function viewActivityLogDetail(recordId) {
    var item = (activityQueryCache.currentPageItems || []).find(function(it) { return it.id === recordId; });
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
    if (!window.html2pdf) {
        showToast('❌ مكتبة html2pdf غير متاحة');
        return;
    }
    var items = getCurrentActivityPageItems();
    var headers = getActivityTableHeaders();
    var rows = getActivityPdfBody(items);
    var container = buildPdfExportContainer(
        formatActivityPdfTitle(),
        'تاريخ التصدير: ' + fmtDateTime(Date.now()) + ' | عدد السجلات: ' + items.length,
        headers,
        rows
    );
    var filename = getActivityPdfFileName(getActivityExportFilenameWithDate());
    var exportOptions = {
        filename: filename,
        html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['css', 'legacy'] }
    };
    function runExport() {
        html2pdf().from(container).set(exportOptions).save().then(function() {
            showToast('✅ تم تنزيل PDF لسجل العمليات');
            container.remove();
        }).catch(function(err) {
            console.error(err);
            showToast('❌ حدث خطأ أثناء إنشاء PDF لسجل العمليات');
            container.remove();
        });
    }
    if (document.fonts && typeof document.fonts.ready !== 'undefined') {
        document.fonts.ready.then(function() {
            setTimeout(runExport, 250);
        }).catch(function() {
            setTimeout(runExport, 250);
        });
    } else {
        setTimeout(runExport, 250);
    }
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
    if (isInputSecondary) { return fmtMoney(value) + ' ' + symbol + ' (≈ $' + fmtMoney(convertToPrimary(value)) + ')'; }
    return fmtMoney(convertToSecondary(value)) + ' ' + symbol;
}
function updateProductPriceDisplay() {
    var p = parseInputNumber(document.getElementById('purchasePrice') ? document.getElementById('purchasePrice').value : null);
    var s = parseInputNumber(document.getElementById('salePrice') ? document.getElementById('salePrice').value : null);
    p = p === null ? 0 : p;
    s = s === null ? 0 : s;
    var sym = currencySettings.secondaryCurrencySymbol;
    var pEl = document.getElementById('purchasePriceSecondary');
    var sEl = document.getElementById('salePriceSecondary');
    if (pEl) pEl.innerText = getConversionDisplay(p, tempPurchaseCurrency, sym);
    if (sEl) sEl.innerText = getConversionDisplay(s, tempSaleCurrency, sym);
}
function updateSellPriceDisplay() {
    var v = parseFloat(document.getElementById('sellPrice') ? document.getElementById('sellPrice').value : 0) || 0;
    var qty = parseFloat(document.getElementById('sellQuantity') ? document.getElementById('sellQuantity').value : 0) || 0;
    var total = Number(v) * Number(qty);
    var mainSymbol = tempSellCurrency ? currencySettings.secondaryCurrencySymbol : '$';
    var otherSymbol = tempSellCurrency ? '$' : currencySettings.secondaryCurrencySymbol;
    var converted = tempSellCurrency ? convertToPrimary(v) : convertToSecondary(v);
    var secondaryInput = document.getElementById('sellPriceSecondary');
    if (secondaryInput) secondaryInput.value = fmtMoney(converted) + ' ' + otherSymbol;
    var el = document.getElementById('sellPriceSecondaryInfo');
    if (el) el.innerText = 'إجمالي البيع: ' + fmtMoney(total) + ' ' + mainSymbol;
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
    if (spl) spl.innerHTML = 'السعر للقطعة (' + (tempSellCurrency ? currencySettings.secondaryCurrencySymbol : '$') + ')';
    if (epl) epl.innerHTML = 'السعر (' + (tempEditCurrency ? currencySettings.secondaryCurrencySymbol : '$') + ')';
}
function closeMobileSidebar() {
    var sidebar = document.getElementById('sidebar');
    var backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('show');
    document.body.style.overflow = 'auto';
}

var mobileMenuBtn = document.getElementById('mobileMenuBtn');
var sidebar = document.getElementById('sidebar');
var sidebarBackdrop = document.getElementById('sidebarBackdrop');

if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', function(event) {
        event.stopPropagation();
        sidebar.classList.toggle('open');
        sidebarBackdrop.classList.toggle('show');
        document.body.style.overflow = sidebar.classList.contains('open') ? 'hidden' : 'auto';
    });
}

if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', closeMobileSidebar);
}

document.querySelectorAll('#sidebarNav button').forEach(function(btn) {
    btn.addEventListener('click', function(event) {
        event.stopPropagation();
        document.querySelectorAll('#sidebarNav button').forEach(function(b) {
            b.classList.remove('active');
        });
        btn.classList.add('active');
        currentSection = btn.dataset.section;
        salesPage = 0;
        salesQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
        destroyAllCharts();
        renderCurrentSection();
        var pageTitle = document.getElementById('pageTitle');
        if (pageTitle) pageTitle.textContent = btn.textContent.trim();
        closeMobileSidebar();
    });
});

document.addEventListener('click', function(event) {
    if (!sidebar.classList.contains('open')) return;
    if (event.target === mobileMenuBtn || mobileMenuBtn.contains(event.target)) return;
    if (sidebar.contains(event.target) || sidebarBackdrop.contains(event.target)) return;
    closeMobileSidebar();
});

var _sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn'); if (_sidebarLogoutBtn) _sidebarLogoutBtn.addEventListener('click', function() { closeMobileSidebar(); auth.signOut(); });
var _exportPdfBtn = document.getElementById('exportPdfBtn'); if (_exportPdfBtn) _exportPdfBtn.addEventListener('click', function() { closeMobileSidebar(); showPdfExportModal(); });
var _exportExcelBtn = document.getElementById('exportExcelBtn'); if (_exportExcelBtn) _exportExcelBtn.addEventListener('click', function() { closeMobileSidebar(); showCsvExportModal(); });
var _printReportBtn = document.getElementById('printReportBtn'); if (_printReportBtn) _printReportBtn.addEventListener('click', function() { closeMobileSidebar(); window.print(); });

var _closePdfExportModal = document.getElementById('closePdfExportModal'); if (_closePdfExportModal) _closePdfExportModal.addEventListener('click', closePdfExportModal);
var _cancelPdfExportBtn = document.getElementById('cancelPdfExportBtn'); if (_cancelPdfExportBtn) _cancelPdfExportBtn.addEventListener('click', closePdfExportModal);
var _confirmPdfExportBtn = document.getElementById('confirmPdfExportBtn'); if (_confirmPdfExportBtn) _confirmPdfExportBtn.addEventListener('click', function() {
    var radio = document.querySelector('input[name="pdfExportType"]:checked');
    var selectedMode = radio ? radio.value : 'sales';
    if (selectedMode === 'products') exportProductsPDF(); else exportSalesReportPDF();
});
var _pdfExportRadios = document.querySelectorAll('input[name="pdfExportType"]'); if (_pdfExportRadios && _pdfExportRadios.length) {
    _pdfExportRadios.forEach(function(radio) {
        radio.addEventListener('change', function() {
            var pe = document.getElementById('productExportOptions'); if (pe) pe.style.display = this.value === 'products' ? 'block' : 'none';
        });
    });
}
var _closeCsvExportModal = document.getElementById('closeCsvExportModal'); if (_closeCsvExportModal) _closeCsvExportModal.addEventListener('click', closeCsvExportModal);
var _cancelCsvExportBtn = document.getElementById('cancelCsvExportBtn'); if (_cancelCsvExportBtn) _cancelCsvExportBtn.addEventListener('click', closeCsvExportModal);
var _confirmCsvExportBtn = document.getElementById('confirmCsvExportBtn'); if (_confirmCsvExportBtn) _confirmCsvExportBtn.addEventListener('click', function() {
    var selectedCols = Array.from(document.querySelectorAll('#csvExportModal input[data-export-col]:checked')).map(function(input) {
        return input.dataset.exportCol;
    });
    if (!selectedCols.length) {
        showToast('❌ الرجاء اختيار عمود واحد على الأقل', 'error');
        return;
    }
    closeCsvExportModal();
    exportToXLSX(selectedCols);
});

var _csvExportCheckboxes = document.querySelectorAll('#csvExportModal input[data-export-col]');
if (_csvExportCheckboxes && _csvExportCheckboxes.length) {
    _csvExportCheckboxes.forEach(function(chk) {
        chk.addEventListener('change', renderCsvPreview);
    });
}

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
    if (!auth) {
        document.getElementById('loginErrorMsg').style.display = 'block';
        document.getElementById('loginErrorMsg').textContent = 'خطأ في تهيئة المصادقة؛ تأكد من إعدادات Firebase.';
        return;
    }
    var em = document.getElementById('loginEmail').value.trim();
    var pw = document.getElementById('loginPassword').value.trim();
    if (!em || !pw) {
        document.getElementById('loginErrorMsg').style.display = 'block';
        document.getElementById('loginErrorMsg').textContent = 'يرجى إدخال البيانات';
        return;
    }
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

    // items realtime listener: keep local items in sync and update UI immediately
    try {
        var unsubItems = db.collection('items').onSnapshot(function(snap) {
            try {
                var items = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
                allItems = items;
                setCachedData('items', allItems);
                // refresh UI sections that depend on items
                if (document.getElementById('itemsList')) renderInventory();
                if (currentSection === 'dashboard' || currentSection === 'profitAnalysis' || currentSection === 'insights') renderCurrentSection();
                // update any open modals that reference item quantities
                refreshOpenModals();
                document.getElementById('lastUpdatedLabel').textContent = 'آخر تحديث: ' + fmtDateTime(Date.now());
            } catch (e) { console.warn('items onSnapshot handler error', e); }
        });
        realtimeListeners.push(unsubItems);
    } catch (e) { console.warn('failed to attach items listener', e); }

    // currency settings realtime listener
    try {
        var unsubCurrency = db.collection('currencySettings').doc('settings').onSnapshot(function(doc) {
            try {
                if (doc.exists) {
                    currencySettings = { ...currencySettings, ...doc.data() };
                    setCachedData('currencySettings', currencySettings);
                    tempPurchaseCurrency = (currencySettings.defaultInputCurrency === 'secondary');
                    tempSaleCurrency = (currencySettings.defaultInputCurrency === 'secondary');
                    tempSellCurrency = (currencySettings.defaultSellCurrency === 'secondary');
                    updatePriceLabels();
                    updateProductPriceDisplay();
                    updateSellPriceDisplay();
                    updateEditSalePriceDisplay();
                    if (currentSection === 'inventory' || currentSection === 'dashboard') renderCurrentSection();
                }
            } catch (e) { console.warn('currency onSnapshot handler error', e); }
        });
        realtimeListeners.push(unsubCurrency);
    } catch (e) { console.warn('failed to attach currency listener', e); }

    // stats totals realtime listener
    try {
        var unsubStats = db.collection('stats').doc('totals').onSnapshot(function(doc) {
            try {
                if (doc.exists) {
                    window._cachedStats.allTimeProfit = doc.data().allTimeProfit || 0;
                    if (currentSection === 'dashboard' || currentSection === 'profitAnalysis') renderCurrentSection();
                }
            } catch (e) { console.warn('stats onSnapshot handler error', e); }
        });
        realtimeListeners.push(unsubStats);
    } catch (e) { console.warn('failed to attach stats listener', e); }
}

// Update open modals (sell/edit) so their max values reflect authoritative quantities
function refreshOpenModals() {
    try {
        // sell modal
        var sellForm = document.getElementById('sellForm');
        if (sellForm && sellForm.dataset && sellForm.dataset.itemId) {
            var sid = sellForm.dataset.itemId;
            var sItem = allItems.find(function(i) { return i.id === sid; });
            if (sItem) {
                var el = document.getElementById('sellQuantity');
                if (el) el.max = sItem.quantity;
                var priceEl = document.getElementById('sellPrice');
                if (priceEl && sItem.salePrice != null) {
                    priceEl.value = tempSellCurrency ? fmtMoney(convertToSecondary(sItem.salePrice)) : fmtMoney(sItem.salePrice);
                    updateSellPriceDisplay();
                }
            }
        }
        // edit sale modal
        var editModal = document.getElementById('editSaleModal');
        if (editModal && editModal.classList.contains('show')) {
            var saleId = document.getElementById('editSaleId').value;
            var sale = allSales.find(function(s) { return s.saleId === saleId; });
            if (sale) {
                var prod = allItems.find(function(i) { return i.id === sale.itemId; });
                if (prod) {
                    var eq = document.getElementById('editQuantity');
                    if (eq) eq.max = (Number(prod.quantity) || 0) + (Number(sale.quantity) || 0);
                    var priceEl2 = document.getElementById('editPrice');
                    if (priceEl2 && sale.unitPrice != null) {
                        priceEl2.value = tempEditCurrency ? fmtMoney(convertToSecondary(sale.unitPrice)) : fmtMoney(sale.unitPrice);
                        updateEditSalePriceDisplay();
                    }
                }
            }
        }
    } catch (e) { console.warn('refreshOpenModals error', e); }
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

function getPageRangeLabel(page, pageSize, currentCount, labelSuffix) {
    if (!currentCount) return 'لا توجد سجلات';
    var start = page * pageSize + 1;
    var end = start + currentCount - 1;
    return 'عرض ' + start + ' - ' + end + ' ' + labelSuffix;
}

function filterSalesItems(items) {
    var sp = salesFilterParams;
    var now = Date.now();
    return items.filter(function(s) {
        if (!s) return false;
        if (sp.period === 'today' && s.timestamp < getStartOfDay()) return false;
        if (sp.period === 'week' && s.timestamp < getStartOfWeek()) return false;
        if (sp.period === 'month' && s.timestamp < getStartOfMonth()) return false;
        if (sp.period === 'year' && s.timestamp < getStartOfYear()) return false;
        if (sp.period === '7days' && s.timestamp < now - 7 * 86400000) return false;
        if (sp.period === '30days' && s.timestamp < now - 30 * 86400000) return false;
        if (sp.period === '90days' && s.timestamp < now - 90 * 86400000) return false;
        if (sp.period === 'custom') {
            if (sp.customStart && s.timestamp < sp.customStart) return false;
            if (sp.customEnd && s.timestamp > sp.customEnd) return false;
        }
        if (sp.productId && s.itemId !== sp.productId) return false;
        if (sp.minProfit !== '' && (Number(s.profit) || 0) < parseFloat(sp.minProfit)) return false;
        if (sp.maxProfit !== '' && (Number(s.profit) || 0) > parseFloat(sp.maxProfit)) return false;
        if (sp.minQty !== '' && (Number(s.quantity) || 0) < parseFloat(sp.minQty)) return false;
        if (sp.maxQty !== '' && (Number(s.quantity) || 0) > parseFloat(sp.maxQty)) return false;
        if (sp.searchTerm) {
            var term = sp.searchTerm.toLowerCase();
            if (!((s.itemName || '').toLowerCase().includes(term))) return false;
        }
        if (sp.categoryId) {
            var catItems = allItems.filter(function(i) { return i.categoryId === sp.categoryId; }).map(function(i) { return i.id; });
            if (!catItems.includes(s.itemId)) return false;
        }
        if (sp.minProfitPct !== '' || sp.maxProfitPct !== '') {
            var cost = (Number(s.purchasePriceAtTime) || 0) * (Number(s.quantity) || 0);
            var pct = cost > 0 ? ((Number(s.profit) || 0) / cost * 100) : 0;
            if (sp.minProfitPct !== '' && pct < parseFloat(sp.minProfitPct)) return false;
            if (sp.maxProfitPct !== '' && pct > parseFloat(sp.maxProfitPct)) return false;
        }
        return true;
    });
}

function filterActivityItems(items) {
    var sp = activityFilterParams;
    return items.filter(function(item) {
        if (!item) return false;
        if (sp.period === 'today' && item.timestamp < getStartOfDay()) return false;
        if (sp.period === 'week' && item.timestamp < getStartOfWeek()) return false;
        if (sp.period === 'month' && item.timestamp < getStartOfMonth()) return false;
        if (sp.period === 'year' && item.timestamp < getStartOfYear()) return false;
        if (sp.period === 'custom') {
            if (sp.customStart && item.timestamp < sp.customStart) return false;
            if (sp.customEnd && item.timestamp > sp.customEnd) return false;
        }
        if (sp.actionType && item.actionType !== sp.actionType) return false;
        if (sp.entity && item.entity !== sp.entity) return false;
        if (sp.user && item.user !== sp.user) return false;
        if (sp.searchTerm && !activityMatchesSearch(item, sp.searchTerm.toLowerCase())) return false;
        return true;
    });
}

async function ensureFullActivityData() {
    if (allActivityFullLoaded) return;
    toggleLoading(true);
    try {
        var snap = await db.collection('activityLog').orderBy('timestamp', 'desc').get();
        allActivity = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
        allActivityFullLoaded = true;
    } catch (e) {
        allActivity = [];
    }
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
    var enableBatches = document.getElementById('enablePurchaseBatches');
    if (enableBatches) enableBatches.checked = !!currencySettings.enablePurchaseBatches;
    tempPurchaseCurrency = (currencySettings.defaultInputCurrency === 'secondary');
    tempSaleCurrency = (currencySettings.defaultInputCurrency === 'secondary');
    tempSellCurrency = (currencySettings.defaultSellCurrency === 'secondary');
    tempEditCurrency = false;
    updatePriceLabels();
    updateProductPriceDisplay();
    updateSellPriceDisplay();
    updateEditSalePriceDisplay();
    updatePurchaseBatchesVisibility();
}

async function fetchStoreInfo() {
    try {
        var d = await db.collection('storeInfo').doc('info').get();
        if (d.exists) storeInfoData = d.data();
    } catch (e) {}
}

function isPurchaseBatchesEnabled() {
    return !!currencySettings.enablePurchaseBatches;
}

function updatePurchaseBatchesVisibility() {
    var container = document.getElementById('purchaseBatchesContainer');
    if (container) container.style.display = isPurchaseBatchesEnabled() ? 'block' : 'none';
}

function renderCurrencySettingsForm() {
    document.getElementById('secondaryCurrencyName').value = currencySettings.secondaryCurrencyName;
    document.getElementById('secondaryCurrencySymbol').value = currencySettings.secondaryCurrencySymbol;
    document.getElementById('exchangeRate').value = currencySettings.exchangeRate;
    var diRadios = document.querySelectorAll('input[name="defaultInputCurrency"]');
    diRadios.forEach(function(r) { r.checked = (r.value === currencySettings.defaultInputCurrency); });
    var dsRadios = document.querySelectorAll('input[name="defaultSellCurrency"]');
    dsRadios.forEach(function(r) { r.checked = (r.value === currencySettings.defaultSellCurrency); });
    var enableBatches = document.getElementById('enablePurchaseBatches');
    if (enableBatches) enableBatches.checked = !!currencySettings.enablePurchaseBatches;
    updatePurchaseBatchesVisibility();
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
            case 'settings':
                renderStoreInfo();
                renderCurrencySettingsForm();
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
        labels.push(formatDateString(ds, false));
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

function getItemAddedBaseQuantity(item) {
    if (item.purchaseBatches && Array.isArray(item.purchaseBatches) && item.purchaseBatches.length) {
        return item.purchaseBatches.reduce(function(acc, b) { return acc + (Number(b.quantity) || 0); }, 0);
    }
    return Number(item.quantity) || 0;
}

function getItemAddedPurchaseCost(item) {
    if (item.purchaseBatches && Array.isArray(item.purchaseBatches) && item.purchaseBatches.length) {
        return item.purchaseBatches.reduce(function(acc, b) {
            return acc + ((Number(b.quantity) || 0) * (Number(b.unitCost) || 0));
        }, 0);
    }
    return (Number(item.purchasePrice) || 0) * getItemAddedBaseQuantity(item);
}

function getItemAddedSaleValue(item) {
    return (Number(item.salePrice) || 0) * getItemAddedBaseQuantity(item);
}

function formatMonthKeyLabel(monthKey) {
    var parts = String(monthKey).split('-');
    if (parts.length !== 2) return monthKey;
    var year = parts[0];
    var month = parseInt(parts[1], 10);
    var months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    return (months[month - 1] || month) + ' ' + year;
}

function getMonthlyItemsAddedSummary() {
    var map = {};
    allItems.forEach(function(item) {
        var ts = item.createdAt || item.updatedAt;
        if (ts && typeof ts.toMillis === 'function') ts = ts.toMillis();
        if (!ts) return;
        var mk = getMonthKey(ts);
        if (!map[mk]) map[mk] = { monthKey: mk, typeCount: 0, totalPieces: 0, totalPurchase: 0, totalSale: 0 };
        var qty = getItemAddedBaseQuantity(item);
        map[mk].typeCount += 1;
        map[mk].totalPieces += qty;
        map[mk].totalPurchase += getItemAddedPurchaseCost(item);
        map[mk].totalSale += getItemAddedSaleValue(item);
    });
    var keys = Object.keys(map).sort();
    if (keys.length > 12) keys = keys.slice(-12);
    keys.reverse();
    return keys.map(function(k) { return map[k]; });
}

function renderMonthlyItemAddSummary(summary) {
    var tbody = document.getElementById('monthlyAddedItemsSummaryBody');
    var label = document.getElementById('addedItemsSummaryMonthLabel');
    if (!tbody) return;
    if (!summary || !summary.length) {
        tbody.innerHTML = '<tr><td colspan="5">لا توجد أصناف أضيفت حتى الآن.</td></tr>';
        if (label) label.innerText = '';
        return;
    }
    var currentMonthKey = getMonthKey(Date.now());
    if (label) label.innerText = 'يعرض آخر 12 شهراً مع تمييز الشهر الحالي.';
    tbody.innerHTML = summary.map(function(row) {
        var currentClass = row.monthKey === currentMonthKey ? ' class="current-month-row"' : '';
        return '<tr' + currentClass + '><td>' + formatMonthKeyLabel(row.monthKey) + '</td>' +
            '<td>' + fmtInt(row.typeCount) + '</td>' +
            '<td>' + fmtQty(row.totalPieces) + '</td>' +
            '<td>' + formatMoney(row.totalPurchase) + '</td>' +
            '<td>' + formatMoney(row.totalSale) + '</td></tr>';
    }).join('');
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
    var availableItems = allItems.filter(function(i) { return Number(i.quantity) > 0; });
    var totalCapital = availableItems.reduce(function(a, i) { return a + getItemInventoryCapital(i); }, 0);
    var availableItemCount = availableItems.length;
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
        formatMoney(totalCapital) + '</div><div class="stat-sub">' + availableItemCount + ' صنف</div></div>';
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
    renderMonthlyItemAddSummary(getMonthlyItemsAddedSummary());
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
        var pSec = fmtMoney(convertToSecondary(item.purchasePrice)),
            sSec = fmtMoney(convertToSecondary(item.salePrice));
        var vis = itemVisibility[item.id] || false;
        var cardClass = item.quantity === 0 ? 'out-of-stock' : (item.quantity <= 2 ? 'low-stock' : '');
        var itemCapital = getItemInventoryCapital(item);
        html += '<div class="product-card ' + cardClass + '" data-id="' + item.id +
            '"><div class="product-index-outer">' + (idx + 1) + '</div>' +
            '<div class="card-header"><div class="product-title"><span class="product-name">' + escHtml(item
                .name) + '</span>' + (item.categoryName ? '<span class="product-category-tag">' + escHtml(item
                .categoryName) + '</span>' : '') + '</div>' +
            '<div class="product-meta-wrapper"><div class="product-meta"><span><i class="fas fa-cubes"></i> ' +
            item.quantity + '</span><span style="color:var(--text3);font-size:0.75rem;margin:0 6px;">|</span><span class="' + (vis ? '' : 'blur-price') + '" style="font-size:0.8rem;color:var(--text2);">إجمالي التكلفة: ' + formatMoney(itemCapital) + '</span><span style="color:var(--text3);font-size:0.75rem;margin:0 6px;">|</span><span class="profit-badge-small ' + profitClass + ' ' + (vis ? '' :
                'blur-price') + '">' + profit + '%</span></div>' +
            '<button class="eye-icon" data-id="' + item.id + '"><i class="fas ' + (vis ? 'fa-eye' :
                'fa-eye-slash') + '"></i></button></div></div>' +
            '<div class="price-row"><div class="price-col purchase-price"><div class="price-label">شراء</div><div class="primary-price ' +
            (vis ? '' : 'blur-price') + '">$' + fmtMoney(item.purchasePrice) +
            '</div><div class="secondary-price ' + (vis ? '' : 'blur-price') + '">' + pSec + ' ' + currencySettings
            .secondaryCurrencySymbol + '</div></div>' +
            '<div class="price-col sale-price"><div class="price-label">بيع</div><div class="primary-price">$' +
            fmtMoney(item.salePrice) + '</div><div class="secondary-price">' + sSec + ' ' + currencySettings
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
    var el;
    el = document.getElementById('productHidden'); if (el) el.checked = false;
    el = document.getElementById('productLimitedQty'); if (el) el.checked = false;
    el = document.getElementById('productDiscountEnabled'); if (el) el.checked = false;
    el = document.getElementById('discountValueGroup'); if (el) el.style.display = 'none';
    el = document.getElementById('productDiscountValue'); if (el) el.value = 0;
    el = document.getElementById('productShowPrice'); if (el) el.checked = false;
    el = document.getElementById('productDescription'); if (el) el.value = '';
    el = document.getElementById('productYoutubeUrl'); if (el) el.value = '';
    el = document.getElementById('specificationsContainer'); if (el) el.innerHTML = '';
    el = document.getElementById('imagesContainer'); if (el) el.innerHTML = '';
    if (window.advancedFieldsLoaded) {
        addSpecificationRow('', '');
        addImageRow('', true);
    }
    // initialize purchase batches UI
    window.currentPurchaseBatches = [];
    var pbList = document.getElementById('purchaseBatchesList');
    if (pbList) pbList.innerHTML = '';
    var purchaseEl = document.getElementById('purchasePrice'); if (purchaseEl) purchaseEl.value = '';
    tempPurchaseCurrency = (currencySettings.defaultInputCurrency === 'secondary');
    tempSaleCurrency = (currencySettings.defaultInputCurrency === 'secondary');
    document.getElementById('addItemTitle').innerText = 'إضافة قطعة جديدة';
    updatePriceLabels();
    updateProductPriceDisplay();
    populateCategorySelect();
    document.getElementById('productCategoryId').value = '';
    updatePurchaseBatchesVisibility();
    try { computeBatchesSummary(); } catch (e) {}
}

function editItem(id) {
    var item = allItems.find(function(i) { return i.id === id; });
    if (!item) return;
    currentItemId = id;
    isEditingItem = true;
    document.getElementById('itemName').value = item.name;
    tempPurchaseCurrency = (currencySettings.defaultInputCurrency === 'secondary');
    tempSaleCurrency = (currencySettings.defaultInputCurrency === 'secondary');
    document.getElementById('purchasePrice').value = tempPurchaseCurrency ? fmtMoney(convertToSecondary(item.purchasePrice)) :
        fmtMoney(item.purchasePrice);
    document.getElementById('salePrice').value = tempSaleCurrency ? fmtMoney(convertToSecondary(item.salePrice)) : fmtMoney(item
        .salePrice);
    document.getElementById('quantity').value = item.quantity;
    var el;
    el = document.getElementById('productHidden'); if (el) el.checked = item.hidden || false;
    el = document.getElementById('productLimitedQty'); if (el) el.checked = item.limitedQuantity || false;
    el = document.getElementById('productDiscountEnabled'); if (el) el.checked = item.discountEnabled || false;
    el = document.getElementById('productDiscountValue'); if (el) el.value = item.discountValue || 0;
    el = document.getElementById('discountValueGroup'); if (el) el.style.display = (item.discountEnabled ? 'block' : 'none');
    el = document.getElementById('productShowPrice'); if (el) el.checked = item.showPrice || false;
    el = document.getElementById('productDescription'); if (el) el.value = item.description || '';
    el = document.getElementById('productYoutubeUrl'); if (el) el.value = item.youtubeUrl || '';
    document.getElementById('productCategoryId').value = item.categoryId || '';
    // If advanced fields are loaded inject specs/images now, otherwise defer until user opens advanced options
    if (window.advancedFieldsLoaded) {
        loadSpecificationsAndImages(item);
    } else {
        window.pendingEditItem = item;
    }
    // load purchase batches if present, otherwise create a batch derived from existing purchasePrice & quantity
    window.currentPurchaseBatches = [];
    var pbList = document.getElementById('purchaseBatchesList');
    if (pbList) pbList.innerHTML = '';
    updatePurchaseBatchesVisibility();
    if (isPurchaseBatchesEnabled()) {
        if (item.purchaseBatches && Array.isArray(item.purchaseBatches) && item.purchaseBatches.length) {
            item.purchaseBatches.forEach(function(b) { addPurchaseBatchRow(b); });
        } else {
            if ((item.quantity || 0) > 0) addPurchaseBatchRow({ quantity: item.quantity || 0, unitCost: item.purchasePrice || 0, supplier: '', note: '' });
            else addPurchaseBatchRow({ quantity: 0, unitCost: item.purchasePrice || 0, supplier: '', note: '' });
        }
    }
    computeBatchesSummary();
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

// Purchase batches support (multiple purchase lines with qty, unit cost, supplier, note)
window.currentPurchaseBatches = [];
function addPurchaseBatchRow(batch) {
    if (!isPurchaseBatchesEnabled()) return;
    batch = batch || { quantity: 0, unitCost: 0, supplier: '', note: '' };
    var list = document.getElementById('purchaseBatchesList');
    if (!list) return;
    var row = document.createElement('div');
    row.className = 'purchase-batch-row';
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    row.innerHTML =
        '<input type="number" class="batch-qty" min="0" step="0.01" value="' + (Number(batch.quantity) || 0) + '" style="width:90px;padding:8px;border-radius:10px;border:1px solid var(--border);">' +
        '<input type="number" class="batch-unit" min="0" step="0.01" value="' + (Number(batch.unitCost) || 0) + '" style="width:110px;padding:8px;border-radius:10px;border:1px solid var(--border);">' +
        '<input type="text" class="batch-supplier" placeholder="المورد" value="' + escHtml(batch.supplier || '') + '" style="flex:1;padding:8px;border-radius:10px;border:1px solid var(--border);">' +
        '<input type="text" class="batch-note" placeholder="ملاحظة" value="' + escHtml(batch.note || '') + '" style="flex:1;padding:8px;border-radius:10px;border:1px solid var(--border);">' +
        '<button type="button" class="remove-batch" title="حذف" style="background:transparent;border:none;color:var(--danger);font-weight:700;">✖</button>';
    list.appendChild(row);

    var qtyEl = row.querySelector('.batch-qty');
    var unitEl = row.querySelector('.batch-unit');
    var supEl = row.querySelector('.batch-supplier');
    var noteEl = row.querySelector('.batch-note');
    var delBtn = row.querySelector('.remove-batch');

    function onChange() { computeBatchesSummary(); }
    qtyEl.addEventListener('input', onChange);
    unitEl.addEventListener('input', onChange);
    supEl.addEventListener('input', onChange);
    noteEl.addEventListener('input', onChange);
    delBtn.addEventListener('click', function() { row.remove(); computeBatchesSummary(); });
    computeBatchesSummary();
}

function getPurchaseBatchesFromUI() {
    if (!isPurchaseBatchesEnabled()) return [];
    var rows = document.querySelectorAll('#purchaseBatchesList .purchase-batch-row');
    var batches = [];
    rows.forEach(function(r) {
        var q = parseFloat(r.querySelector('.batch-qty').value) || 0;
        var u = parseFloat(r.querySelector('.batch-unit').value) || 0;
        var s = r.querySelector('.batch-supplier').value || '';
        var n = r.querySelector('.batch-note').value || '';
        if (q > 0 && u >= 0) batches.push({ quantity: q, unitCost: Number(u), supplier: s, note: n, timestamp: Date.now() });
    });
    return batches;
}

function computeBatchesSummary() {
    if (!isPurchaseBatchesEnabled()) {
        window.currentPurchaseBatches = [];
        var purchaseEl = document.getElementById('purchasePrice');
        if (purchaseEl) {
            purchaseEl.readOnly = false;
            purchaseEl.title = '';
        }
        var qtyEl = document.getElementById('quantity');
        if (qtyEl) {
            qtyEl.readOnly = false;
            qtyEl.title = '';
        }
        var totalQtyEl = document.getElementById('batchesTotalQty');
        if (totalQtyEl) totalQtyEl.innerText = '0';
        var totalCostEl = document.getElementById('batchesTotalCost');
        if (totalCostEl) totalCostEl.innerText = '0';
        return;
    }
    var rows = document.querySelectorAll('#purchaseBatchesList .purchase-batch-row');
    var totalQty = 0, totalCost = 0;
    rows.forEach(function(r) {
        var q = parseFloat(r.querySelector('.batch-qty').value) || 0;
        var uDisplay = parseFloat(r.querySelector('.batch-unit').value) || 0;
        // convert displayed unit to primary currency for internal calc if needed
        var uPrimary = tempPurchaseCurrency ? convertToPrimary(uDisplay) : uDisplay;
        if (q > 0 && uPrimary >= 0) {
            totalQty += q;
            totalCost += q * uPrimary;
        }
    });
    var avgPrimary = totalQty > 0 ? (totalCost / totalQty) : 0;
    // update UI values according to display currency (show in current purchase input currency)
    document.getElementById('batchesTotalQty').innerText = totalQty;
    var totalCostDisplayed = tempPurchaseCurrency ? convertToSecondary(totalCost) : totalCost;
    document.getElementById('batchesTotalCost').innerText = fmtMoney(totalCostDisplayed);
    var purchaseEl = document.getElementById('purchasePrice');
    if (purchaseEl) {
        // Only update the purchase input when batches actually define a non-zero average.
        if (totalQty > 0) {
            var avgDisplayed = tempPurchaseCurrency ? convertToSecondary(avgPrimary) : avgPrimary;
            purchaseEl.value = Number((avgDisplayed || 0).toFixed(2));
            purchaseEl.readOnly = true;
            purchaseEl.title = 'سعر الشراء محسوب تلقائياً من دفعات الشراء';
        } else {
            // Do not overwrite manual input when there are no batches.
            purchaseEl.readOnly = false;
            purchaseEl.title = '';
        }
    }
    // If batches define a total quantity, reflect it on the main quantity input
    var qtyEl = document.getElementById('quantity');
    if (qtyEl) {
        if (totalQty > 0) {
            qtyEl.value = totalQty;
            qtyEl.readOnly = true;
            qtyEl.title = 'تم تعيين الكمية تلقائياً من دفعات الشراء';
        } else {
            // preserve manual quantity when no batches exist
            qtyEl.readOnly = false;
            qtyEl.title = '';
        }
    }
    window.currentPurchaseBatches = getPurchaseBatchesFromUI();
}

document.getElementById('addPurchaseBatchBtn').addEventListener('click', function() { addPurchaseBatchRow({ quantity: 1, unitCost: 0, supplier: '', note: '' }); });


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

// Ensure advanced product fields are instantiated (lazy load)
function ensureAdvancedFieldsLoaded() {
    return new Promise(function(resolve) {
        if (window.advancedFieldsLoaded) return resolve();
        var tpl = document.getElementById('advancedProductTemplate');
        var container = document.getElementById('advancedContainer');
        if (!tpl || !container) return resolve();
        container.appendChild(tpl.content.cloneNode(true));
        // wire up buttons
        var addSpec = document.getElementById('addSpecBtn');
        if (addSpec) addSpec.addEventListener('click', function() { addSpecificationRow('', ''); });
        var addImg = document.getElementById('addImageBtn');
        if (addImg) addImg.addEventListener('click', function() { addImageRow('', document.querySelectorAll('#imagesContainer .image-row').length === 0); });
        var disc = document.getElementById('productDiscountEnabled');
        if (disc) disc.addEventListener('change', function() { var dv = document.getElementById('discountValueGroup'); if (dv) dv.style.display = this.checked ? 'block' : 'none'; });
        // If we are editing an item and pending data exists, populate it
        if (window.pendingEditItem) {
            loadSpecificationsAndImages(window.pendingEditItem);
            window.pendingEditItem = null;
        } else {
            // if creating new item, ensure one empty spec and image exist
            if (!document.querySelectorAll('#specificationsContainer .spec-row').length) addSpecificationRow('', '');
            if (!document.querySelectorAll('#imagesContainer .image-row').length) addImageRow('', true);
        }
        window.advancedFieldsLoaded = true;
        resolve();
    });
}

// Advanced toggle button behavior
var advBtn = document.getElementById('advancedToggleBtn');
if (advBtn) {
    advBtn.addEventListener('click', async function() {
        var cont = document.getElementById('advancedContainer');
        var che = document.getElementById('advancedChevron');
        if (!window.advancedFieldsLoaded) {
            await ensureAdvancedFieldsLoaded();
            if (cont) cont.style.display = 'block';
            if (che) { che.classList.remove('fa-chevron-down'); che.classList.add('fa-chevron-up'); }
        } else {
            if (cont) cont.style.display = cont.style.display === 'none' || !cont.style.display ? 'block' : 'none';
            if (che) che.classList.toggle('fa-chevron-down'), che.classList.toggle('fa-chevron-up');
        }
    });
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
    // ensure batches summary and quantity are up-to-date before collecting values
    try { computeBatchesSummary(); } catch (err) {}
    var name = document.getElementById('itemName').value.trim();
    // determine purchase price from purchase batches (weighted average) if any, otherwise fallback to single field
    var uiBatches = getPurchaseBatchesFromUI();
    var purchase = 0;
    var storedBatches = [];
    var qtyEl = document.getElementById('quantity');
    var purchaseEl = document.getElementById('purchasePrice');
    var qtyRaw = qtyEl ? parseInputNumber(qtyEl.value) : null;
    var purchaseRaw = purchaseEl ? parseInputNumber(purchaseEl.value) : null;
    var qty = null;
    if (uiBatches && uiBatches.length) {
        var tQ = 0, tC = 0;
        uiBatches.forEach(function(b) {
            var unit = Number(b.unitCost) || 0;
            // convert displayed currency to primary for storage if needed
            if (tempPurchaseCurrency) unit = convertToPrimary(unit);
            tQ += Number(b.quantity) || 0;
            tC += unit * (Number(b.quantity) || 0);
            storedBatches.push({ quantity: Number(b.quantity) || 0, unitCost: Number(unit), supplier: b.supplier || '', note: b.note || '', timestamp: b.timestamp || Date.now() });
        });
        purchase = tQ > 0 ? (tC / tQ) : 0;
        qty = tQ; // quantity must match batch totals to avoid inconsistency
        if (qtyEl) qtyEl.value = qty;
    } else {
        // Prefer manual inputs when provided. If absent and editing, preserve existing values.
        var existingItem = isEditingItem ? allItems.find(function(i) { return i.id === currentItemId; }) : null;
        if (qtyRaw !== null) {
            qty = qtyRaw;
        } else if (existingItem) {
            qty = existingItem.quantity || 0;
        } else {
            qty = 0;
        }

        if (purchaseRaw !== null) {
            purchase = tempPurchaseCurrency ? convertToPrimary(purchaseRaw) : purchaseRaw;
        } else if (existingItem) {
            purchase = existingItem.purchasePrice || 0;
        } else {
            purchase = 0;
        }
    }
    purchase = Number((purchase || 0).toFixed(2));
    var rawSale = parseInputNumber(document.getElementById('salePrice').value);
    var sale = rawSale === null ? 0 : (tempSaleCurrency ? convertToPrimary(rawSale) : rawSale);
    if (!name || purchase < 0 || sale < 0 || qty < 0) return alert('بيانات غير صالحة');
    var catId = document.getElementById('productCategoryId').value;
    var cat = allCategories.find(function(c) { return c.id === catId; });
    var categoryName = cat ? cat.name : '';
    // Collect advanced fields only if present in DOM. When editing and advanced fields are not loaded,
    // preserve existing values from the original item.
    var existingItem = isEditingItem ? allItems.find(function(i) { return i.id === currentItemId; }) : null;
    function getCheckbox(id, defaultVal) { var el = document.getElementById(id); if (el) return el.checked; return (existingItem && existingItem[id.replace(/^product/, '').charAt(0).toLowerCase() + id.replace(/^product/, '').slice(1)]) || defaultVal; }
    var hiddenVal = (document.getElementById('productHidden') ? document.getElementById('productHidden').checked : (existingItem ? !!existingItem.hidden : false));
    var limitedVal = (document.getElementById('productLimitedQty') ? document.getElementById('productLimitedQty').checked : (existingItem ? !!existingItem.limitedQuantity : false));
    var discountEnabledVal = (document.getElementById('productDiscountEnabled') ? document.getElementById('productDiscountEnabled').checked : (existingItem ? !!existingItem.discountEnabled : false));
    var discountValueVal = 0;
    if (document.getElementById('productDiscountValue')) discountValueVal = parseFloat(document.getElementById('productDiscountValue').value) || 0;
    else if (existingItem) discountValueVal = existingItem.discountValue || 0;
    var showPriceVal = (document.getElementById('productShowPrice') ? document.getElementById('productShowPrice').checked : (existingItem ? !!existingItem.showPrice : false));
    var descriptionVal = document.getElementById('productDescription') ? document.getElementById('productDescription').value : (existingItem ? (existingItem.description || '') : '');
    var youtubeVal = document.getElementById('productYoutubeUrl') ? document.getElementById('productYoutubeUrl').value : (existingItem ? (existingItem.youtubeUrl || '') : '');
    var specsVal = document.getElementById('specificationsContainer') ? collectSpecifications() : (existingItem ? (existingItem.specifications || []) : []);
    var imagesVal = document.getElementById('imagesContainer') ? collectImages() : (existingItem ? (existingItem.images || []) : []);

    var extra = {
        hidden: hiddenVal,
        limitedQuantity: limitedVal,
        discountEnabled: discountEnabledVal,
        discountValue: discountEnabledVal ? discountValueVal : 0,
        showPrice: showPriceVal,
        description: descriptionVal,
        youtubeUrl: youtubeVal,
        specifications: specsVal,
        images: imagesVal,
        purchaseBatches: storedBatches,
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
    if (!item) {
        // attempt to fetch item from DB when not cached
        db.collection('items').doc(itemId).get().then(function(d) {
            if (!d.exists) return alert('المنتج غير موجود');
            item = { id: d.id, ...d.data() };
            // continue with UI population
            document.getElementById('sellProductName').innerText = item.name;
            document.getElementById('sellQuantity').value = 1;
            document.getElementById('sellQuantity').max = item.quantity;
            tempSellCurrency = (currencySettings.defaultSellCurrency === 'secondary');
            document.getElementById('sellPriceRow').classList.remove('swapped');
            document.getElementById('sellPriceLabel').innerHTML = 'السعر للقطعة (' + (tempSellCurrency ? currencySettings.secondaryCurrencySymbol : '$') + ')';
            document.getElementById('sellPrice').value = tempSellCurrency ? fmtMoney(convertToSecondary(item.salePrice)) : fmtMoney(item.salePrice);
            updateSellPriceDisplay();
            document.getElementById('sellForm').dataset.itemId = itemId;
            document.getElementById('sellModal').classList.add('show');
        }).catch(function() { return alert('تعذر جلب بيانات المنتج'); });
        return;
    }
    document.getElementById('sellProductName').innerText = item.name;
    document.getElementById('sellQuantity').value = 1;
    document.getElementById('sellQuantity').max = item.quantity;
    tempSellCurrency = (currencySettings.defaultSellCurrency === 'secondary');
    document.getElementById('sellPriceRow').classList.remove('swapped');
    document.getElementById('sellPriceLabel').innerHTML = 'السعر للقطعة (' + (tempSellCurrency ? currencySettings
        .secondaryCurrencySymbol : '$') + ')';
    document.getElementById('sellPrice').value = tempSellCurrency ? fmtMoney(convertToSecondary(item.salePrice)) : fmtMoney(item
        .salePrice);
    updateSellPriceDisplay();
    document.getElementById('sellForm').dataset.itemId = itemId;
    document.getElementById('sellModal').classList.add('show');
}

document.getElementById('sellForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var itemId = document.getElementById('sellForm').dataset.itemId;
    var item = allItems.find(function(i) { return i.id === itemId; });
    if (!item) return;
    var qty = parseInputNumber(document.getElementById('sellQuantity').value);
    if (qty === null || qty <= 0 || qty > item.quantity) return alert('كمية غير صالحة');
    var rawPrice = parseInputNumber(document.getElementById('sellPrice').value);
    if (rawPrice === null) return alert('السعر غير صالح');
    var price = tempSellCurrency ? convertToPrimary(rawPrice) : rawPrice;
    var currency = tempSellCurrency ? 'secondary' : 'primary';
    var allocations = null;
    var purchasePriceAtTime = item.purchasePrice;
    var submitBtn = document.querySelector('#sellForm button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.dataset._origText = submitBtn.innerText; submitBtn.innerText = 'جارٍ...'; }
    try {
        // if item has purchaseBatches, compute allocations and apply them atomically
        if (item.purchaseBatches && Array.isArray(item.purchaseBatches) && item.purchaseBatches.length) {
            allocations = computeBatchAllocations(item, qty);
            if (!allocations || allocations.length === 0) return alert('كمية غير متوفرة في دفعات الشراء');
            // compute average purchase price before consuming batches
            var avgPurchasePrice = computeAveragePurchasePrice(item);
            var res = await applyBatchAllocationsTransaction(item.id, allocations);
            item.purchaseBatches = res.purchaseBatches;
            item.quantity = res.quantity;
            purchasePriceAtTime = avgPurchasePrice;
        } else {
            // fallback to simple quantity transaction
            var newQty = await updateItemQuantityTransaction(item.id, -qty);
            item.quantity = newQty;
        }
    } catch (err) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = submitBtn.dataset._origText || 'تأكيد'; delete submitBtn.dataset._origText; }
        return alert('فشل البيع: ' + (err && err.message ? err.message : 'خطأ'));
    }
    var saleObj = buildSaleObject(item, qty, price, currency, purchasePriceAtTime);
    if (allocations) saleObj.purchaseBatchAllocations = allocations;
    try {
        var ref = await db.collection('sales').add(saleObj);
        saleObj.saleId = ref.id;
        await db.collection('stats').doc('totals').set({
            allTimeProfit: firebase.firestore.FieldValue.increment(saleObj.profit),
            updatedAt: Date.now()
        }, { merge: true });
        window._cachedStats.allTimeProfit = (window._cachedStats.allTimeProfit || 0) + saleObj.profit;
        commitItemUpdate(item);
        if (currentSection === 'addItem' && currentItemId === item.id) {
            var qtyInput = document.getElementById('quantity');
            if (qtyInput) qtyInput.value = item.quantity;
            try { computeBatchesSummary(); } catch (e) {}
        }
        addSaleLocally(saleObj);
        await logActivity('sell', 'sale', saleObj.saleId, 'بيع منتج: ' + item.name + '، الكمية: ' + qty + '، الربح: ' + fmt(saleObj.profit), { itemId: item.id, itemName: item.name, quantity: qty, profit: saleObj.profit });
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = submitBtn.dataset._origText || 'تأكيد'; delete submitBtn.dataset._origText; }
        closeModalById('sellModal');
        showToast('تم البيع بنجاح');
        if (document.getElementById('itemsList')) renderInventory();
        if (currentSection === 'dashboard') renderDashboard();
    } catch (err) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = submitBtn.dataset._origText || 'تأكيد'; delete submitBtn.dataset._origText; }
        alert('فشل البيع: ' + (err && err.message ? err.message : 'خطأ'));
    }
});

document.getElementById('switchPurchaseCurrency').addEventListener('click', function() {
    var inputEl = document.getElementById('purchasePrice');
    var v = parseInputNumber(inputEl.value);
    v = v === null ? 0 : v;
    // convert existing batch unit values to the other currency
    var batchUnits = document.querySelectorAll('.batch-unit');
    batchUnits.forEach(function(b) {
        var val = parseFloat(b.value) || 0;
        // toggle currency conversion
        b.value = tempPurchaseCurrency ? fmtMoney(convertToPrimary(val)) : fmtMoney(convertToSecondary(val));
    });
    tempPurchaseCurrency = !tempPurchaseCurrency;
    inputEl.value = tempPurchaseCurrency ? fmtMoney(convertToSecondary(v)) : fmtMoney(convertToPrimary(v));
    updatePriceLabels();
    updateProductPriceDisplay();
    computeBatchesSummary();
});
document.getElementById('switchSaleCurrency').addEventListener('click', function() {
    var inputEl = document.getElementById('salePrice');
    var v = parseInputNumber(inputEl.value);
    v = v === null ? 0 : v;
    tempSaleCurrency = !tempSaleCurrency;
    inputEl.value = tempSaleCurrency ? fmtMoney(convertToSecondary(v)) : fmtMoney(convertToPrimary(v));
    updatePriceLabels();
    updateProductPriceDisplay();
});
document.getElementById('switchSellCurrency').addEventListener('click', function() {
    var inputEl = document.getElementById('sellPrice');
    var v = parseInputNumber(inputEl.value);
    v = v === null ? 0 : v;
    tempSellCurrency = !tempSellCurrency;
    inputEl.value = tempSellCurrency ? fmtMoney(convertToSecondary(v)) : fmtMoney(convertToPrimary(v));
    document.getElementById('sellPriceLabel').innerHTML = 'السعر للقطعة (' + (tempSellCurrency ? currencySettings
        .secondaryCurrencySymbol : '$') + ')';
    updateSellPriceDisplay();
});
document.getElementById('switchEditCurrency').addEventListener('click', function() {
    var inputEl = document.getElementById('editPrice');
    var v = parseInputNumber(inputEl.value);
    v = v === null ? 0 : v;
    tempEditCurrency = !tempEditCurrency;
    inputEl.value = tempEditCurrency ? fmtMoney(convertToSecondary(v)) : fmtMoney(convertToPrimary(v));
    document.getElementById('editPriceLabel').innerHTML = 'السعر (' + (tempEditCurrency ? currencySettings
        .secondaryCurrencySymbol : '$') + ')';
    updateEditSalePriceDisplay();
});
document.getElementById('purchasePrice').addEventListener('input', updateProductPriceDisplay);
document.getElementById('salePrice').addEventListener('input', updateProductPriceDisplay);
document.getElementById('sellPrice').addEventListener('input', updateSellPriceDisplay);
var sellQtyEl = document.getElementById('sellQuantity');
if (sellQtyEl) sellQtyEl.addEventListener('input', updateSellPriceDisplay);
setupSellQuantityPresets();
document.getElementById('editPrice').addEventListener('input', updateEditSalePriceDisplay);
var _addSpecBtn = document.getElementById('addSpecBtn'); if (_addSpecBtn) _addSpecBtn.addEventListener('click', function() { addSpecificationRow('', ''); });
var _addImageBtn = document.getElementById('addImageBtn'); if (_addImageBtn) _addImageBtn.addEventListener('click', function() { addImageRow('', false); });
var _productDiscountEnabled = document.getElementById('productDiscountEnabled'); if (_productDiscountEnabled) _productDiscountEnabled.addEventListener('change', function() {
    var dv = document.getElementById('discountValueGroup'); if (dv) dv.style.display = _productDiscountEnabled.checked ? 'block' : 'none';
});
function setupSellQuantityPresets() {
    var buttons = document.querySelectorAll('.sell-quantity-preset');
    buttons.forEach(function(button) {
        button.addEventListener('click', function() {
            var qty = parseFloat(button.dataset.qty);
            var input = document.getElementById('sellQuantity');
            if (!input || isNaN(qty)) return;
            input.value = qty;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });
}

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

async function reloadSalesLog() {
    // Reset cache to initial state
    salesQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
    // Fetch fresh data from Firebase
    await fetchSalesPage();
    // Render the updated table
    renderSalesTable();
}

async function fetchSalesPage() {
    if (salesQueryCache.loading || !salesQueryCache.hasMore) return;
    salesQueryCache.loading = true;
    updateSalesLoadMoreButton();

    var query = db.collection('sales').orderBy('timestamp', 'desc').limit(salesPageSize + 1);
    if (salesQueryCache.lastDoc) query = query.startAfter(salesQueryCache.lastDoc);
    try {
        var snap = await query.get();
        var rawItems = snap.docs.map(function(d) { return { saleId: d.id, ...d.data() }; });
        var nextCursor = null;
        if (rawItems.length > salesPageSize) {
            nextCursor = snap.docs[salesPageSize - 1];
            rawItems = rawItems.slice(0, salesPageSize);
        }
        salesQueryCache.currentPageItems = (salesQueryCache.currentPageItems || []).concat(rawItems);
        salesQueryCache.lastDoc = nextCursor;
        salesQueryCache.hasMore = !!nextCursor;
    } catch (e) {
        salesQueryCache.hasMore = false;
        showFirestoreError(e, 'تعذّر تحميل سجلات المبيعات');
    } finally {
        salesQueryCache.loading = false;
        updateSalesLoadMoreButton();
    }
}

function renderSalesLog() {
    if (!salesQueryCache.currentPageItems.length) {
        renderSalesTable();
        fetchSalesPage().then(renderSalesTable);
    } else {
        renderSalesTable();
    }
}

function renderSalesTable() {
    var currentCount = (salesQueryCache.currentPageItems || []).length;
    var statusLabel = 'لا توجد عمليات';
    if (currentCount > 0) statusLabel = 'عرض ' + currentCount + ' من السجلات';
    else if (salesQueryCache.loading) statusLabel = 'جاري تحميل السجلات...';
    document.getElementById('salesCountLabel').textContent = statusLabel;
    var tbody = document.getElementById('salesLogBody');
    tbody.innerHTML = buildSalesRowsHtml(salesQueryCache.currentPageItems || []);
    renderSalesLoadMore();
}

function buildSalesRowsHtml(items) {
    if (!items.length) {
        return '<tr><td colspan="10" style="padding:30px;color:var(--text3);">لا توجد عمليات</td></tr>';
    }
    var html = '';
    var lastDayKey = null;
    var dayCostTotal = 0;
    var dayProfitTotal = 0;
    items.forEach(function(s, i) {
        var dayKey = getDayKey(s.timestamp);
        if (dayKey !== lastDayKey) {
            if (lastDayKey !== null) {
                html += getDailyTotalsRowHtml(dayCostTotal, dayProfitTotal, 10);
            }
            html += getDateSeparatorRowHtml(s.timestamp, 10);
            lastDayKey = dayKey;
            dayCostTotal = 0;
            dayProfitTotal = 0;
        }
        var cost = (s.purchasePriceAtTime || 0) * (s.quantity || 0);
        dayCostTotal += cost;
        dayProfitTotal += s.profit || 0;
        var profitPct = cost > 0 ? ((s.profit || 0) / cost * 100) : 0;
        html += '<tr><td>' + (i + 1) + '</td><td>' + fmtDateTime(s.timestamp) + '</td><td>' +
            escHtml(s.itemName || '--') + '</td><td>' + (s.quantity || 0) + '</td><td>' +
            formatMoney(s.unitPrice || 0) + '</td><td>' + formatMoney(s.totalAmount || 0) +
            '</td><td>' + formatMoney(cost) +
            '</td><td class="' + ((s.profit || 0) >= 0 ? 'profit-positive' : 'profit-negative') + '">' + formatMoney(s.profit || 0) +
            '</td><td><span class="badge ' + (profitPct >= 20 ? 'badge-success' : profitPct >= 0 ?
                'badge-warning' : 'badge-danger') + '">' + fmt(profitPct) +
            '%</span></td><td><button onclick="viewSaleDetail(\'' + s.saleId +
            '\')" style="background:var(--primary-light);color:var(--primary);border:none;border-radius:20px;padding:5px 12px;cursor:pointer;font-size:0.72rem;font-weight:600;margin-right:6px;">عرض</button></td></tr>';
    });
    if (lastDayKey !== null) {
        html += getDailyTotalsRowHtml(dayCostTotal, dayProfitTotal, 10);
    }
    return html;
}

function getDailyTotalsRowHtml(costTotal, profitTotal, colspan) {
    return '<tr style="background:var(--surface);font-weight:800;border-top:1px solid var(--border);border-bottom:1px solid var(--border);">' +
        '<td colspan="6" style="padding:12px 10px;text-align:right;color:var(--text);">مجموع اليوم</td>' +
        '<td style="padding:12px 10px;color:var(--text);">' + formatMoney(costTotal) + '</td>' +
        '<td style="padding:12px 10px;color:var(--text);">' + formatMoney(profitTotal) + '</td>' +
        '<td colspan="2"></td></tr>';
}

function getDateSeparatorRowHtml(ts, colspan) {
    return '<tr><td colspan="' + colspan + '" style="padding:14px 12px;background:var(--surface);color:var(--text3);font-weight:800;border-top:1px solid var(--border);border-bottom:1px solid var(--border);text-align:center;">' + escHtml(formatDateSeparatorLabel(ts)) + '</td></tr>';
}

function renderSalesLoadMore() {
    var row = document.getElementById('salesLoadMoreRow');
    if (!row) return;
    if (!salesQueryCache.hasMore && (salesQueryCache.currentPageItems || []).length > 0) {
        row.style.display = 'none';
        return;
    }
    row.style.display = 'flex';
    updateSalesLoadMoreButton();
}

function updateSalesLoadMoreButton() {
    var btn = document.getElementById('salesLoadMoreBtn');
    var info = document.getElementById('salesLoadMoreInfo');
    if (!btn || !info) return;
    btn.disabled = !!salesQueryCache.loading || !salesQueryCache.hasMore;
    btn.textContent = salesQueryCache.loading ? 'جاري التحميل...' : 'تحميل المزيد';
    info.textContent = salesQueryCache.hasMore ? '' : ((salesQueryCache.currentPageItems || []).length ? 'تم تحميل جميع السجلات.' : 'لا توجد سجلات إضافية.');
}

function loadMoreSales() {
    if (salesQueryCache.loading || !salesQueryCache.hasMore) return;
    fetchSalesPage().then(renderSalesTable);
}

function renderSalesPagination() {
    if (!salesQueryCache.currentPageItems.length && !salesQueryCache.hasMore) {
        document.getElementById('salesPagination').innerHTML = '';
        return;
    }
    var html = '';
    html += '<button ' + (salesPage === 0 ? 'disabled' : '') + ' onclick="goToSalesPage(' + (salesPage - 1) + ')">السابق</button>';
    html += '<button class="active">صفحة ' + (salesPage + 1) + '</button>';
    html += '<button ' + (!salesQueryCache.hasMore ? 'disabled' : '') + ' onclick="goToSalesPage(' + (salesPage + 1) + ')">التالي</button>';
    document.getElementById('salesPagination').innerHTML = html;
}

function goToSalesPage(p) { salesPage = Math.max(0, p);
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
        '" step="0.01" onchange="updateSalesFilter(\'minQty\',this.value)" style="max-width:100px;">' +
        '<input type="number" id="sfMaxQty" placeholder="أعلى كمية" value="' + sp.maxQty +
        '" step="0.01" onchange="updateSalesFilter(\'maxQty\',this.value)" style="max-width:100px;">' +
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
    salesPageCursors = [null];
    salesPageItemsCache = {};
    salesQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
    renderSalesLog();
}

function resetSalesFilters() {
    salesFilterParams = { period: 'all', searchTerm: '', categoryId: '', productId: '', minQty: '', maxQty: '',
        minProfit: '', maxProfit: '', minProfitPct: '', maxProfitPct: '' };
    salesPage = 0;
    salesPageCursors = [null];
    salesPageItemsCache = {};
    salesQueryCache = { lastDoc: null, hasMore: true, currentPageItems: [] };
    renderSalesLog();
}

function viewSaleDetail(saleId) {
    var s = allSales.find(function(x) { return x.saleId === saleId; });
    if (!s) { s = (salesQueryCache.currentPageItems || []).find(function(x) { return x.saleId === saleId; }); }
    if (!s) {
        db.collection('sales').doc(saleId).get().then(function(doc) {
            if (doc.exists) {
                var data = { saleId: doc.id, ...doc.data() };
                renderSaleDetailModal(data);
            }
        }).catch(function() {});
        return;
    }
    renderSaleDetailModal(s);
}

function renderSaleDetailModal(s) {
    var cost = (s.purchasePriceAtTime || 0) * (s.quantity || 0);
    var profitPct = cost > 0 ? ((s.profit || 0) / cost * 100) : 0;
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
        '<div><strong>نسبة الربح:</strong> ' + fmt(profitPct) + '%</div></div>' +
        '<div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end;">' +
        '<button onclick="closeModalById(\'saleDetailModal\')" style="background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:20px;padding:8px 16px;cursor:pointer;font-weight:700;">إغلاق</button>' +
        '<button onclick="closeModalById(\'saleDetailModal\'); editSale(\'' + s.saleId + '\')" style="background:var(--accent-light);color:var(--accent);border:none;border-radius:20px;padding:8px 16px;cursor:pointer;font-weight:700;">تعديل</button>' +
        '<button onclick="closeModalById(\'saleDetailModal\'); cancelSale(\'' + s.saleId + '\')" style="background:var(--danger-light);color:var(--danger);border:none;border-radius:20px;padding:8px 16px;cursor:pointer;font-weight:700;">إلغاء</button>' +
        '</div>';
    document.getElementById('saleDetailModal').classList.add('show');
}

window.viewSaleDetail = viewSaleDetail;

window.editSale = function(saleId) {
    var sale = allSales.find(function(s) { return s.saleId === saleId; });
    // If not cached locally, try to fetch from Firestore
    var saleDocFetch = null;
    if (!sale) {
        saleDocFetch = db.collection('sales').doc(saleId).get().then(function(d) {
            if (!d.exists) throw new Error('بيع غير موجود');
            return { saleId: d.id, ...d.data() };
        }).catch(function(err) { return null; });
    }
    Promise.resolve(saleDocFetch || sale).then(async function(res) {
        var theSale = res || sale;
        if (!theSale) return alert('سجل البيع غير متوفر حالياً');
        var prod = allItems.find(function(i) { return i.id === theSale.itemId; });
        if (!prod) {
            // try fetching product from DB
            try {
                var pd = await db.collection('items').doc(theSale.itemId).get();
                if (!pd.exists) return alert('المنتج غير موجود');
                prod = { id: pd.id, ...pd.data() };
            } catch (err) {
                return alert('المنتج غير موجود');
            }
        }
        var sale = theSale;
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
    document.getElementById('editPrice').value = tempEditCurrency ? fmtMoney(convertToSecondary(sale.unitPrice)) : fmtMoney(sale
        .unitPrice);
    updateEditSalePriceDisplay();
        document.getElementById('editSaleModal').classList.add('show');
    });
};

document.getElementById('editSaleForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var saleId = document.getElementById('editSaleId').value;
    var itemId = document.getElementById('editOriginalItemId').value;
    var oldQty = parseInputNumber(document.getElementById('editOriginalQuantity').value);
    oldQty = oldQty === null ? 0 : oldQty;
    var newQty = parseInputNumber(document.getElementById('editQuantity').value);
    newQty = newQty === null ? 0 : newQty;
    var rawPrice = parseInputNumber(document.getElementById('editPrice').value);
    var price = rawPrice === null ? 0 : (tempEditCurrency ? convertToPrimary(rawPrice) : rawPrice);
    var sale = allSales.find(function(s) { return s.saleId === saleId; });
    var prod = allItems.find(function(i) { return i.id === itemId; });
    if (!sale || !prod) return;
    var diff = newQty - oldQty;
    var newSaleAllocations = sale.purchaseBatchAllocations ? JSON.parse(JSON.stringify(sale.purchaseBatchAllocations)) : [];
    try {
        if (diff !== 0) {
            if (prod.purchaseBatches && Array.isArray(prod.purchaseBatches) && prod.purchaseBatches.length) {
                if (diff > 0) {
                    // need to consume additional qty from batches
                    var extraAlloc = computeBatchAllocations(prod, diff);
                    if (!extraAlloc || extraAlloc.length === 0) return alert('كمية غير متوفرة');
                    var res = await applyBatchAllocationsTransaction(prod.id, extraAlloc);
                    prod.purchaseBatches = res.purchaseBatches;
                    prod.quantity = res.quantity;
                    // append allocations to sale's allocations
                    newSaleAllocations = newSaleAllocations.concat(extraAlloc);
                } else {
                    // diff < 0 : restore some quantity back to batches using sale allocations (LIFO)
                    var toRestore = -diff;
                    function extractRestore(existing, qty) {
                        var arr = existing.slice();
                        var restore = [];
                        var remaining = qty;
                        while (remaining > 0 && arr.length) {
                            var last = arr[arr.length - 1];
                            if ((last.quantity || 0) <= remaining) {
                                restore.push(last);
                                remaining -= last.quantity || 0;
                                arr.pop();
                            } else {
                                // split allocation
                                restore.push({ timestamp: last.timestamp || null, unitCost: last.unitCost || 0, quantity: remaining });
                                last.quantity = (last.quantity || 0) - remaining;
                                arr[arr.length - 1] = last;
                                remaining = 0;
                            }
                        }
                        if (remaining > 0) throw new Error('تعذر استعادة الكمية من تسجيل البيع');
                        return { restoreAllocations: restore, remainingAllocations: arr };
                    }
                    var extracted = extractRestore(newSaleAllocations, toRestore);
                    var restoreAlloc = extracted.restoreAllocations;
                    var remainingAlloc = extracted.remainingAllocations;
                    var res2 = await restoreBatchAllocationsTransaction(prod.id, restoreAlloc);
                    prod.purchaseBatches = res2.purchaseBatches;
                    prod.quantity = res2.quantity;
                    newSaleAllocations = remainingAlloc;
                }
            } else {
                // fallback: simple quantity transaction
                var nq = await updateItemQuantityTransaction(prod.id, -diff);
                prod.quantity = nq;
            }
        }
    } catch (err) {
        return alert('فشل تعديل الكمية: ' + (err && err.message ? err.message : 'خطأ'));
    }
    var oldProfit = sale.profit || 0;
    var costBasis = (sale.purchasePriceAtTime != null) ? sale.purchasePriceAtTime : computeAveragePurchasePrice(prod);
    var newTotal = calculateSaleTotal(price, newQty);
    var newProfit = calculateSaleProfit(price, costBasis, newQty);
    var profitDiff = newProfit - oldProfit;
    var upd = { ...sale, quantity: newQty, unitPrice: price, totalAmount: newTotal, profit: newProfit,
        saleCurrency: tempEditCurrency ? 'secondary' : 'primary', purchaseBatchAllocations: newSaleAllocations, purchasePriceAtTime: costBasis };
    await db.collection('sales').doc(saleId).set(upd);
    if (profitDiff !== 0) {
        await db.collection('stats').doc('totals').set({
            allTimeProfit: firebase.firestore.FieldValue.increment(profitDiff),
            updatedAt: Date.now()
        }, { merge: true });
        window._cachedStats.allTimeProfit = (window._cachedStats.allTimeProfit || 0) + profitDiff;
    }
    await logActivity('update', 'sale', saleId, 'تعديل بيع: ' + sale.itemName + '، الكمية الجديدة: ' + newQty + '، السعر: ' + fmt(price), { oldQuantity: oldQty, newQuantity: newQty, oldProfit: oldProfit, newProfit: newProfit });
    commitItemUpdate(prod);
    replaceSaleLocally(saleId, upd);
    if (document.getElementById('itemsList')) renderInventory();
    closeModalById('editSaleModal');
    showToast('تم تعديل البيع');
    await reloadSalesLog();
    if (currentSection === 'dashboard') renderDashboard();
});

window.cancelSale = async function(saleId) {
    if (!confirm('إلغاء البيع؟')) return;
    var sale = allSales.find(function(s) { return s.saleId === saleId; });
    if (!sale) {
        try {
            var sd = await db.collection('sales').doc(saleId).get();
            if (!sd.exists) return alert('سجل البيع غير موجود');
            sale = { saleId: sd.id, ...sd.data() };
        } catch (err) {
            return alert('تعذر جلب سجل البيع');
        }
    }
    var prod = allItems.find(function(i) { return i.id === sale.itemId; });
    if (!prod) {
        try {
            var pd = await db.collection('items').doc(sale.itemId).get();
            if (!pd.exists) return alert('المنتج غير موجود');
            prod = { id: pd.id, ...pd.data() };
        } catch (err) {
            return alert('تعذر جلب بيانات المنتج');
        }
    }
    // restore quantity using batch-aware transaction when possible
    try {
        if (sale.purchaseBatchAllocations && Array.isArray(sale.purchaseBatchAllocations) && sale.purchaseBatchAllocations.length) {
            var res = await restoreBatchAllocationsTransaction(prod.id, sale.purchaseBatchAllocations);
            prod.purchaseBatches = res.purchaseBatches;
            prod.quantity = res.quantity;
        } else {
            var newQty = await updateItemQuantityTransaction(prod.id, sale.quantity);
            prod.quantity = newQty;
        }
    } catch (err) {
        return alert('فشل استرجاع الكمية: ' + (err && err.message ? err.message : 'خطأ غير معروف'));
    }
    await db.collection('sales').doc(saleId).delete();
    await db.collection('stats').doc('totals').set({
        allTimeProfit: firebase.firestore.FieldValue.increment(-(sale.profit || 0)),
        updatedAt: Date.now()
    }, { merge: true });
    window._cachedStats.allTimeProfit = (window._cachedStats.allTimeProfit || 0) - (sale.profit || 0);
    await logActivity('delete', 'sale', saleId, 'إلغاء بيع: ' + sale.itemName + '، الكمية: ' + sale.quantity + '، الربح: ' + fmt(sale.profit || 0), { itemId: sale.itemId, itemName: sale.itemName, quantity: sale.quantity, profit: sale.profit });
    commitItemUpdate(prod);
    removeSaleLocally(saleId);
    if (document.getElementById('itemsList')) renderInventory();
    showToast('تم إلغاء البيع');
    await reloadSalesLog();
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
        return name + ': <span class="comparison-diff-neutral">' + formatMoney(0) + '</span>';
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
    var currentDate = new Date();
    var year = currentDate.getFullYear();
    var currentMonthIndex = currentDate.getMonth();
    // determine last month in the year that has any sales; if none, fall back to current month
    var maxMonthWithOps = -1;
    allSales.forEach(function(s) {
        var d = new Date(s.timestamp);
        if (d.getFullYear() === year) {
            maxMonthWithOps = Math.max(maxMonthWithOps, d.getMonth());
        }
    });
    var lastMonthIndex = maxMonthWithOps >= 0 ? maxMonthWithOps : currentMonthIndex;
    var monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    var months = [];
    for (var i = lastMonthIndex; i >= 0; i--) {
        var start = new Date(year, i, 1).getTime();
        var end = new Date(year, i + 1, 1).getTime();
        var monthSales = allSales.filter(function(s) { return s.timestamp >= start && s.timestamp < end; });
        var revenue = monthSales.reduce(function(acc, x) { return acc + (x.totalAmount || 0); }, 0);
        var salesCount = monthSales.length;
        var expenses = getExpensesSum(start, end);
        var profit = monthSales.reduce(function(acc, x) { return acc + (x.profit || 0); }, 0);
        var netProfit = profit - expenses;
        var profitMargin = revenue !== 0 ? netProfit / revenue * 100 : 0;
        months.push({
            index: i,
            label: monthNames[i],
            salesCount: salesCount,
            revenue: revenue,
            expenses: expenses,
            netProfit: netProfit,
            margin: profitMargin,
            hasData: salesCount > 0 || revenue !== 0 || expenses !== 0 || netProfit !== 0
        });
    }
    // Do not trim leading months — show all months from January up to lastMonthIndex.
    var rows = '';
    months.forEach(function(month, idx) {
        var rowClass = month.index === currentMonthIndex ? ' class="comparison-last-month"' : '';
        // previous month chronologically is the next item in the array (since array is current->older)
        var prev = (idx + 1) < months.length ? months[idx + 1] : null;
        var diffText = '--';
        if (prev) {
            // treat missing data in prev as zero values — compute diffs regardless of prev.hasData
            var prevObj = { revenue: prev.revenue || 0, netProfit: prev.netProfit || 0 };
            diffText = getComparisonRowDiff({ revenue: month.revenue, netProfit: month.netProfit }, prevObj);
        }
        rows += '<tr' + rowClass + '>' +
            '<td>' + month.label + '</td>' +
            '<td>' + month.salesCount + '</td>' +
            '<td>' + formatMoney(month.revenue) + '</td>' +
            '<td>' + formatMoney(month.expenses) + '</td>' +
            '<td>' + formatMoney(month.netProfit) + '</td>' +
            '<td>' + fmt(month.margin) + '%</td>' +
            '<td style="white-space:normal;text-align:left;">' + diffText + '</td>' +
            '</tr>';
    });
    if (comparisonManualRows) {
        var firstDiff = '--';
        var secondDiff = getComparisonDiffText(comparisonManualRows.second.revenue - comparisonManualRows.first.revenue,
            comparisonManualRows.second.netProfit - comparisonManualRows.first.netProfit);
        rows += '<tr class="comparison-manual-separator"><td colspan="7">المقارنة اليدوية</td></tr>';
        rows += '<tr class="comparison-manual-row"><td>الفترة الأولى</td><td>' + comparisonManualRows.first.count + '</td><td>' + formatMoney(comparisonManualRows.first.revenue) + '</td><td>' + formatMoney(comparisonManualRows.first.expenses) + '</td><td>' + formatMoney(comparisonManualRows.first.netProfit) + '</td><td>' + fmt(comparisonManualRows.first.margin) + '%</td><td style="white-space:normal;text-align:left;">' + firstDiff + '</td></tr>';
        rows += '<tr class="comparison-manual-row"><td>الفترة الثانية</td><td>' + comparisonManualRows.second.count + '</td><td>' + formatMoney(comparisonManualRows.second.revenue) + '</td><td>' + formatMoney(comparisonManualRows.second.expenses) + '</td><td>' + formatMoney(comparisonManualRows.second.netProfit) + '</td><td>' + fmt(comparisonManualRows.second.margin) + '%</td><td style="white-space:normal;text-align:left;">' + secondDiff + '</td></tr>';
    }
    document.getElementById('comparisonStats').innerHTML =
        '<div class="table-container"><div class="table-header"><h3>مقارنة من بداية السنة حتى الشهر الحالي</h3></div>' +
        '<div class="table-scroll"><table>' +
        '<thead><tr><th>الشهر</th><th>عدد المبيعات</th><th>قيمة المبيعات</th><th>المصاريف</th><th>صافي الربح</th><th>نسبة الربح</th><th>الفرق عن الشهر السابق</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div></div>';
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
    var currentDate = new Date(now);
    var year = currentDate.getFullYear();
    var month = currentDate.getMonth();
    // Current month: 1st to today
    var monthStart = new Date(year, month, 1).getTime();
    var monthEnd = now;
    var todaySales = allSales.filter(function(s) { return s.timestamp >= ds; });
    var monthSales = allSales.filter(function(s) { return s.timestamp >= monthStart && s.timestamp < monthEnd; });
    var monthProfit = monthSales.reduce(function(a, s) { return a + (s.profit || 0); }, 0);
    var monthExpenses = getExpensesSum(monthStart, monthEnd);
    var monthNetProfit = monthProfit - monthExpenses;
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
    // Previous month: actual month before current (1st to last day)
    var prevMonth = month - 1;
    var prevYear = year;
    if (prevMonth < 0) { prevMonth = 11; prevYear = year - 1; }
    var prevMonthStart = new Date(prevYear, prevMonth, 1).getTime();
    var prevMonthEnd = new Date(year, month, 1).getTime();
    var prevMonthSales = allSales.filter(function(s) { return s.timestamp >= prevMonthStart && s.timestamp < prevMonthEnd; });
    var prevMonthProfit = prevMonthSales.reduce(function(a, s) { return a + (s.profit || 0); }, 0);
    var prevMonthExpenses = getExpensesSum(prevMonthStart, prevMonthEnd);
    var prevMonthNetProfit = prevMonthProfit - prevMonthExpenses;
    var profitGrowth = prevMonthNetProfit > 0 ? ((monthNetProfit - prevMonthNetProfit) / prevMonthNetProfit * 100) : 0;
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
        '<div class="stat-card"><div class="stat-icon" style="background:var(--gradient-5);"><i class="fas fa-percentage"></i></div><div class="stat-label">نمو الأرباح الشهرية الصافية</div><div class="stat-value ' +
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
    var searchEl = document.getElementById('assignProductSearch');
    var search = searchEl ? searchEl.value.trim() : '';
    var filtered = allItems.filter(function(p) {
        var belongsToSelected = categoryId && p.categoryId === categoryId;
        var unassigned = !p.categoryId;
        if (categoryId) {
            if (!(belongsToSelected || unassigned)) return false;
        } else {
            if (!unassigned) return false;
        }
        if (!search) return true;
        return p.name.includes(search);
    });
    filtered.sort(arabicAlphabeticalComparator);
    if (!filtered.length) { container.innerHTML = 'لا توجد منتجات'; return; }
    var html = '';
    filtered.forEach(function(prod) {
        var checked = categoryId && prod.categoryId === categoryId;
        html += '<div class="product-check"><input type="checkbox" value="' + prod.id + '" id="prod_' + prod.id +
            '" ' + (checked ? 'checked' : '') + '> <label for="prod_' + prod.id + '">' + escHtml(prod.name) +
            '</label></div>';
    });
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
    var cat = allCategories.find(function(c) { return c.id === catId; });
    if (!cat) return;
    var currentCategoryItems = allItems.filter(function(i) { return i.categoryId === catId; });
    if (!productIds.length && !currentCategoryItems.length) return alert('اختر منتجات');
    var batch = db.batch();
    var updated = 0;
    currentCategoryItems.forEach(function(p) {
        if (productIds.indexOf(p.id) === -1) {
            p.categoryId = null;
            p.categoryName = '';
            batch.update(db.collection('items').doc(p.id), { categoryId: null, categoryName: '' });
            updated++;
        }
    });
    for (var pi = 0; pi < productIds.length; pi++) {
        var pid = productIds[pi];
        var p = allItems.find(function(i) { return i.id === pid; });
        if (p && p.categoryId !== catId) {
            p.categoryId = catId;
            p.categoryName = cat.name;
            batch.update(db.collection('items').doc(pid), { categoryId: catId, categoryName: cat.name });
            updated++;
        }
    }
    if (!updated) return alert('لم يتم تغيير أي منتج');
    await batch.commit();
    await logActivity('assign', 'item', null, 'تعيين منتجات للفئة: ' + cat.name, { categoryId: catId, categoryName: cat.name, products: productIds });
    showToast('تم التعيين');
    renderProductsChecklistForCategory(catId);
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

var _enablePurchaseBatchesCheckbox = document.getElementById('enablePurchaseBatches');
if (_enablePurchaseBatchesCheckbox) {
    _enablePurchaseBatchesCheckbox.addEventListener('change', function() {
        currencySettings.enablePurchaseBatches = this.checked;
        updatePurchaseBatchesVisibility();
    });
}

document.getElementById('currencySettingsForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var previousCurrency = JSON.parse(JSON.stringify(currencySettings));
    var ns = { secondaryCurrencyName: document.getElementById('secondaryCurrencyName').value.trim(),
        secondaryCurrencySymbol: document.getElementById('secondaryCurrencySymbol').value.trim(),
        exchangeRate: parseFloat(document.getElementById('exchangeRate').value),
        defaultInputCurrency: document.querySelector('input[name="defaultInputCurrency"]:checked').value,
        defaultSellCurrency: document.querySelector('input[name="defaultSellCurrency"]:checked').value };
    var enablePurchaseBatchesCheckbox = document.getElementById('enablePurchaseBatches');
    ns.enablePurchaseBatches = enablePurchaseBatchesCheckbox ? enablePurchaseBatchesCheckbox.checked : false;
    if (!ns.secondaryCurrencyName || !ns.secondaryCurrencySymbol || isNaN(ns.exchangeRate) || ns.exchangeRate <=
        0) return alert('بيانات غير صالحة');
    await db.collection('currencySettings').doc('settings').set(ns);
    var change = buildCurrencyChangeDetails(previousCurrency, ns);
    await logActivity('currencyUpdate', 'currencySettings', 'settings', change.details || 'تحديث إعدادات العملة', change.metadata);
    currencySettings = ns;
    tempPurchaseCurrency = (ns.defaultInputCurrency === 'secondary');
    tempSaleCurrency = (ns.defaultInputCurrency === 'secondary');
    tempSellCurrency = (ns.defaultSellCurrency === 'secondary');
    updatePurchaseBatchesVisibility();
    updatePriceLabels();
    showToast('تم حفظ الإعدادات');
});
document.getElementById('cancelCurrencySettingsBtn').addEventListener('click', function() {
    document.getElementById('secondaryCurrencyName').value = currencySettings.secondaryCurrencyName;
    document.getElementById('secondaryCurrencySymbol').value = currencySettings.secondaryCurrencySymbol;
    document.getElementById('exchangeRate').value = currencySettings.exchangeRate;
    var enableBatches = document.getElementById('enablePurchaseBatches');
    if (enableBatches) enableBatches.checked = !!currencySettings.enablePurchaseBatches;
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
                '') + (item.startDate ? '<span class="meta-tag"><i class="fas fa-calendar"></i> ' + fmtDate(item.startDate) + '</span>' : '') + (item.endDate ?
                '<span class="meta-tag"><i class="fas fa-calendar-check"></i> ' + fmtDate(item.endDate) + '</span>' : '') + '</div></div>' +
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
var _darkToggle = document.getElementById('darkToggle'); if (_darkToggle) _darkToggle.addEventListener('click', function() { darkMode = !darkMode; applyDarkMode(); destroyAllCharts(); renderCurrentSection(); });
var _currencyToggleBtn = document.getElementById('currencyToggleBtn'); if (_currencyToggleBtn) _currencyToggleBtn.addEventListener('click', function() { displaySecondaryCurrency = !displaySecondaryCurrency; localStorage.setItem('xmetalDisplaySecondary', displaySecondaryCurrency); var label = document.getElementById('currencyLabel'); if (label) label.textContent = displaySecondaryCurrency ? currencySettings.secondaryCurrencySymbol : '$'; destroyAllCharts(); renderCurrentSection(); });
var _targetSalesBtn = document.getElementById('targetSalesBtn'); if (_targetSalesBtn) _targetSalesBtn.addEventListener('click', function() { var input = document.getElementById('targetSalesInput'); if (input) input.value = salesTarget; var modal = document.getElementById('targetModal'); if (modal) modal.classList.add('show'); });
var _saveTargetBtn = document.getElementById('saveTargetBtn'); if (_saveTargetBtn) _saveTargetBtn.addEventListener('click', async function() { salesTarget = parseFloat(document.getElementById('targetSalesInput').value) || 0; localStorage.setItem('xmetalSalesTarget', salesTarget); await logActivity('targetUpdate', 'target', 'daily', 'تحديث هدف المبيعات اليومي: ' + salesTarget, { target: salesTarget }); closeModalById('targetModal'); showToast('تم حفظ الهدف'); });


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
    if (sp.minQty !== '') filtered = filtered.filter(function(s) { return (s.quantity || 0) >= parseFloat(sp.minQty); });
    if (sp.maxQty !== '') filtered = filtered.filter(function(s) { return (s.quantity || 0) <= parseFloat(sp.maxQty); });
    if (sp.minProfitPct !== '' || sp.maxProfitPct !== '') {
        filtered = filtered.filter(function(s) { var cost = (s.purchasePriceAtTime || 0) * (s.quantity || 0); var pct = cost > 0 ? ((s.profit || 0) / cost *
                100) : 0; if (sp.minProfitPct !== '' && pct < parseFloat(sp.minProfitPct)) return false; if (sp
                .maxProfitPct !== '' && pct > parseFloat(sp.maxProfitPct)) return false; return true; });
    }
    return filtered;
}

var csvExportColumns = [
    {
        id: 'productName',
        label: 'اسم المنتج',
        getter: function(item) { return item.name || ''; }
    },
    {
        id: 'purchasePrice',
        label: 'سعر الشراء',
        getter: function(item) { return '$' + fmtMoney(item.purchasePrice || 0); }
    },
    {
        id: 'salePrice',
        label: 'سعر المبيع',
        getter: function(item) { return '$' + fmtMoney(item.salePrice || 0); }
    },
    {
        id: 'secondarySalePrice',
        label: 'سعر المبيع بالعملة الثانوية',
        getter: function(item) { return fmtMoney(convertToSecondary(item.salePrice || 0)) + ' ' + currencySettings.secondaryCurrencySymbol; }
    },
    {
        id: 'quantity',
        label: 'الكمية',
        getter: function(item) { return item.quantity || 0; }
    }
];

function getInventoryExportItems() {
    var term = document.getElementById('searchItemsInput') ? document.getElementById('searchItemsInput').value : '';
    return filterAndSortProducts(term, currentInventoryFilter);
}

function getSelectedCsvColumns() {
    return Array.from(document.querySelectorAll('#csvExportModal input[data-export-col]:checked')).map(function(input) {
        return input.dataset.exportCol;
    });
}

function getCsvColumnDefinitions(selectedIds) {
    return csvExportColumns.filter(function(col) {
        return selectedIds.includes(col.id);
    });
}

function getExportGroupKey(item) {
    var name = String(item.name || '').trim();
    return name.charAt(0) || '';
}

function buildGroupedExportRows(items, columns) {
    var rows = [];
    var currentGroup = null;
    items.forEach(function(item) {
        var groupKey = getExportGroupKey(item);
        if (groupKey !== currentGroup) {
            currentGroup = groupKey;
            var groupRow = new Array(columns.length).fill('');
            groupRow[0] = groupKey;
            rows.push({ type: 'group', values: groupRow });
        }
        rows.push({ type: 'item', values: columns.map(function(col) {
            var value = col.getter(item);
            return String(value === undefined || value === null ? '' : value);
        }) });
    });
    return rows;
}

function createCsvCell(value) {
    var text = String(value === undefined || value === null ? '' : value);
    return '"' + text.replace(/"/g, '""') + '"';
}

function renderCsvPreview() {
    var selectedIds = getSelectedCsvColumns();
    var columns = getCsvColumnDefinitions(selectedIds);
    var table = document.getElementById('csvPreviewTable');
    var countLabel = document.getElementById('csvPreviewCount');
    var items = getInventoryExportItems();
    if (!table || !countLabel) return;
    var thead = table.querySelector('thead');
    var tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;
    if (!columns.length) {
        thead.innerHTML = '<tr><th style="text-align:right;padding:12px;">لا توجد أعمدة مختارة</th></tr>';
        tbody.innerHTML = '<tr><td style="text-align:right;padding:12px;color:var(--text3);">الرجاء تحديد عمود واحد على الأقل لعرض المعاينة.</td></tr>';
        countLabel.textContent = '0 منتج';
        return;
    }
    thead.innerHTML = '<tr>' + columns.map(function(col) {
        return '<th style="padding:10px 12px;text-align:right;border-bottom:1px solid var(--border);">' + escHtml(col.label) + '</th>';
    }).join('') + '</tr>';
    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="' + columns.length + '" style="text-align:right;padding:14px;color:var(--text3);">لا توجد منتجات لعرض المعاينة.</td></tr>';
        countLabel.textContent = '0 منتج';
        return;
    }
    var rows = buildGroupedExportRows(items, columns);
    tbody.innerHTML = rows.map(function(row) {
        if (row.type === 'group') {
            return '<tr style="background:rgba(59,130,246,.08);font-weight:700;"><td colspan="' + columns.length + '" style="padding:10px 12px;text-align:right;border-bottom:1px solid var(--border);">' + escHtml(row.values[0]) + '</td></tr>';
        }
        return '<tr>' + row.values.map(function(value) {
            return '<td style="padding:10px 12px;text-align:right;border-bottom:1px solid var(--border);">' + escHtml(value) + '</td>';
        }).join('') + '</tr>';
    }).join('');
    countLabel.textContent = items.length + ' منتج';
}

function exportToXLSX(selectedColumns) {
    var selectedIds = Array.isArray(selectedColumns) && selectedColumns.length ? selectedColumns : getSelectedCsvColumns();
    var columns = getCsvColumnDefinitions(selectedIds);
    if (!columns.length) {
        showToast('❌ الرجاء اختيار عمود واحد على الأقل', 'error');
        return;
    }
    var items = getInventoryExportItems();
    var rows = [columns.map(function(col) {
        return String(col.label || '');
    })];
    var grouped = buildGroupedExportRows(items, columns);
    grouped.forEach(function(row) {
        rows.push(row.values);
    });
    var ws = XLSX.utils.aoa_to_sheet(rows);
    if (ws) {
        rows.forEach(function(_row, r) {
            columns.forEach(function(_col, c) {
                var addr = XLSX.utils.encode_cell({ r: r, c: c });
                var cell = ws[addr];
                if (cell) {
                    cell.s = cell.s || {};
                    cell.s.alignment = { horizontal: 'right' };
                }
            });
        });
        // Apply group row styling after worksheet creation
        var currentRow = 1; // 1-based row index in worksheet address encoding
        grouped.forEach(function(row) {
            if (row.type === 'group') {
                for (var c = 0; c < columns.length; c++) {
                    var addr = XLSX.utils.encode_cell({ r: currentRow, c: c });
                    var cell = ws[addr];
                    if (cell) {
                        cell.s = cell.s || {};
                        cell.s.font = Object.assign({}, cell.s.font, { bold: true, sz: 12 });
                        cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'EBF8FF' } };
                    }
                }
            }
            currentRow += 1;
        });
    }
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    var wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
    var blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'xmetal_inventory_' + new Date().toISOString().split('T')[0] + '.xlsx';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('✅ تم تصدير ملف Excel بنجاح');
}

function showPdfExportModal() {
    document.getElementById('pdfExportModal').classList.add('show');
    document.getElementById('productExportOptions').style.display = document.querySelector('input[name="pdfExportType"]:checked').value === 'products' ? 'block' : 'none';
}

function closePdfExportModal() {
    document.getElementById('pdfExportModal').classList.remove('show');
}

function showCsvExportModal() {
    document.getElementById('csvExportModal').classList.add('show');
    renderCsvPreview();
}

function closeCsvExportModal() {
    document.getElementById('csvExportModal').classList.remove('show');
}

function createPdfDoc() {
    var doc = new jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    registerCairoPdfFont(doc);
    if (typeof doc.setR2L === 'function') doc.setR2L(true);
    doc.setFont('Cairo');
    return doc;
}

function buildPdfExportContainer(titleText, descriptionText, headers, rows) {
    var container = document.createElement('div');
    container.className = 'pdf-export-container';
    container.style.direction = 'rtl';
    container.style.fontFamily = "'Cairo', sans-serif";
    container.style.padding = '16px';
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '1180px';
    container.style.backgroundColor = '#ffffff';
    container.style.color = '#000000';
    container.style.opacity = '0';
    container.style.transform = 'translateX(-9999px)';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '999999';
    var title = document.createElement('h2');
    title.textContent = titleText;
    title.style.textAlign = 'right';
    title.style.margin = '0 0 8px';
    container.appendChild(title);
    var info = document.createElement('div');
    info.textContent = descriptionText;
    info.style.textAlign = 'right';
    info.style.marginBottom = '12px';
    container.appendChild(info);
    var table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = '12px';
    table.className = 'pdf-export-table';
    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    headers.forEach(function(h) {
        var th = document.createElement('th');
        th.textContent = h;
        th.style.border = '1px solid #ddd';
        th.style.padding = '8px';
        th.style.background = '#2b6fb0';
        th.style.color = '#fff';
        th.style.textAlign = 'center';
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    rows.forEach(function(row) {
        var tr = document.createElement('tr');
        row.forEach(function(cell) {
            var td = document.createElement('td');
            td.textContent = cell;
            td.style.border = '1px solid #eee';
            td.style.padding = '8px';
            td.style.textAlign = 'center';
            td.style.whiteSpace = 'normal';
            td.style.wordBreak = 'break-word';
            td.style.overflowWrap = 'anywhere';
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    var style = document.createElement('style');
    style.textContent = '\n        .pdf-export-table { border-collapse: collapse; width: 100%; }\n        .pdf-export-table th, .pdf-export-table td { word-break: break-word; white-space: normal; }\n        .pdf-export-container { font-family: Cairo, sans-serif; }\n    ';
    container.appendChild(style);
    container.appendChild(table);
    document.body.appendChild(container);
    return container;
}

function exportSalesReportPDF() {
    if (!window.html2pdf) {
        showToast('❌ مكتبة html2pdf غير متاحة');
        return;
    }
    var filtered = applySalesFiltersClient();
    var rows = filtered.map(function(s, i) {
        return [
            i + 1,
            fmtDateTime(s.timestamp),
            s.itemName || '',
            s.quantity || 0,
            formatMoneyPlain(s.unitPrice || 0),
            formatMoneyPlain(s.totalAmount || 0),
            formatMoneyPlain(s.profit || 0)
        ];
    });
    var headers = ['#', 'التاريخ', 'المنتج', 'الكمية', 'سعر الوحدة', 'الإجمالي', 'الربح'];
    var container = buildPdfExportContainer(
        'تقرير مبيعات X METAL',
        'تاريخ التصدير: ' + fmtDateTime(Date.now()) + ' | عدد العمليات: ' + filtered.length,
        headers,
        rows
    );
    var filename = 'xmetal_sales_report_' + new Date().toISOString().split('T')[0] + '.pdf';
    var exportOptions = {
        filename: filename,
        html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['css', 'legacy'] }
    };
    function runExport() {
        html2pdf().from(container).set(exportOptions).save().then(function() {
            showToast('✅ تم تنزيل PDF');
            container.remove();
        }).catch(function(err) {
            console.error(err);
            showToast('❌ حدث خطأ أثناء إنشاء PDF');
            container.remove();
        });
    }
    if (document.fonts && typeof document.fonts.ready !== 'undefined') {
        document.fonts.ready.then(function() {
            setTimeout(runExport, 250);
        }).catch(function() {
            setTimeout(runExport, 250);
        });
    } else {
        setTimeout(runExport, 250);
    }
}

function exportProductsPDF() {
    if (!window.html2pdf) {
        showToast('❌ مكتبة html2pdf غير متاحة');
        return;
    }
    var selectedScope = document.querySelector('input[name="productExportScope"]:checked').value;
    var selectedFields = Array.from(document.querySelectorAll('#pdfExportModal input[data-export-field]:checked')).map(function(input) {
        return input.getAttribute('data-export-field');
    });
    if (!selectedFields.length) {
        showToast('⚠️ اختر حقلًا واحدًا على الأقل للتصدير');
        return;
    }
    var items = allItems.slice();
    if (selectedScope === 'available') {
        items = items.filter(function(i) { return Number(i.quantity) > 0; });
    }
    if (!items.length) {
        showToast('⚠️ لا توجد منتجات مطابقة للتصدير');
        return;
    }
    var headers = ['#', 'اسم المنتج'];
    if (selectedFields.includes('categoryName')) headers.push('الفئة');
    if (selectedFields.includes('purchasePrice')) headers.push('سعر الشراء');
    if (selectedFields.includes('salePrice')) headers.push('سعر البيع');
    if (selectedFields.includes('quantity')) headers.push('الكمية');
    if (selectedFields.includes('profitMargin')) headers.push('نسبة الربح');
    if (selectedFields.includes('secondaryPrice')) headers.push('السعر بالعملة الثانوية');
    var rows = items.map(function(item, index) {
        var row = [index + 1, item.name || ''];
        if (selectedFields.includes('categoryName')) row.push(item.categoryName || '');
        if (selectedFields.includes('purchasePrice')) row.push('$' + fmtMoney(item.purchasePrice));
        if (selectedFields.includes('salePrice')) row.push('$' + fmtMoney(item.salePrice));
        if (selectedFields.includes('quantity')) row.push(item.quantity || 0);
        if (selectedFields.includes('profitMargin')) row.push(calcProfitMarginPct(item.purchasePrice, item.salePrice) + '%');
        if (selectedFields.includes('secondaryPrice')) row.push(fmtMoney(convertToSecondary(item.salePrice)) + ' ' + currencySettings.secondaryCurrencySymbol);
        return row;
    });
    var container = buildPdfExportContainer(
        'تقرير المنتجات',
        'نطاق التصدير: ' + (selectedScope === 'available' ? 'المنتجات المتوفرة فقط' : 'كل المنتجات'),
        headers,
        rows
    );
    var filename = 'xmetal_products_' + new Date().toISOString().split('T')[0] + '.pdf';
    var exportOptions = {
        filename: filename,
        html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['css', 'legacy'] }
    };
    function runExport() {
        html2pdf().from(container).set(exportOptions).save().then(function() {
            closePdfExportModal();
            showToast('✅ تم تنزيل PDF');
            container.remove();
        }).catch(function(err) {
            console.error(err);
            showToast('❌ حدث خطأ أثناء إنشاء PDF');
            container.remove();
        });
    }
    if (document.fonts && typeof document.fonts.ready !== 'undefined') {
        document.fonts.ready.then(function() {
            setTimeout(runExport, 250);
        }).catch(function() {
            setTimeout(runExport, 250);
        });
    } else {
        setTimeout(runExport, 250);
    }
}

function exportToPDF() {
    exportSalesReportPDF();
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
