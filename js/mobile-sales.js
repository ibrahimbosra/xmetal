/* Mobile-only sales surface. It intentionally renders no cost, profit, capital, or analytics fields. */
(function () {
    'use strict';

    var db = window.firebaseDb;
    var auth = window.firebaseAuth;
    var SOURCE = 'mobile-sales';
    var items = [];
    var sales = [];
    var currency = { secondaryCurrencySymbol: '﷼', exchangeRate: 3.75 };
    var selectedItem = null;
    var editingSale = null;
    var toastTimer = null;
    var inventorySort = localStorage.getItem('xmetalInventorySort') || 'alphabetical';
    var dataLoaded = false;
    var listenersStarted = false;
    var lastSyncAt = 0;
    var productElements = new Map();
    var CACHE_KEY = 'xmetalMobileSalesCacheV1';
    var installPrompt = null;
    var historyVisibleCount = 25;
    var unusualPriceApproved = false;
    var salePriceManuallyEdited = false;
    var saleDefaultPrice = null;

    var $ = function (id) { return document.getElementById(id); };
    var esc = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
    var number = function (value) { var n = Number(value); return Number.isFinite(n) ? n : null; };
    var secondary = function (primary) { return (Number(primary) || 0) * (Number(currency.exchangeRate) || 1); };
    var primary = function (secondaryValue) { return (Number(secondaryValue) || 0) / (Number(currency.exchangeRate) || 1); };
    var money = function (value) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value) || 0); };
    function timestampValue(timestamp) {
        if (timestamp && typeof timestamp.toMillis === 'function') return timestamp.toMillis();
        if (timestamp && Number.isFinite(Number(timestamp.seconds))) return Number(timestamp.seconds) * 1000 + (Number(timestamp.nanoseconds) || 0) / 1000000;
        if (timestamp instanceof Date) return timestamp.getTime();
        var numeric = Number(timestamp);
        if (Number.isFinite(numeric) && numeric > 0) return numeric;
        var parsed = Date.parse(timestamp);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    var date = function (timestamp) { return new Intl.DateTimeFormat('ar-SA-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestampValue(timestamp) || Date.now())); };
    var dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    function dayKey(timestamp) { var d = new Date(timestampValue(timestamp) || Date.now()); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
    function dayLabel(timestamp) { var d = new Date(timestampValue(timestamp) || Date.now()); return dayNames[d.getDay()] + ' ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); }
    var showError = function (id, message) { $(id).textContent = message || ''; };

    function notify(message) {
        var el = $('toast'); el.textContent = message; el.classList.add('show');
        clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
    }

    function updateCustomScrollbar() {
        var track = $('customScrollbar'), thumb = $('customScrollbarThumb');
        if (!track || !thumb) return;
        var viewportHeight = window.innerHeight, documentHeight = document.documentElement.scrollHeight, maxScroll = Math.max(0, documentHeight - viewportHeight);
        if (maxScroll <= 0) { track.hidden = true; return; }
        track.hidden = false;
        var trackHeight = track.clientHeight, thumbHeight = Math.max(58, trackHeight * viewportHeight / documentHeight), maxThumbTop = Math.max(0, trackHeight - thumbHeight);
        thumb.style.height = thumbHeight + 'px';
        thumb.style.transform = 'translateY(' + (maxThumbTop * window.scrollY / maxScroll) + 'px)';
        track.setAttribute('aria-valuenow', String(Math.round(window.scrollY / maxScroll * 100)));
    }

    function setupCustomScrollbar() {
        var track = $('customScrollbar'), thumb = $('customScrollbarThumb');
        if (!track || !thumb) return;
        var dragging = false, startY = 0, startTop = 0;
        thumb.addEventListener('pointerdown', function (event) {
            dragging = true; startY = event.clientY; startTop = thumb.getBoundingClientRect().top - track.getBoundingClientRect().top;
            thumb.setPointerCapture(event.pointerId); event.preventDefault();
        });
        thumb.addEventListener('pointermove', function (event) {
            if (!dragging) return;
            var trackHeight = track.clientHeight, thumbHeight = thumb.offsetHeight, maxThumbTop = Math.max(0, trackHeight - thumbHeight), nextTop = Math.max(0, Math.min(maxThumbTop, startTop + event.clientY - startY));
            var maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
            window.scrollTo(0, maxThumbTop ? nextTop / maxThumbTop * maxScroll : 0);
        });
        thumb.addEventListener('pointerup', function () { dragging = false; });
        thumb.addEventListener('pointercancel', function () { dragging = false; });
        track.addEventListener('pointerdown', function (event) {
            if (event.target === thumb) return;
            var rect = track.getBoundingClientRect(), target = Math.max(0, Math.min(track.clientHeight, event.clientY - rect.top)), maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
            window.scrollTo({ top: target / track.clientHeight * maxScroll, behavior: 'smooth' });
        });
    }

    function saveCache() {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ items: items, sales: sales, currency: currency, scrollY: window.scrollY, savedAt: Date.now() }));
        } catch (error) { /* Cache is an optimization; the live listener remains authoritative. */ }
    }

    function restoreCache() {
        try {
            var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
            if (!cached) return false;
            if (Array.isArray(cached.items)) items = cached.items;
            if (Array.isArray(cached.sales)) sales = uniqueSales(cached.sales);
            if (cached.currency) currency = Object.assign(currency, cached.currency);
            var savedScroll = Number(localStorage.getItem(CACHE_KEY + ':scrollY'));
            if (!Number.isFinite(savedScroll)) savedScroll = cached.scrollY;
            if (Number.isFinite(savedScroll)) setTimeout(function () { window.scrollTo(0, savedScroll); }, 0);
            return items.length > 0 || sales.length > 0;
        } catch (error) { return false; }
    }

    function openModal(id) { $(id).hidden = false; document.body.style.overflow = 'hidden'; }
    function closeModal(id) { $(id).hidden = true; if ($('saleModal').hidden && $('historyModal').hidden) document.body.style.overflow = ''; }

    function mechanicPrice(item) {
        var value = number(item.mechanicPrice);
        return value !== null && value >= 0 ? value : (number(item.salePrice) || 0);
    }

    function compareArabic(a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'ar', { sensitivity: 'variant', usage: 'sort' });
    }

    function compareInventoryItems(a, b) {
        if (inventorySort === 'purchase') return (number(b.purchasePrice) || 0) - (number(a.purchasePrice) || 0) || compareArabic(a, b);
        if (inventorySort === 'sale') return (number(b.salePrice) || 0) - (number(a.salePrice) || 0) || compareArabic(a, b);
        if (inventorySort === 'quantity') return (number(b.quantity) || 0) - (number(a.quantity) || 0) || compareArabic(a, b);
        return compareArabic(a, b);
    }

    function filterAndSortProducts(term) {
        var searchTerm = String(term || '').trim();
        var available = items.filter(function (item) { return (number(item.quantity) || 0) > 0; });
        if (!searchTerm) return available.sort(compareInventoryItems);
        var filtered = available.filter(function (item) { return String(item.name || '').includes(searchTerm); });
        filtered.forEach(function (item) {
            item._searchPriority = 3;
            if (String(item.name || '').startsWith(searchTerm)) item._searchPriority = 1;
            else if (String(item.name || '').split(/\s+/).some(function (word) { return word.startsWith(searchTerm); })) item._searchPriority = 2;
        });
        filtered.sort(function (a, b) { return a._searchPriority - b._searchPriority || compareInventoryItems(a, b); });
        filtered.forEach(function (item) { delete item._searchPriority; });
        return filtered;
    }

    function renderProducts() {
        var visible = filterAndSortProducts($('productSearch').value);
        $('productCount').textContent = visible.length + ' منتج';
        $('productsEmpty').hidden = visible.length !== 0;
        var visibleIds = new Set(visible.map(function (item) { return item.id; }));
        productElements.forEach(function (element, id) { if (!visibleIds.has(id)) element.remove(); });
        visible.forEach(function (item) {
            var stock = number(item.quantity) || 0, signature = JSON.stringify([item.name, stock, item.salePrice, mechanicPrice(item), currency.secondaryCurrencySymbol, currency.exchangeRate]);
            var element = productElements.get(item.id);
            if (!element) { element = document.createElement('article'); element.className = 'product-card'; element.dataset.productId = item.id; productElements.set(item.id, element); }
            if (element.dataset.signature !== signature) {
                element.dataset.signature = signature;
                element.innerHTML =
                '<h2 class="product-name">' + esc(item.name || 'منتج') + '</h2>' +
                '<p class="stock">المتوفر: <strong>' + money(stock) + '</strong></p>' +
                '<div class="prices">' +
                '<button class="price-line price-action base-price" type="button" data-sell-item="' + esc(item.id) + '" data-sell-price="' + esc(item.salePrice) + '" data-sell-mode="base" ' + (stock <= 0 ? 'disabled' : '') + '><span>مبيع</span><strong>' + money(secondary(item.salePrice)) + ' ' + esc(currency.secondaryCurrencySymbol) + '</strong></button>' +
                '<button class="price-line price-action mechanic-price" type="button" data-sell-item="' + esc(item.id) + '" data-sell-price="' + esc(mechanicPrice(item)) + '" data-sell-mode="mechanic" ' + (stock <= 0 ? 'disabled' : '') + '><span>جملة</span><strong>' + money(secondary(mechanicPrice(item))) + ' ' + esc(currency.secondaryCurrencySymbol) + '</strong></button>' +
                '</div>';
            }
            $('productsGrid').appendChild(element);
        });
    }

    function scrollToProductsTop() {
        var grid = $('productsGrid');
        if (!grid) return;
        grid.scrollTop = 0;
        requestAnimationFrame(function () {
            var toolbar = document.querySelector('.toolbar');
            var toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : 0;
            var gridTop = window.scrollY + grid.getBoundingClientRect().top;
            window.scrollTo({ top: Math.max(0, gridTop - toolbarHeight - 8), behavior: 'smooth' });
        });
    }

    function resetSaleForm() {
        $('saleForm').reset(); $('saleError').textContent = ''; $('priceWarning').hidden = true; unusualPriceApproved = false; salePriceManuallyEdited = false;
        $('saleQuantity').value = 1;
        updateSalePriceGuide();
    }

    function updateQuickQuantityState() {
        var quantity = number($('saleQuantity').value);
        document.querySelectorAll('[data-quick-quantity]').forEach(function (button) {
            button.classList.toggle('selected', quantity !== null && quantity === Number(button.dataset.quickQuantity));
        });
    }

    function updateAvailableStock(item) {
        var available = item ? number(item.quantity) : null;
        $('availableStock').textContent = available === null ? '' : 'المتوفر في المخزون: ' + money(available);
    }

    function updateQuantityWarning() {
        var quantity = number($('saleQuantity').value);
        var available = selectedItem ? number(selectedItem.quantity) : null;
        if (editingSale && available !== null) available += number(editingSale.quantity) || 0;
        var warning = $('quantityWarning');
        if (!warning || quantity === null || available === null || quantity <= available) {
            if (warning) { warning.hidden = true; warning.textContent = ''; }
            return;
        }
        warning.textContent = 'الكمية المطلوبة أكبر من المتوفر في المخزون (' + money(available) + ').';
        warning.hidden = false;
    }

    function updateSalePriceGuide(forceAutomatic) {
        var quantity = number($('saleQuantity').value) || 0;
        if (!salePriceManuallyEdited && (forceAutomatic || !editingSale) && selectedItem && quantity > 0) {
            var defaultPrice = saleDefaultPrice === null ? secondary(selectedItem.salePrice) : saleDefaultPrice;
            $('salePrice').value = Number((defaultPrice * quantity).toFixed(2));
        }
        var total = number($('salePrice').value) || 0;
        var unit = quantity > 0 ? total / quantity : 0;
        $('saleUnitPrice').value = money(unit) + ' ' + currency.secondaryCurrencySymbol;
        $('calculatedTotal').textContent = 'الإجمالي: ' + money(total) + ' ' + currency.secondaryCurrencySymbol;
        updateQuickQuantityState();
        updateQuantityWarning();
    }

    function getPriceWarning(unitPricePrimary, item) {
        var lowReference = mechanicPrice(item), highReference = Number(item.salePrice) || 0;
        if (unitPricePrimary < lowReference && lowReference > 0) {
            var lowPercent = ((lowReference - unitPricePrimary) / lowReference) * 100;
            if (lowPercent > 15) return { level: 'danger', percent: lowPercent, direction: 'أقل', type: 'mechanic', reference: lowReference };
        }
        if (unitPricePrimary > highReference && highReference > 0) {
            var highPercent = ((unitPricePrimary - highReference) / highReference) * 100;
            if (highPercent > 15) return { level: 'warning', percent: highPercent, direction: 'أعلى', type: 'sale', reference: highReference };
        }
        return { level: 'none', percent: 0, type: 'sale', reference: highReference };
    }

    function warningText(info) {
        var referenceName = info.type === 'mechanic' ? 'سعر الجملة' : 'سعر البيع الأساسي';
        return (info.level === 'danger' ? '⚠ ' : 'ⓘ ') + 'سعر القطعة المحسوب ' + info.direction + ' من ' + referenceName + ' بنسبة ' + money(info.percent) + '%.' + ' السعر المرجعي: ' + money(secondary(info.reference)) + ' ' + currency.secondaryCurrencySymbol;
    }

    function upsertSaleLocally(sale) {
        if (!sale || !sale.saleId) return;
        var index = sales.findIndex(function (entry) { return entry.saleId === sale.saleId; });
        if (index === -1) sales.push(sale);
        else sales[index] = Object.assign({}, sales[index], sale);
    }

    function uniqueSales(list) {
        var byId = new Map();
        (Array.isArray(list) ? list : []).forEach(function (sale) { if (sale && sale.saleId) byId.set(sale.saleId, sale); });
        return Array.from(byId.values());
    }

    function sanitizeFirestoreData(value) {
        if (Array.isArray(value)) return value.map(sanitizeFirestoreData);
        if (value && typeof value === 'object') {
            var cleaned = {};
            Object.keys(value).forEach(function (key) {
                if (value[key] !== undefined) cleaned[key] = sanitizeFirestoreData(value[key]);
            });
            return cleaned;
        }
        return value;
    }

    function showPriceWarning(info) {
        var box = $('priceWarning');
        box.classList.toggle('warning', info.level === 'warning'); box.classList.toggle('danger', info.level === 'danger');
        $('priceWarningTitle').textContent = info.level === 'danger' ? '⚠ تنبيه خطر السعر' : 'ⓘ مراجعة السعر';
        $('priceWarningText').textContent = warningText(info);
        $('backFromWarning').hidden = false;
        $('confirmUnusualPrice').textContent = 'متابعة البيع';
        box.hidden = false;
    }

    function openNewSale(item, defaultPricePrimary, mode) {
        selectedItem = item; editingSale = null; var selectedPrice = number(defaultPricePrimary); saleDefaultPrice = secondary(selectedPrice === null ? item.salePrice : selectedPrice); resetSaleForm();
        $('saleModal').classList.toggle('base-price-mode', mode === 'base');
        $('saleModal').classList.toggle('mechanic-price-mode', mode === 'mechanic');
        $('saleModalTitle').textContent = mode === 'mechanic' ? 'بيع منتج وفق سعر الجملة' : 'بيع منتج وفق السعر الأساسي'; $('saleProductName').textContent = item.name || 'منتج';
        updateAvailableStock(item);
        $('saleQuantity').max = item.quantity;
        $('saleCurrencyLabel').textContent = '(' + currency.secondaryCurrencySymbol + ')';
        $('saleForm').querySelector('button[type="submit"]').textContent = 'تأكيد البيع';
        updateSalePriceGuide();
        openModal('saleModal');
    }

    function openEditSale(sale) {
        var item = items.find(function (entry) { return entry.id === sale.itemId; });
        if (!item) return notify('المنتج غير موجود');
        selectedItem = item; editingSale = sale; saleDefaultPrice = null; resetSaleForm();
        $('saleModal').classList.remove('base-price-mode', 'mechanic-price-mode');
        $('saleModalTitle').textContent = 'تعديل البيع'; $('saleProductName').textContent = sale.itemName || item.name || 'منتج';
        updateAvailableStock(item);
        $('saleQuantity').value = sale.quantity; $('saleQuantity').max = (Number(item.quantity) || 0) + (Number(sale.quantity) || 0);
        $('salePrice').value = Number(secondary((Number(sale.unitPrice) || 0) * (Number(sale.quantity) || 0)).toFixed(2));
        salePriceManuallyEdited = true;
        $('saleCurrencyLabel').textContent = '(' + currency.secondaryCurrencySymbol + ')';
        $('saleForm').querySelector('button[type="submit"]').textContent = 'حفظ التعديل';
        updateSalePriceGuide();
        openModal('saleModal');
    }

    function renderHistory() {
        try {
        var ordered = (Array.isArray(sales) ? sales : []).slice().sort(function (a, b) { return timestampValue(b.timestamp) - timestampValue(a.timestamp); });
        var shown = ordered.slice(0, historyVisibleCount), previousDay = null, currentDayTotal = 0, html = '';
        shown.forEach(function (sale, index) {
            var currentDay = dayKey(sale.timestamp);
            if (currentDay !== previousDay) {
                if (previousDay !== null) html += '<div class="day-total">إجمالي مبيعات اليوم: ' + money(currentDayTotal) + ' ' + esc(currency.secondaryCurrencySymbol) + '</div>';
                html += '<div class="history-day"><strong>' + esc(dayLabel(sale.timestamp)) + '</strong></div>';
                previousDay = currentDay;
                currentDayTotal = 0;
            }
            currentDayTotal += secondary((Number(sale.unitPrice) || 0) * (Number(sale.quantity) || 0));
            var warningBadge = sale.priceWarningLevel && sale.priceWarningLevel !== 'none' ? '<button type="button" class="warning-badge ' + esc(sale.priceWarningLevel) + '" data-warning-sale="' + esc(sale.saleId) + '" aria-label="عرض سبب التنبيه">!</button>' : '';
            html += '<article class="sale-record ' + (sale.priceWarningLevel && sale.priceWarningLevel !== 'none' ? 'has-price-warning ' + esc(sale.priceWarningLevel) : '') + '"><div class="sale-number" aria-label="رقم العملية">' + (index + 1) + '</div><h3>' + esc(sale.itemName || 'منتج') + warningBadge + '</h3>' +
                '<div class="sale-meta"><span>' + esc(date(sale.timestamp)) + '</span><span>الكمية: ' + money(sale.quantity) + '</span></div>' +
                '<p class="sale-total">سعر القطعة: <span class="sale-unit-value">' + money(secondary(sale.unitPrice)) + '</span> × الكمية: <span class="sale-quantity-value">' + money(sale.quantity) + '</span> = الإجمالي: <span class="sale-grand-total">' + money(secondary((Number(sale.unitPrice) || 0) * (Number(sale.quantity) || 0))) + ' ' + esc(currency.secondaryCurrencySymbol) + '</span></p>' +
                '<div class="record-actions"><button type="button" data-edit-sale="' + esc(sale.saleId) + '">تعديل الكمية/السعر</button>' +
                '<button type="button" class="cancel-sale" data-cancel-sale="' + esc(sale.saleId) + '">إلغاء البيع</button></div></article>';
        });
        if (previousDay !== null) html += '<div class="day-total">إجمالي مبيعات اليوم: ' + money(currentDayTotal) + ' ' + esc(currency.secondaryCurrencySymbol) + '</div>';
        if (!ordered.length) html = '<div class="empty-state">لا توجد عمليات بيع حتى الآن</div>';
        else if (shown.length < ordered.length) html += '<button class="load-more" id="loadMoreSales" type="button">عرض المزيد</button>';
        $('salesHistory').innerHTML = html;
        } catch (error) {
            console.warn('تعذر عرض سجل المبيعات:', error);
            var historyElement = $('salesHistory');
            if (historyElement) historyElement.innerHTML = '<div class="empty-state">تعذر عرض السجل حاليًا</div>';
        }
    }

    async function updateQuantity(itemId, delta) {
        var ref = db.collection('items').doc(itemId);
        return db.runTransaction(function (tx) { return tx.get(ref).then(function (doc) {
            if (!doc.exists) throw new Error('المنتج غير موجود');
            var current = Number(doc.data().quantity) || 0, next = current + Number(delta);
            if (next < 0) throw new Error('الكمية المتوفرة غير كافية');
            tx.update(ref, { quantity: next, updatedAt: Date.now() }); return next;
        }); });
    }

    function computeAllocations(item, quantity) {
        var left = Number(quantity) || 0, result = [];
        (item.purchaseBatches || []).slice().sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); }).forEach(function (batch) {
            if (left <= 0) return;
            var available = Number(batch.quantity) || 0, take = Math.min(available, left);
            if (take > 0) { result.push({ timestamp: batch.timestamp || null, unitCost: batch.unitCost || 0, quantity: take }); left -= take; }
        });
        return left > 0 ? [] : result;
    }

    async function consumeBatches(itemId, allocations) {
        var ref = db.collection('items').doc(itemId);
        return db.runTransaction(function (tx) { return tx.get(ref).then(function (doc) {
            if (!doc.exists) throw new Error('المنتج غير موجود');
            var data = doc.data(), batches = Array.isArray(data.purchaseBatches) ? data.purchaseBatches.filter(function (batch) { return batch && typeof batch === 'object'; }).slice() : [];
            (Array.isArray(allocations) ? allocations : []).filter(function (allocation) { return allocation && typeof allocation === 'object'; }).forEach(function (allocation) {
                var left = Number(allocation.quantity) || 0;
                batches.forEach(function (batch) {
                    if (left > 0 && allocation.timestamp != null && batch.timestamp === allocation.timestamp) {
                        var take = Math.min(Number(batch.quantity) || 0, left); batch.quantity = (Number(batch.quantity) || 0) - take; left -= take;
                    }
                });
                batches.forEach(function (batch) { if (left > 0) { var take = Math.min(Number(batch.quantity) || 0, left); batch.quantity = (Number(batch.quantity) || 0) - take; left -= take; } });
                if (left > 0) throw new Error('الكمية المتوفرة غير كافية');
            });
            var total = batches.reduce(function (sum, batch) { return sum + (Number(batch.quantity) || 0); }, 0);
            tx.update(ref, { purchaseBatches: batches, quantity: total, updatedAt: Date.now() }); return { purchaseBatches: batches, quantity: total };
        }); });
    }

    async function restoreBatches(itemId, allocations) {
        var ref = db.collection('items').doc(itemId);
        return db.runTransaction(function (tx) { return tx.get(ref).then(function (doc) {
            if (!doc.exists) throw new Error('المنتج غير موجود');
            var data = doc.data(), batches = Array.isArray(data.purchaseBatches) ? data.purchaseBatches.slice() : [];
            allocations.forEach(function (allocation) {
                var found = batches.find(function (batch) { return allocation.timestamp != null && batch.timestamp === allocation.timestamp; });
                if (found) found.quantity = (Number(found.quantity) || 0) + (Number(allocation.quantity) || 0);
                else batches.push({ quantity: Number(allocation.quantity) || 0, unitCost: allocation.unitCost || 0, timestamp: allocation.timestamp || Date.now() });
            });
            var total = batches.reduce(function (sum, batch) { return sum + (Number(batch.quantity) || 0); }, 0);
            tx.update(ref, { purchaseBatches: batches, quantity: total, updatedAt: Date.now() }); return { purchaseBatches: batches, quantity: total };
        }); });
    }

    async function changeStock(item, delta, allocations) {
        if (allocations && allocations.length && item.purchaseBatches && item.purchaseBatches.length) {
            return delta < 0 ? consumeBatches(item.id, allocations) : restoreBatches(item.id, allocations);
        }
        return { quantity: await updateQuantity(item.id, delta) };
    }

    async function submitSale(event) {
        event.preventDefault();
        var qty = number($('saleQuantity').value), enteredPrice = number($('salePrice').value);
        var displayedPrice = enteredPrice === null || !qty ? null : enteredPrice / qty;
        if (!selectedItem || selectedItem.id === undefined || selectedItem.id === null || String(selectedItem.id).trim() === '' || qty === null || qty <= 0 || enteredPrice === null || enteredPrice < 0 || displayedPrice === null || displayedPrice < 0) { showError('saleError', 'تحقق من المنتج والكمية والسعر'); return; }
        var oldQty = editingSale ? Number(editingSale.quantity) || 0 : 0;
        if (qty > (Number(selectedItem.quantity) || 0) + oldQty) { showError('saleError', 'الكمية المتوفرة غير كافية'); return; }
        var warning = getPriceWarning(primary(displayedPrice), selectedItem);
        if (warning.level !== 'none' && !unusualPriceApproved) { showPriceWarning(warning); return; }
        $('priceWarning').hidden = true;
        var button = $('saleForm').querySelector('button[type="submit"]'); button.disabled = true; showError('saleError', '');
        try {
            if (!editingSale) {
                var allocations = selectedItem.purchaseBatches && selectedItem.purchaseBatches.length ? computeAllocations(selectedItem, qty) : null;
                if (selectedItem.purchaseBatches && selectedItem.purchaseBatches.length && !allocations.length) throw new Error('الكمية المتوفرة غير كافية');
                var stockResult = await changeStock(selectedItem, -qty, allocations);
                var cost = Number(selectedItem.purchasePrice) || 0;
                var sale = { itemId: selectedItem.id, itemName: selectedItem.name, quantity: qty, unitPrice: primary(displayedPrice), totalAmount: primary(displayedPrice) * qty, profit: (primary(displayedPrice) - cost) * qty, purchasePriceAtTime: cost, timestamp: Date.now(), saleCurrency: 'secondary', source: SOURCE, priceType: warning.type, priceWarningLevel: warning.level, priceWarningPercent: warning.percent, priceWarningDirection: warning.direction, priceWarningReference: warning.reference };
                if (allocations) sale.purchaseBatchAllocations = allocations;
                var saleRef = await db.collection('sales').add(sanitizeFirestoreData(sale)); sale.saleId = saleRef.id;
                await updateStats(sale.profit);
                await logMobileActivity('sell', sale);
                selectedItem.quantity = stockResult.quantity; selectedItem.purchaseBatches = stockResult.purchaseBatches || selectedItem.purchaseBatches;
                upsertSaleLocally(sale); saveCache(); notify('تم تسجيل البيع بنجاح');
            } else {
                var diff = qty - oldQty, allocations = editingSale.purchaseBatchAllocations ? JSON.parse(JSON.stringify(editingSale.purchaseBatchAllocations)) : [];
                var extraAllocations = null;
                if (diff > 0 && selectedItem.purchaseBatches && selectedItem.purchaseBatches.length) extraAllocations = computeAllocations(selectedItem, diff);
                if (diff > 0 && selectedItem.purchaseBatches && selectedItem.purchaseBatches.length && !extraAllocations.length) throw new Error('الكمية المتوفرة غير كافية');
                if (diff !== 0) {
                    if (diff > 0) {
                        var stockResult2 = await changeStock(selectedItem, -diff, extraAllocations);
                        selectedItem.quantity = stockResult2.quantity; selectedItem.purchaseBatches = stockResult2.purchaseBatches || selectedItem.purchaseBatches;
                        allocations = allocations.concat(extraAllocations);
                    } else if (editingSale.purchaseBatchAllocations && editingSale.purchaseBatchAllocations.length && selectedItem.purchaseBatches && selectedItem.purchaseBatches.length) {
                        var restoreAllocations = [], left = -diff;
                        while (left > 0 && allocations.length) {
                            var last = allocations[allocations.length - 1], take = Math.min(Number(last.quantity) || 0, left);
                            restoreAllocations.push(Object.assign({}, last, { quantity: take })); last.quantity -= take; left -= take;
                            if (last.quantity <= 0) allocations.pop();
                        }
                        if (left > 0) throw new Error('تعذر استعادة كمية البيع');
                        var restored = await restoreBatches(selectedItem.id, restoreAllocations);
                        selectedItem.quantity = restored.quantity; selectedItem.purchaseBatches = restored.purchaseBatches || selectedItem.purchaseBatches;
                    } else {
                        var simpleRestore = await changeStock(selectedItem, -diff, null);
                        selectedItem.quantity = simpleRestore.quantity;
                    }
                }
                var newPrice = primary(displayedPrice), newProfit = (newPrice - (Number(editingSale.purchasePriceAtTime) || 0)) * qty, profitDiff = newProfit - (Number(editingSale.profit) || 0);
                var updated = Object.assign({}, editingSale, { quantity: qty, unitPrice: newPrice, totalAmount: newPrice * qty, profit: newProfit, saleCurrency: 'secondary', purchaseBatchAllocations: allocations, updatedAt: Date.now(), source: SOURCE, priceType: warning.type, priceWarningLevel: warning.level, priceWarningPercent: warning.percent, priceWarningDirection: warning.direction, priceWarningReference: warning.reference });
                await db.collection('sales').doc(editingSale.saleId).set(sanitizeFirestoreData(updated));
                await updateStats(profitDiff); await logMobileActivity('update', updated);
                sales = sales.map(function (entry) { return entry.saleId === updated.saleId ? updated : entry; }); saveCache(); notify('تم تعديل البيع');
            }
            closeModal('saleModal'); renderProducts(); renderHistory();
        } catch (error) { showError('saleError', error.message || 'تعذر حفظ العملية'); }
        button.disabled = false;
    }

    async function updateStats(delta) { if (delta) await db.collection('stats').doc('totals').set({ allTimeProfit: firebase.firestore.FieldValue.increment(delta), updatedAt: Date.now() }, { merge: true }); }
    async function logMobileActivity(action, sale) { return db.collection('activityLog').add({ action: action, entity: 'sale', entityId: sale.saleId || null, message: action === 'sell' ? 'بيع من نقطة البيع' : 'تعديل بيع من نقطة البيع', itemId: sale.itemId, itemName: sale.itemName, quantity: sale.quantity, timestamp: Date.now(), source: SOURCE }); }

    async function cancelSale(saleId) {
        var sale = sales.find(function (entry) { return entry && entry.saleId === saleId; });
        if (!sale || sale.source !== SOURCE || !window.confirm('إلغاء عملية البيع؟')) return;
        if (!sale.itemId) { notify('معرف المنتج غير موجود في سجل البيع'); return; }
        var item = (Array.isArray(items) ? items : []).find(function (entry) { return entry && entry.id === sale.itemId; });
        if (!item) {
            try {
                var itemDoc = await db.collection('items').doc(sale.itemId).get({ source: navigator.onLine ? 'default' : 'cache' });
                if (itemDoc.exists) item = Object.assign({ id: itemDoc.id }, itemDoc.data());
            } catch (error) { notify('تعذر الوصول إلى المنتج المرتبط بالبيع'); return; }
        }
        if (!item || !item.id) { notify('المنتج المرتبط بعملية البيع غير موجود'); return; }
        try {
            var result = sale.purchaseBatchAllocations && sale.purchaseBatchAllocations.length ? await restoreBatches(item.id, sale.purchaseBatchAllocations) : await updateQuantity(item.id, sale.quantity);
            if (result === null || result === undefined || (typeof result === 'object' && result.quantity === undefined)) { notify('تعذر استرجاع كمية المنتج المرتبط'); return; }
            await db.collection('sales').doc(saleId).delete(); await updateStats(-(Number(sale.profit) || 0)); await logMobileActivity('cancel', sale);
            item.quantity = typeof result === 'number' ? result : result.quantity;
            if (typeof result === 'object' && result.purchaseBatches) item.purchaseBatches = result.purchaseBatches;
            var localItemIndex = items.findIndex(function (entry) { return entry && entry.id === item.id; });
            if (localItemIndex >= 0) items[localItemIndex] = item;
            else items.push(item);
            sales = sales.filter(function (entry) { return !entry || entry.saleId !== saleId; }); saveCache();
            renderProducts(); renderHistory(); notify('تم إلغاء البيع وإعادة الكمية للمخزون');
        } catch (error) { notify(error.message || 'تعذر إلغاء البيع'); }
    }

    async function loadData() {
        if (dataLoaded) return;
        dataLoaded = true;
        var hasCache = restoreCache();
        if (hasCache) { renderProducts(); renderHistory(); }
        startLiveListeners();
        if (hasCache) return;
        try {
            var cacheRead = Promise.all([
                db.collection('items').get({ source: 'cache' }),
                db.collection('sales').where('source', '==', SOURCE).get({ source: 'cache' }),
                db.collection('currencySettings').doc('settings').get({ source: 'cache' })
            ]).then(function (result) {
                items = result[0].docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
                sales = result[1].docs.map(function (doc) { return Object.assign({ saleId: doc.id }, doc.data()); });
                if (result[2].exists) currency = Object.assign(currency, result[2].data());
                renderProducts(); renderHistory(); saveCache();
            });
            await Promise.race([cacheRead, new Promise(function (resolve) { setTimeout(resolve, 1200); })]);
        } catch (error) { $('productCount').textContent = 'تعذر تحميل المنتجات'; notify('تعذر الاتصال بالنظام'); console.error(error); }
    }

    function startLiveListeners() {
        if (listenersStarted) return;
        listenersStarted = true;
        db.collection('items').onSnapshot(function (snap) {
            var nextItems = snap.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
            var changed = nextItems.length !== items.length || nextItems.some(function (next) {
                var previous = items.find(function (item) { return item.id === next.id; });
                return !previous || JSON.stringify(previous) !== JSON.stringify(next);
            });
            if (changed) { items = nextItems; renderProducts(); saveCache(); }
            lastSyncAt = Date.now();
        });
        db.collection('sales').where('source', '==', SOURCE).onSnapshot(function (snap) {
            var nextSales = snap.docs.map(function (doc) { return Object.assign({ saleId: doc.id }, doc.data()); });
            nextSales = uniqueSales(nextSales);
            if (JSON.stringify(nextSales) !== JSON.stringify(uniqueSales(sales))) { sales = nextSales; renderHistory(); saveCache(); }
            lastSyncAt = Date.now();
        });
        db.collection('currencySettings').doc('settings').onSnapshot(function (doc) {
            if (doc.exists) { var nextCurrency = Object.assign({}, currency, doc.data()); if (JSON.stringify(nextCurrency) !== JSON.stringify(currency)) { currency = nextCurrency; renderProducts(); renderHistory(); saveCache(); } }
            lastSyncAt = Date.now();
        });
    }

    $('loginForm').addEventListener('submit', function (event) { event.preventDefault(); showError('loginError', ''); auth.signInWithEmailAndPassword($('email').value.trim(), $('password').value).catch(function () { showError('loginError', 'بيانات الدخول غير صحيحة'); }); });
    $('productSearch').addEventListener('input', function () { renderProducts(); scrollToProductsTop(); });
    $('saleQuantity').addEventListener('input', function () { unusualPriceApproved = false; $('priceWarning').hidden = true; updateSalePriceGuide(); });
    $('salePrice').addEventListener('input', function () { salePriceManuallyEdited = true; unusualPriceApproved = false; $('priceWarning').hidden = true; updateSalePriceGuide(); });
    $('resetSalePrice').addEventListener('click', function () { salePriceManuallyEdited = false; updateSalePriceGuide(true); });
    $('quickQuantityButtons').addEventListener('click', function (event) {
        var button = event.target.closest('[data-quick-quantity]');
        if (!button || button.disabled) return;
        $('saleQuantity').value = button.dataset.quickQuantity;
        $('saleQuantity').dispatchEvent(new Event('input', { bubbles: true }));
    });
    $('backFromWarning').addEventListener('click', function () { unusualPriceApproved = false; $('priceWarning').hidden = true; });
    $('confirmUnusualPrice').addEventListener('click', function () { unusualPriceApproved = true; $('priceWarning').hidden = true; $('saleForm').requestSubmit(); });
    window.addEventListener('scroll', function () {
        try { localStorage.setItem(CACHE_KEY + ':scrollY', String(window.scrollY)); } catch (error) {}
        updateCustomScrollbar();
    }, { passive: true });
    $('historyButton').addEventListener('click', function () { renderHistory(); openModal('historyModal'); });
    $('productsGrid').addEventListener('click', function (event) { var button = event.target.closest('[data-sell-item]'); if (button && !button.disabled) { var item = items.find(function (entry) { return entry.id === button.dataset.sellItem; }); if (item) openNewSale(item, number(button.dataset.sellPrice), button.dataset.sellMode); } });
    $('salesHistory').addEventListener('click', function (event) { var edit = event.target.closest('[data-edit-sale]'), cancel = event.target.closest('[data-cancel-sale]'), warningButton = event.target.closest('[data-warning-sale]'); if (edit) { var sale = sales.find(function (entry) { return entry.saleId === edit.dataset.editSale; }); if (sale) { closeModal('historyModal'); openEditSale(sale); } } if (cancel) cancelSale(cancel.dataset.cancelSale); if (warningButton) { var warningSale = sales.find(function (entry) { return entry.saleId === warningButton.dataset.warningSale; }); if (warningSale) window.alert('سبب التنبيه: سعر القطعة المحسوب ' + (warningSale.priceWarningDirection || '') + ' من ' + (warningSale.priceType === 'mechanic' ? 'سعر الجملة' : 'سعر البيع الأساسي') + ' بنسبة ' + money(warningSale.priceWarningPercent || 0) + '%.'); } });
    $('salesHistory').addEventListener('click', function (event) { if (event.target.id === 'loadMoreSales') { historyVisibleCount += 25; renderHistory(); } });
    $('backToTop').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    window.addEventListener('scroll', function () { $('backToTop').classList.toggle('show', window.scrollY > 220); }, { passive: true });
    window.addEventListener('resize', updateCustomScrollbar);
    setupCustomScrollbar();
    updateCustomScrollbar();
    $('saleForm').addEventListener('submit', submitSale);
    document.querySelectorAll('[data-close-modal]').forEach(function (button) { button.addEventListener('click', function () { closeModal(button.dataset.closeModal); }); });
    document.querySelectorAll('.modal-backdrop').forEach(function (backdrop) { backdrop.addEventListener('click', function (event) { if (event.target === backdrop) closeModal(backdrop.id); }); });

    function hideSplash() { setTimeout(function () { $('splashScreen').classList.add('ready'); }, 180); }
    async function applyAuthState(user) {
        if (user) {
            $('loginScreen').hidden = true;
            $('appShell').hidden = false;
            await loadData();
        } else {
            $('loginScreen').hidden = false;
            $('appShell').hidden = true;
        }
        hideSplash();
    }
    var authStateObserved = false;
    function observeAuthState() {
        auth.onAuthStateChanged(function (user) { authStateObserved = true; applyAuthState(user); });
        setTimeout(function () { if (!authStateObserved) applyAuthState(auth.currentUser || null); }, 3500);
    }
    Promise.race([
        Promise.resolve(window.firebaseAuthPersistenceReady),
        new Promise(function (resolve) { setTimeout(resolve, 1200); })
    ]).then(observeAuthState).catch(observeAuthState);

    window.addEventListener('beforeinstallprompt', function (event) {
        event.preventDefault(); installPrompt = event; $('installButton').style.display = 'block';
    });
    $('installButton').addEventListener('click', async function () {
        if (!installPrompt) return;
        installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('installButton').style.display = 'none';
    });
    window.addEventListener('appinstalled', function () { $('installButton').style.display = 'none'; });

    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && Date.now() - lastSyncAt > 5 * 60 * 1000 && dataLoaded) startLiveListeners();
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('mobile-sales-sw.js').catch(function () {});
}());
