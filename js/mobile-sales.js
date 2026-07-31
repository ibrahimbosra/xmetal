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

    var $ = function (id) { return document.getElementById(id); };
    var esc = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
    var number = function (value) { var n = Number(value); return Number.isFinite(n) ? n : null; };
    var secondary = function (primary) { return (Number(primary) || 0) * (Number(currency.exchangeRate) || 1); };
    var primary = function (secondaryValue) { return (Number(secondaryValue) || 0) / (Number(currency.exchangeRate) || 1); };
    var money = function (value) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value) || 0); };
    var date = function (timestamp) { return new Intl.DateTimeFormat('ar-SA-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp || Date.now())); };
    var showError = function (id, message) { $(id).textContent = message || ''; };

    function notify(message) {
        var el = $('toast'); el.textContent = message; el.classList.add('show');
        clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
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
            if (Array.isArray(cached.sales)) sales = cached.sales;
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
                '<div class="price-line base-price"><span>السعر الأساسي</span><strong>' + money(secondary(item.salePrice)) + ' ' + esc(currency.secondaryCurrencySymbol) + '</strong></div>' +
                '<div class="price-line mechanic-price"><span>للميـكانيكي</span><strong>' + money(secondary(mechanicPrice(item))) + ' ' + esc(currency.secondaryCurrencySymbol) + '</strong></div>' +
                '</div><button class="sell-button" type="button" data-sell-item="' + esc(item.id) + '" ' + (stock <= 0 ? 'disabled' : '') + '>بيع</button>';
            }
            $('productsGrid').appendChild(element);
        });
    }

    function resetSaleForm() {
        $('saleForm').reset(); $('saleError').textContent = '';
        $('saleQuantity').value = 1;
    }

    function openNewSale(item) {
        selectedItem = item; editingSale = null; resetSaleForm();
        $('saleModalTitle').textContent = 'بيع منتج'; $('saleProductName').textContent = item.name || 'منتج';
        $('saleQuantity').max = item.quantity;
        $('salePrice').value = Number(secondary(item.salePrice).toFixed(2));
        $('saleCurrencyLabel').textContent = '(' + currency.secondaryCurrencySymbol + ')';
        $('saleForm').querySelector('button[type="submit"]').textContent = 'تأكيد البيع';
        openModal('saleModal');
    }

    function openEditSale(sale) {
        var item = items.find(function (entry) { return entry.id === sale.itemId; });
        if (!item) return notify('المنتج غير موجود');
        selectedItem = item; editingSale = sale; resetSaleForm();
        $('saleModalTitle').textContent = 'تعديل البيع'; $('saleProductName').textContent = sale.itemName || item.name || 'منتج';
        $('saleQuantity').value = sale.quantity; $('saleQuantity').max = (Number(item.quantity) || 0) + (Number(sale.quantity) || 0);
        $('salePrice').value = Number(secondary(sale.unitPrice).toFixed(2));
        $('saleCurrencyLabel').textContent = '(' + currency.secondaryCurrencySymbol + ')';
        $('saleForm').querySelector('button[type="submit"]').textContent = 'حفظ التعديل';
        openModal('saleModal');
    }

    function renderHistory() {
        var ordered = sales.slice().sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
        $('salesHistory').innerHTML = ordered.length ? ordered.map(function (sale) {
            return '<article class="sale-record"><h3>' + esc(sale.itemName || 'منتج') + '</h3>' +
                '<div class="sale-meta"><span>' + esc(date(sale.timestamp)) + '</span><span>الكمية: ' + money(sale.quantity) + '</span></div>' +
                '<p class="sale-total">سعر البيع: ' + money(secondary(sale.unitPrice)) + ' ' + esc(currency.secondaryCurrencySymbol) + '</p>' +
                '<div class="record-actions"><button type="button" data-edit-sale="' + esc(sale.saleId) + '">تعديل الكمية/السعر</button>' +
                '<button type="button" class="cancel-sale" data-cancel-sale="' + esc(sale.saleId) + '">إلغاء البيع</button></div></article>';
        }).join('') : '<div class="empty-state">لا توجد عمليات بيع حتى الآن</div>';
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
            var data = doc.data(), batches = Array.isArray(data.purchaseBatches) ? data.purchaseBatches.slice() : [];
            allocations.forEach(function (allocation) {
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
        var qty = number($('saleQuantity').value), displayedPrice = number($('salePrice').value);
        if (!selectedItem || qty === null || qty <= 0 || displayedPrice === null || displayedPrice < 0) { showError('saleError', 'تحقق من الكمية والسعر'); return; }
        var oldQty = editingSale ? Number(editingSale.quantity) || 0 : 0;
        if (qty > (Number(selectedItem.quantity) || 0) + oldQty) { showError('saleError', 'الكمية المتوفرة غير كافية'); return; }
        var button = $('saleForm').querySelector('button[type="submit"]'); button.disabled = true; showError('saleError', '');
        try {
            if (!editingSale) {
                var allocations = selectedItem.purchaseBatches && selectedItem.purchaseBatches.length ? computeAllocations(selectedItem, qty) : null;
                if (selectedItem.purchaseBatches && selectedItem.purchaseBatches.length && !allocations.length) throw new Error('الكمية المتوفرة غير كافية');
                var stockResult = await changeStock(selectedItem, -qty, allocations);
                var cost = Number(selectedItem.purchasePrice) || 0;
                var sale = { itemId: selectedItem.id, itemName: selectedItem.name, quantity: qty, unitPrice: primary(displayedPrice), totalAmount: primary(displayedPrice) * qty, profit: (primary(displayedPrice) - cost) * qty, purchasePriceAtTime: cost, timestamp: Date.now(), saleCurrency: 'secondary', source: SOURCE };
                if (allocations) sale.purchaseBatchAllocations = allocations;
                var saleRef = await db.collection('sales').add(sale); sale.saleId = saleRef.id;
                await updateStats(sale.profit);
                await logMobileActivity('sell', sale);
                selectedItem.quantity = stockResult.quantity; selectedItem.purchaseBatches = stockResult.purchaseBatches || selectedItem.purchaseBatches;
                sales.push(sale); saveCache(); notify('تم تسجيل البيع بنجاح');
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
                var updated = Object.assign({}, editingSale, { quantity: qty, unitPrice: newPrice, totalAmount: newPrice * qty, profit: newProfit, saleCurrency: 'secondary', purchaseBatchAllocations: allocations, updatedAt: Date.now(), source: SOURCE });
                await db.collection('sales').doc(editingSale.saleId).set(updated);
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
        var sale = sales.find(function (entry) { return entry.saleId === saleId; });
        if (!sale || sale.source !== SOURCE || !window.confirm('إلغاء عملية البيع؟')) return;
        var item = items.find(function (entry) { return entry.id === sale.itemId; });
        if (!item) { notify('المنتج غير موجود'); return; }
        try {
            var result = sale.purchaseBatchAllocations && sale.purchaseBatchAllocations.length ? await restoreBatches(item.id, sale.purchaseBatchAllocations) : await updateQuantity(item.id, sale.quantity);
            await db.collection('sales').doc(saleId).delete(); await updateStats(-(Number(sale.profit) || 0)); await logMobileActivity('cancel', sale);
            item.quantity = result.quantity; item.purchaseBatches = result.purchaseBatches || item.purchaseBatches; sales = sales.filter(function (entry) { return entry.saleId !== saleId; }); saveCache();
            renderProducts(); renderHistory(); notify('تم إلغاء البيع وإعادة الكمية للمخزون');
        } catch (error) { notify(error.message || 'تعذر إلغاء البيع'); }
    }

    async function loadData() {
        if (dataLoaded) return;
        dataLoaded = true;
        var hasCache = restoreCache();
        if (hasCache) { renderProducts(); renderHistory(); }
        try {
            if (!hasCache) {
                var currencyDoc = await db.collection('currencySettings').doc('settings').get(); if (currencyDoc.exists) currency = Object.assign(currency, currencyDoc.data());
                var itemSnap = await db.collection('items').get(); items = itemSnap.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
                var salesSnap = await db.collection('sales').where('source', '==', SOURCE).get(); sales = salesSnap.docs.map(function (doc) { return Object.assign({ saleId: doc.id }, doc.data()); });
                renderProducts(); renderHistory(); saveCache();
            }
            startLiveListeners();
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
            if (JSON.stringify(nextSales) !== JSON.stringify(sales)) { sales = nextSales; renderHistory(); saveCache(); }
            lastSyncAt = Date.now();
        });
        db.collection('currencySettings').doc('settings').onSnapshot(function (doc) {
            if (doc.exists) { var nextCurrency = Object.assign({}, currency, doc.data()); if (JSON.stringify(nextCurrency) !== JSON.stringify(currency)) { currency = nextCurrency; renderProducts(); renderHistory(); saveCache(); } }
            lastSyncAt = Date.now();
        });
    }

    $('loginForm').addEventListener('submit', function (event) { event.preventDefault(); showError('loginError', ''); auth.signInWithEmailAndPassword($('email').value.trim(), $('password').value).catch(function () { showError('loginError', 'بيانات الدخول غير صحيحة'); }); });
    $('productSearch').addEventListener('input', renderProducts);
    window.addEventListener('scroll', function () {
        try { localStorage.setItem(CACHE_KEY + ':scrollY', String(window.scrollY)); } catch (error) {}
    }, { passive: true });
    $('historyButton').addEventListener('click', function () { renderHistory(); openModal('historyModal'); });
    $('productsGrid').addEventListener('click', function (event) { var button = event.target.closest('[data-sell-item]'); if (button) { var item = items.find(function (entry) { return entry.id === button.dataset.sellItem; }); if (item) openNewSale(item); } });
    $('salesHistory').addEventListener('click', function (event) { var edit = event.target.closest('[data-edit-sale]'), cancel = event.target.closest('[data-cancel-sale]'); if (edit) { var sale = sales.find(function (entry) { return entry.saleId === edit.dataset.editSale; }); if (sale) { closeModal('historyModal'); openEditSale(sale); } } if (cancel) cancelSale(cancel.dataset.cancelSale); });
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
    Promise.resolve(window.firebaseAuthPersistenceReady).then(function () {
        auth.onAuthStateChanged(applyAuthState);
    }).catch(function () {
        auth.onAuthStateChanged(applyAuthState);
    });

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
