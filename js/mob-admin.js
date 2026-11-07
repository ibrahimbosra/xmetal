/* Mobile-only sales surface. It intentionally renders no cost, profit, capital, or analytics fields. */
(function () {
    'use strict';

    var db = window.firebaseDb;
    var auth = window.firebaseAuth;
    var SOURCE = 'mobile-sales';
    var MOBILE_THEME_KEY = 'xmetalMobAdminTheme';
    var currentTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    var items = [];
    var categories = [];
    var categoriesLoaded = false;
    var productsLoaded = false;
    var activeProductCategoryId = '';
    var sales = [];
    var currency = { secondaryCurrencySymbol: '﷼', exchangeRate: 3.75 };
    var selectedItem = null;
    var editingSale = null;
    var activeSaleMode = null;
    var toastTimer = null;
    var inventorySort = localStorage.getItem('xmetalInventorySort') || 'alphabetical';
    var productFilter = 'available';
    var dataLoaded = false;
    var listenersStarted = false;
    var lastSyncAt = 0;
    var productElements = new Map();
    var CACHE_KEY = 'xmetalMobAdminCacheV1';
    var UI_STATE_KEY = CACHE_KEY + ':ui';
    var employeeSearchHistoryRequest = 0;
    var pendingUiState = null;
    var uiStateRestored = false;
    var uiStateSaveTimer = null;
    var installPrompt = null;
    var historyStartDate = null;
    var historyLiveStartDate = null;
    var historyHasMore = true;
    var historyLoading = false;
    var unusualPriceApproved = false;
    var salePriceManuallyEdited = false;
    var saleDefaultPrice = null;
    var userDisplayNameMap = {};
    var userDisplayNameMapPromise = null;
    var userDisplayNameMapFetchedAt = 0;
    var USER_DISPLAY_NAMES_CACHE_KEY = 'xmetalMobAdminDisplayNamesCacheV1';
    var helpers = window.XMetalMobileSalesHelpers || {};
    var managedCategoryId = '';
    var managedCategorySelection = new Set();
    var newCategoryProductSelection = new Set();

    var $ = function (id) { return document.getElementById(id); };
    window.XMETALChallengeData = {
        getProducts: function () { return items.slice(); },
        getUserId: function () { return auth && auth.currentUser ? auth.currentUser.uid : ''; },
        getDisplayPrice: function (primaryValue) { return productSecondary(primaryValue); },
        getCurrencySymbol: function () { return currency.secondaryCurrencySymbol; }
    };
    $('productSearch').value = '';
    function applyMobileTheme(theme, persist) {
        currentTheme = theme === 'light' ? 'light' : 'dark';
        document.documentElement.dataset.theme = currentTheme;
        var themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) themeColor.content = currentTheme === 'dark' ? '#0b1220' : '#f4f7fb';
        var button = $('themeToggleButton');
        if (button) {
            var nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
            var label = nextTheme === 'light' ? 'التبديل إلى الوضع النهاري' : 'التبديل إلى الوضع الليلي';
            button.innerHTML = currentTheme === 'dark' ?
                '<i class="fas fa-sun" aria-hidden="true"></i>' :
                '<i class="fas fa-moon" aria-hidden="true"></i>';
            button.setAttribute('aria-label', label);
            button.title = label;
            button.setAttribute('aria-pressed', String(currentTheme === 'dark'));
        }
        if (persist) {
            try { sessionStorage.setItem(MOBILE_THEME_KEY, currentTheme); }
            catch (error) { console.warn('Unable to persist mobile admin theme for this session.', error); }
        }
    }
    applyMobileTheme(currentTheme, false);
    var esc = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
    function highlightMatches(value, term) {
        var text = String(value == null ? '' : value), searchTerm = String(term || '').trim();
        if (!searchTerm) return esc(text);
        var pattern = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matcher = new RegExp(pattern, 'gi'), result = '', lastIndex = 0, match;
        while ((match = matcher.exec(text)) !== null) {
            result += esc(text.slice(lastIndex, match.index)) + '<mark class="product-highlight">' + esc(match[0]) + '</mark>';
            lastIndex = matcher.lastIndex;
            if (!match[0]) matcher.lastIndex += 1;
        }
        return result + esc(text.slice(lastIndex));
    }
    var number = function (value) { var n = Number(value); return Number.isFinite(n) ? n : null; };
    var secondary = function (primary) { return (Number(primary) || 0) * (Number(currency.exchangeRate) || 1); };
    var productSecondary = function (primaryValue) { return window.PriceHelpers && window.PriceHelpers.getSecondaryPrice ? window.PriceHelpers.getSecondaryPrice(primaryValue, currency.exchangeRate) : secondary(primaryValue); };
    var primary = function (secondaryValue) { return (Number(secondaryValue) || 0) / (Number(currency.exchangeRate) || 1); };
    var money = function (value) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value) || 0); };
    var price = function (value) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value) || 0); };
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
    function historyInitialStart() { var dateValue = new Date(); dateValue.setHours(0, 0, 0, 0); dateValue.setDate(dateValue.getDate() - 1); return dateValue; }
    function addDays(dateValue, days) { var next = new Date(dateValue); next.setDate(next.getDate() + days); return next; }
    var showError = function (id, message) { $(id).textContent = message || ''; };

    function ensureProductImageModal() {
        var modal = document.getElementById('productImageModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'productImageModal';
        modal.className = 'product-image-modal';
        modal.hidden = true;
        modal.innerHTML = '<div class="product-image-modal-backdrop" data-close-product-image="true"></div><div class="product-image-modal-content" role="dialog" aria-modal="true"><button type="button" class="product-image-modal-close" aria-label="إغلاق الصورة">×</button><button type="button" class="product-image-replace" aria-label="استبدال الصورة" title="استبدال الصورة"><i class="fas fa-camera" aria-hidden="true"></i></button><img alt="صورة المنتج" src=""></div>';
        document.body.appendChild(modal);
        modal.querySelector('.product-image-modal-close').addEventListener('click', function () { modal.hidden = true; });
        modal.addEventListener('click', function (event) {
            if (event.target.hasAttribute('data-close-product-image')) modal.hidden = true;
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && !modal.hidden) modal.hidden = true;
        });
        modal.querySelector('.product-image-replace').addEventListener('click', function () {
            var item = items.find(function (entry) { return entry.id === modal.dataset.itemId; });
            if (item) openProductImagePicker(item, true);
        });
        return modal;
    }

    function openProductImagePicker(item, showImageAfterSave) {
        if (!item || !item.id) return;
        var imageModal = document.getElementById('productImageModal');
        if (imageModal) imageModal.hidden = true;
        var editor = ensureLocationEditModal();
        openLocationEdit(item);
        editor.dataset.showImageAfterSave = showImageAfterSave ? 'true' : 'false';
        editor.querySelector('.admin-image-file-input').value = '';
        editor.querySelector('.admin-image-upload-button').click();
    }

    function ensureProductLocationModal() {
        var modal = document.getElementById('productLocationModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'productLocationModal';
        modal.className = 'product-location-modal';
        modal.hidden = true;
        modal.innerHTML = '<div class="product-location-backdrop" data-close-product-location="true"></div><section class="product-location-content" role="dialog" aria-modal="true" aria-labelledby="productLocationTitle"><button type="button" class="product-location-close" aria-label="إغلاق">×</button><p class="eyebrow">مكان القطعة</p><h2 id="productLocationTitle"></h2><p class="product-location-name"></p><form><label for="productLocationInput">مكان القطعة</label><input id="productLocationInput" type="text" maxlength="120" autocomplete="off" placeholder="مثال: رف 12"><div class="product-location-actions"><button type="button" class="product-location-cancel">إلغاء</button><button type="submit" class="product-location-save">حفظ</button></div><p class="form-error" role="alert"></p></form></section>';
        document.body.appendChild(modal);
        var input = modal.querySelector('#productLocationInput');
        var saveButton = modal.querySelector('.product-location-save');
        var close = function () { modal.hidden = true; };
        modal.querySelector('.product-location-close').addEventListener('click', close);
        modal.querySelector('.product-location-cancel').addEventListener('click', close);
        modal.addEventListener('click', function (event) {
            if (event.target.hasAttribute('data-close-product-location')) close();
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && !modal.hidden) close();
        });
        modal.querySelector('form').addEventListener('submit', async function (event) {
            event.preventDefault();
            var item = items.find(function (entry) { return entry.id === modal.dataset.itemId; });
            if (!item || saveButton.disabled) return;
            var error = modal.querySelector('.form-error');
            error.textContent = '';
            saveButton.disabled = true;
            try {
                var location = input.value.trim();
                await db.collection('items').doc(item.id).update({ location: location, updatedAt: Date.now() });
                item.location = location;
                saveCache();
                close();
                renderProducts();
                notify(location ? 'تم حفظ مكان القطعة' : 'تم حذف مكان القطعة');
            } catch (saveError) {
                error.textContent = 'تعذر حفظ مكان القطعة حاليًا. حاول مجددًا.';
                console.error(saveError);
            } finally {
                saveButton.disabled = false;
            }
        });
        return modal;
    }

    function openProductLocationEditor(item) {
        if (!item || !item.id) return;
        var modal = ensureProductLocationModal();
        var hasLocation = Boolean(item.location && String(item.location).trim());
        modal.dataset.itemId = item.id;
        modal.querySelector('#productLocationTitle').textContent = hasLocation ? 'تعديل مكان القطعة' : 'إضافة مكان القطعة';
        modal.querySelector('.product-location-name').textContent = item.name || 'منتج';
        modal.querySelector('#productLocationInput').value = hasLocation ? String(item.location).trim() : '';
        modal.querySelector('.product-location-save').textContent = hasLocation ? 'حفظ التعديل' : 'حفظ';
        modal.querySelector('.product-location-save').disabled = false;
        modal.querySelector('.form-error').textContent = '';
        modal.hidden = false;
        requestAnimationFrame(function () { modal.querySelector('#productLocationInput').focus(); });
    }

    function normalizeImageUrl(value) {
        if (typeof value !== 'string' || !value.trim()) return '';
        try {
            var url = new URL(value.trim());
            if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) return '';
            return url.href;
        } catch (error) {
            return '';
        }
    }

    function validCloudinarySettings(config) {
        return /^[a-z0-9][a-z0-9-]*$/i.test(config.cloudName || '') &&
            /^[a-z0-9_-]+$/i.test(config.uploadPreset || '');
    }

    var compressedProductImageBrand = Symbol('compressed-product-image');
    var maxCompressedProductImageSize = 100 * 1024;
    var maxProductImageDimension = 1000;

    async function decodeProductImage(file) {
        if (typeof createImageBitmap === 'function') {
            var bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
            return { source: bitmap, width: bitmap.width, height: bitmap.height, close: function () { bitmap.close(); } };
        }
        var objectUrl = URL.createObjectURL(file);
        var image = new Image();
        image.src = objectUrl;
        try {
            await image.decode();
        } catch (error) {
            image.removeAttribute('src');
            URL.revokeObjectURL(objectUrl);
            throw error;
        }
        return {
            source: image,
            width: image.naturalWidth,
            height: image.naturalHeight,
            close: function () {
                image.removeAttribute('src');
                URL.revokeObjectURL(objectUrl);
            }
        };
    }

    function canvasToJpegBlob(canvas, quality) {
        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (blob) {
                if (blob) resolve(blob);
                else reject(new Error('تعذر إنشاء نسخة JPEG من الصورة.'));
            }, 'image/jpeg', quality);
        });
    }

    async function compressProductImage(file, isCancelled) {
        var decoded;
        try {
            decoded = await decodeProductImage(file);
        } catch (error) {
            throw new Error('تعذر فتح الصورة لضغطها. جرّب صورة أخرى بصيغة JPEG أو PNG أو WebP.');
        }
        if (!Number.isFinite(decoded.width) || !Number.isFinite(decoded.height) || decoded.width < 1 || decoded.height < 1) {
            decoded.close();
            throw new Error('تعذر تحديد أبعاد الصورة لضغطها.');
        }
        var scale = Math.min(1, maxProductImageDimension / decoded.width, maxProductImageDimension / decoded.height);
        var width = Math.max(1, Math.round(decoded.width * scale));
        var height = Math.max(1, Math.round(decoded.height * scale));
        var canvas = document.createElement('canvas');
        var context = canvas.getContext('2d', { alpha: false });
        if (!context) {
            decoded.close();
            throw new Error('تعذر تجهيز الصورة لضغطها على هذا الجهاز.');
        }
        var quality = 0.86;
        try {
            for (var attempt = 0; attempt < 80; attempt += 1) {
                if (isCancelled()) throw new Error('تم إلغاء ضغط الصورة.');
                canvas.width = width;
                canvas.height = height;
                context.fillStyle = '#fff';
                context.fillRect(0, 0, width, height);
                context.drawImage(decoded.source, 0, 0, width, height);
                var blob = await canvasToJpegBlob(canvas, quality);
                if (blob.size <= maxCompressedProductImageSize) {
                    var baseName = file.name.replace(/\.[^.]+$/, '') || 'product-image';
                    var compressedFile = new File([blob], baseName + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
                    if (compressedFile.size <= maxCompressedProductImageSize) {
                        return { file: compressedFile, [compressedProductImageBrand]: true };
                    }
                    throw new Error('تعذر ضغط الصورة إلى 100 KB أو أقل. اختر صورة أصغر أو أقل دقة.');
                }
                var sizeRatio = Math.sqrt(maxCompressedProductImageSize / blob.size);
                var nextQuality = quality * Math.min(0.9, sizeRatio * 0.9);
                if (nextQuality >= 0.12) {
                    quality = nextQuality;
                } else {
                    var resizeFactor = Math.max(0.5, Math.min(0.85, sizeRatio * 0.9));
                    var nextScale = Math.min(width / decoded.width, height / decoded.height) * resizeFactor;
                    var nextWidth = Math.max(1, Math.round(decoded.width * nextScale));
                    var nextHeight = Math.max(1, Math.round(decoded.height * nextScale));
                    if (nextWidth === width && nextHeight === height) {
                        throw new Error('تعذر ضغط الصورة إلى 100 KB أو أقل. اختر صورة أصغر أو أقل دقة.');
                    }
                    width = nextWidth;
                    height = nextHeight;
                    quality = 0.86;
                }
                await new Promise(function (resolve) { setTimeout(resolve, 0); });
            }
            throw new Error('تعذر ضغط الصورة إلى 100 KB أو أقل. اختر صورة أصغر أو أقل دقة.');
        } catch (error) {
            if (error instanceof Error && /^[\u0600-\u06FF]/.test(error.message)) throw error;
            throw new Error('حدث خطأ أثناء ضغط الصورة. جرّب صورة أخرى.');
        } finally {
            canvas.width = 0;
            canvas.height = 0;
            decoded.close();
        }
    }

    function uploadProductImage(image, config, onProgress) {
        if (!image || image[compressedProductImageBrand] !== true || image.file.type !== 'image/jpeg' || image.file.size > maxCompressedProductImageSize) {
            throw new Error('تم إيقاف الرفع لأن الصورة المضغوطة يجب ألا تتجاوز 100 KB.');
        }
        var formData = new FormData();
        formData.append('file', image.file);
        formData.append('upload_preset', config.uploadPreset);
        var request = new XMLHttpRequest();
        request.open('POST', 'https://api.cloudinary.com/v1_1/' + encodeURIComponent(config.cloudName) + '/image/upload');
        request.timeout = 120000;
        var settled = false, resolveUpload, rejectUpload;
        var promise = new Promise(function (resolve, reject) { resolveUpload = resolve; rejectUpload = reject; });
        function finish(error, url) {
            if (settled) return;
            settled = true;
            request.upload.removeEventListener('progress', handleProgress);
            request.removeEventListener('load', handleLoad);
            request.removeEventListener('error', handleError);
            request.removeEventListener('abort', handleAbort);
            request.removeEventListener('timeout', handleTimeout);
            if (error) rejectUpload(error);
            else resolveUpload(url);
        }
        function handleProgress(event) {
            if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
        }
        function handleLoad() {
            var response;
            try { response = JSON.parse(request.responseText); }
            catch (error) { finish(new Error('استجابة Cloudinary غير صالحة.')); return; }
            if (request.status < 200 || request.status >= 300) {
                finish(new Error(response.error && response.error.message || 'رفض Cloudinary عملية رفع الصورة.'));
                return;
            }
            var secureUrl = normalizeImageUrl(response.secure_url);
            if (!secureUrl || secureUrl.indexOf('https://') !== 0) {
                finish(new Error('لم يُرجع Cloudinary رابطًا آمنًا صالحًا للصورة.'));
                return;
            }
            finish(null, secureUrl);
        }
        function handleError() { finish(new Error('تعذر الاتصال بخدمة Cloudinary.')); }
        function handleAbort() { finish(new Error('تم إلغاء رفع الصورة.')); }
        function handleTimeout() { finish(new Error('انتهت مهلة رفع الصورة. تحقق من الاتصال وحاول مجددًا.')); }
        request.upload.addEventListener('progress', handleProgress);
        request.addEventListener('load', handleLoad);
        request.addEventListener('error', handleError);
        request.addEventListener('abort', handleAbort);
        request.addEventListener('timeout', handleTimeout);
        try { request.send(formData); }
        catch (error) { finish(new Error('تعذر بدء رفع الصورة.')); }
        return { promise: promise, abort: function () { if (!settled) request.abort(); } };
    }

    function ensureLocationEditModal() {
        var modal = document.getElementById('locationEditModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'locationEditModal';
        modal.className = 'location-edit-modal';
        modal.hidden = true;
        modal.innerHTML = '<div class="location-edit-backdrop" data-close-location-edit="true"></div><section class="location-edit-content" role="dialog" aria-modal="true" aria-labelledby="locationEditTitle"><button type="button" class="location-edit-close" aria-label="إغلاق">×</button><p class="eyebrow" id="locationEditEyebrow">تعديل بيانات المنتج</p><h2 id="locationEditTitle">تعديل المنتج</h2><p class="location-edit-product" id="locationEditProduct"></p><form id="locationEditForm"><label for="adminProductName">اسم المنتج</label><input id="adminProductName" type="text" maxlength="200" autocomplete="off" required><div class="admin-edit-fields"><div><label for="adminPurchasePrice">سعر الشراء <span id="adminPurchaseCurrencyLabel">$</span></label><div class="admin-currency-input"><input id="adminPurchasePrice" type="number" min="0" step="any" required><button type="button" data-admin-currency-toggle="purchase" aria-label="تبديل عملة سعر الشراء">⇄</button></div></div><div><label for="adminSalePrice">سعر المبيع <span id="adminSaleCurrencyLabel"></span></label><div class="admin-currency-input"><input id="adminSalePrice" type="number" min="0" step="any" required><button type="button" data-admin-currency-toggle="sale" aria-label="تبديل عملة سعر المبيع">⇄</button></div></div><div><label for="adminMechanicPrice">سعر الميكانيكي <span id="adminMechanicCurrencyLabel"></span></label><div class="admin-currency-input"><input id="adminMechanicPrice" type="number" min="0" step="any" required><button type="button" data-admin-currency-toggle="mechanic" aria-label="تبديل عملة سعر الميكانيكي">⇄</button></div></div><div><label for="adminQuantity">الكمية</label><input id="adminQuantity" type="number" min="0" step="any" required></div></div><div class="admin-location-fields"><div><label for="locationEditInput">الموقع</label><input id="locationEditInput" type="text" maxlength="120" autocomplete="off" placeholder="مثال: رف 12"></div><div class="admin-image-field"><div class="admin-image-label-row"><label for="imageUrlEditInput">رابط الصورة</label><button type="button" class="admin-image-upload-button" aria-label="إضافة صورة" title="رفع صورة"><i class="fas fa-plus" aria-hidden="true"></i></button><input class="admin-image-file-input" type="file" accept="image/jpeg,image/png,image/webp" hidden></div><input id="imageUrlEditInput" type="url" maxlength="1000" autocomplete="off" dir="ltr" placeholder="https://..."><small class="admin-image-upload-status" role="status" aria-live="polite"></small><div class="admin-image-preview" hidden><img alt="معاينة صورة المنتج"><span></span></div></div></div><p class="input-hint">اترك رابط الصورة فارغًا لإزالة صورة المنتج.</p><div class="location-edit-actions"><button type="button" class="location-edit-cancel">إلغاء</button><button type="submit" class="location-edit-save">حفظ</button></div><p class="form-error" id="locationEditError" role="alert"></p></form></section>';
        modal.querySelector('.input-hint').remove();
        var categoryField = document.createElement('div');
        categoryField.className = 'admin-category-field';
        categoryField.innerHTML = '<label for="adminProductCategoryId">الفئة</label><select id="adminProductCategoryId"></select>';
        var imageField = modal.querySelector('.admin-image-field');
        var imageUrlInput = modal.querySelector('#imageUrlEditInput');
        var imageFileInput = modal.querySelector('.admin-image-file-input');
        var imageUploadButton = modal.querySelector('.admin-image-upload-button');
        var imageLabel = modal.querySelector('.admin-image-label-row label');
        var imageUrlRow = document.createElement('div');
        imageUrlRow.className = 'admin-image-url-row';
        var imageClearButton = document.createElement('button');
        imageClearButton.type = 'button';
        imageClearButton.className = 'admin-image-clear-button';
        imageClearButton.setAttribute('aria-label', 'حذف رابط الصورة');
        imageClearButton.title = 'حذف رابط الصورة';
        imageClearButton.innerHTML = '<i class="fas fa-trash" aria-hidden="true"></i>';
        var imageActions = document.createElement('div');
        imageActions.className = 'admin-image-actions';
        imageActions.append(imageUploadButton, imageClearButton);
        imageUrlRow.append(imageUrlInput, imageActions);
        imageField.querySelector('.admin-image-label-row').replaceWith(imageLabel);
        imageField.insertBefore(imageUrlRow, imageField.querySelector('.admin-image-upload-status'));
        imageUrlRow.appendChild(imageFileInput);
        var locationFields = modal.querySelector('.admin-location-fields');
        locationFields.insertBefore(categoryField, imageField);
        renderAdminProductCategorySelect('');
        ['adminSalePrice', 'adminMechanicPrice'].forEach(function (inputId) {
            var label = modal.querySelector('label[for="' + inputId + '"]'), profit = document.createElement('small');
            profit.className = 'admin-live-profit';
            profit.dataset.profitFor = inputId;
            label.appendChild(profit);
        });
        document.body.appendChild(modal);
        var actions = modal.querySelector('.location-edit-actions');
        var cancelButton = modal.querySelector('.location-edit-cancel');
        var saveButton = modal.querySelector('.location-edit-save');
        var deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'location-edit-delete';
        deleteButton.textContent = 'حذف';
        actions.insertBefore(deleteButton, saveButton);
        var cancelDeleteButton = document.createElement('button');
        cancelDeleteButton.type = 'button';
        cancelDeleteButton.className = 'location-edit-delete-cancel';
        cancelDeleteButton.textContent = 'إلغاء الحذف';
        cancelDeleteButton.hidden = true;
        actions.insertBefore(cancelDeleteButton, cancelButton);
        var confirmDeleteButton = document.createElement('button');
        confirmDeleteButton.type = 'button';
        confirmDeleteButton.className = 'location-edit-delete-confirm';
        confirmDeleteButton.textContent = 'تأكيد الحذف';
        confirmDeleteButton.hidden = true;
        actions.insertBefore(confirmDeleteButton, cancelButton);
        var setDeleteConfirmation = function (active) {
            actions.classList.toggle('is-confirming-delete', active);
            cancelButton.hidden = active;
            deleteButton.hidden = active || modal.dataset.mode === 'create';
            saveButton.hidden = active;
            cancelDeleteButton.hidden = !active;
            confirmDeleteButton.hidden = !active;
        };
        var discardPendingImage = null;
        var close = function () {
            modal.dataset.imageUploadToken = String((Number(modal.dataset.imageUploadToken) || 0) + 1);
            if (modal._abortImageUpload) modal._abortImageUpload();
            modal._abortImageUpload = null;
            if (discardPendingImage) discardPendingImage();
            modal.querySelector('.admin-image-upload-button').disabled = false;
            modal.querySelector('#imageUrlEditInput').disabled = false;
            modal.querySelector('.location-edit-save').disabled = false;
            modal.querySelector('.admin-image-file-input').value = '';
            if (clearLocalImagePreview) clearLocalImagePreview();
            modal.hidden = true;
            saveUiState();
        };
        modal.querySelector('.location-edit-close').addEventListener('click', close);
        modal.querySelector('.location-edit-cancel').addEventListener('click', close);
        deleteButton.addEventListener('click', function () {
            modal.querySelector('#locationEditError').textContent = '';
            setDeleteConfirmation(true);
        });
        cancelDeleteButton.addEventListener('click', function () {
            modal.querySelector('#locationEditError').textContent = '';
            setDeleteConfirmation(false);
        });
        confirmDeleteButton.addEventListener('click', async function () {
            var itemId = modal.dataset.itemId, error = modal.querySelector('#locationEditError');
            if (!itemId || modal.dataset.mode !== 'edit') return;
            if (modal._abortImageUpload || modal.querySelector('.admin-image-upload-button').disabled) {
                error.textContent = 'انتظر اكتمال رفع الصورة قبل حذف المنتج.';
                return;
            }
            error.textContent = '';
            confirmDeleteButton.disabled = true;
            cancelDeleteButton.disabled = true;
            try {
                await db.collection('items').doc(itemId).delete();
                var itemIndex = items.findIndex(function (item) { return item.id === itemId; });
                if (itemIndex !== -1) items.splice(itemIndex, 1);
                saveCache();
                if (discardPendingImage) discardPendingImage();
                if (clearLocalImagePreview) clearLocalImagePreview();
                modal.hidden = true;
                saveUiState();
                setDeleteConfirmation(false);
                renderProducts();
                notify('تم حذف المنتج');
            } catch (deleteError) {
                error.textContent = 'تعذر حذف المنتج حاليًا';
                console.error(deleteError);
            } finally {
                confirmDeleteButton.disabled = false;
                cancelDeleteButton.disabled = false;
            }
        });
        modal.addEventListener('click', function (event) { if (event.target.hasAttribute('data-close-location-edit')) close(); });
        document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !modal.hidden) close(); });
        modal.querySelectorAll('[data-admin-currency-toggle]').forEach(function (button) {
            button.addEventListener('click', function () {
                var field = button.dataset.adminCurrencyToggle, input = modal.querySelector('#admin' + field.charAt(0).toUpperCase() + field.slice(1) + 'Price'), currentMode = modal.dataset[field + 'Currency'] || 'primary', nextMode = currentMode === 'primary' ? 'secondary' : 'primary', value = number(input.value) || 0, primaryValue = currentMode === 'secondary' ? primary(value) : value;
                input.value = nextMode === 'secondary' ? productSecondary(primaryValue) : primaryValue;
                modal.dataset[field + 'Currency'] = nextMode;
                modal.querySelector('#admin' + field.charAt(0).toUpperCase() + field.slice(1) + 'CurrencyLabel').textContent = nextMode === 'secondary' ? currency.secondaryCurrencySymbol : '$';
                updateAdminProfitLabels(modal);
            });
        });
        var imageFileInput = modal.querySelector('.admin-image-file-input');
        var imageUploadStatus = modal.querySelector('.admin-image-upload-status');
        var imagePreview = modal.querySelector('.admin-image-preview');
        var imagePreviewElement = imagePreview.querySelector('img');
        var imagePreviewText = imagePreview.querySelector('span');
        var imagePreviewOpenButton = document.createElement('button');
        imagePreviewOpenButton.type = 'button';
        imagePreviewOpenButton.className = 'admin-image-preview-open';
        imagePreviewOpenButton.setAttribute('aria-label', 'تكبير معاينة الصورة');
        imagePreviewOpenButton.appendChild(imagePreviewElement);
        imagePreview.replaceChildren(imagePreviewOpenButton, imagePreviewText);
        imageUrlRow.appendChild(imagePreview);
        var imageSaveButton = modal.querySelector('.location-edit-save');
        var localImagePreviewUrl = '';
        var pendingCompressedImage = null;
        var uploadedPendingImageUrl = '';
        var clearLocalImagePreview = function () {
            if (!localImagePreviewUrl) return;
            URL.revokeObjectURL(localImagePreviewUrl);
            localImagePreviewUrl = '';
        };
        discardPendingImage = function () {
            modal.dataset.imageSelectionToken = String((Number(modal.dataset.imageSelectionToken) || 0) + 1);
            pendingCompressedImage = null;
            uploadedPendingImageUrl = '';
            clearLocalImagePreview();
        };
        modal._resetPendingImage = discardPendingImage;
        var updateImagePreview = function () {
            if (pendingCompressedImage) {
                discardPendingImage();
                imageUploadStatus.textContent = '';
            } else clearLocalImagePreview();
            var url = normalizeImageUrl(imageUrlInput.value);
            if (!imageUrlInput.value.trim()) {
                imagePreview.hidden = true;
                imagePreviewElement.removeAttribute('src');
                return;
            }
            imagePreview.hidden = false;
            imagePreviewElement.hidden = false;
            imagePreviewText.textContent = url ? 'جارٍ تحميل المعاينة...' : 'أدخل رابط صورة صحيحًا يبدأ بـ http أو https.';
            imagePreviewElement.onload = function () { imagePreviewText.textContent = ''; };
            imagePreviewElement.onerror = function () { imagePreviewElement.hidden = true; imagePreviewText.textContent = 'تعذر تحميل الصورة من هذا الرابط.'; };
            if (url) imagePreviewElement.src = url;
            else imagePreviewElement.removeAttribute('src');
        };
        var showCompressedImagePreview = function (file) {
            clearLocalImagePreview();
            localImagePreviewUrl = URL.createObjectURL(file);
            var previewUrl = localImagePreviewUrl;
            imagePreview.hidden = false;
            imagePreviewElement.hidden = false;
            imagePreviewText.textContent = 'معاينة الصورة المضغوطة قبل الرفع.';
            imagePreviewElement.onload = function () {
                if (localImagePreviewUrl === previewUrl) imagePreviewText.textContent = 'معاينة الصورة المضغوطة قبل الرفع.';
            };
            imagePreviewElement.onerror = function () {
                if (localImagePreviewUrl === previewUrl) imagePreviewText.textContent = 'تعذر تحميل معاينة الصورة المضغوطة.';
            };
            imagePreviewElement.src = previewUrl;
        };
        imageUrlInput.addEventListener('input', updateImagePreview);
        imageUploadButton.addEventListener('click', function () { imageFileInput.click(); });
        imagePreviewOpenButton.addEventListener('click', function () {
            var source = imagePreviewElement.currentSrc || imagePreviewElement.src;
            if (!source || imagePreviewElement.hidden) return;
            var imageModal = ensureProductImageModal();
            var itemId = modal.dataset.mode === 'edit' ? modal.dataset.itemId : '';
            imageModal.dataset.itemId = itemId;
            imageModal.querySelector('.product-image-replace').hidden = !itemId;
            imageModal.querySelector('img').src = source;
            imageModal.querySelector('img').alt = modal.querySelector('#adminProductName').value || 'معاينة صورة المنتج';
            imageModal.hidden = false;
        });
        imageClearButton.addEventListener('click', function () {
            imageUrlInput.value = '';
            imageUrlInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
        imageFileInput.addEventListener('cancel', function () {
            imageFileInput.value = '';
        });
        imageFileInput.addEventListener('change', async function () {
            var file = imageFileInput.files && imageFileInput.files[0];
            if (!file) return;
            if (['image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) === -1) {
                imageUploadStatus.textContent = 'الصيغ المسموحة JPEG وPNG وWebP فقط.';
                imageFileInput.value = '';
                return;
            }
            if (file.size > 10 * 1024 * 1024) {
                imageUploadStatus.textContent = 'يجب ألا يتجاوز حجم الصورة 10 MiB.';
                imageFileInput.value = '';
                return;
            }
            var token = String((Number(modal.dataset.imageSelectionToken) || 0) + 1);
            modal.dataset.imageSelectionToken = token;
            imageSaveButton.disabled = true;
            imageUploadStatus.textContent = 'جارٍ ضغط الصورة محليًا إلى 100 KB أو أقل...';
            try {
                var compressedImage = await compressProductImage(file, function () {
                    return modal.dataset.imageSelectionToken !== token || modal.hidden;
                });
                if (modal.dataset.imageSelectionToken !== token || modal.hidden) return;
                pendingCompressedImage = compressedImage;
                uploadedPendingImageUrl = '';
                showCompressedImagePreview(compressedImage.file);
                imageUploadStatus.textContent = 'تم ضغط الصورة. سيتم رفعها عند حفظ المنتج.';
            } catch (compressionError) {
                if (modal.dataset.imageSelectionToken === token && !modal.hidden) {
                    console.error('Mobile admin product image compression failed:', compressionError);
                    imageUploadStatus.textContent = pendingCompressedImage
                        ? (compressionError.message || 'تعذر ضغط الصورة الجديدة.') + ' بقيت معاينة الصورة السابقة.'
                        : (compressionError.message || 'تعذر ضغط الصورة؛ اختر صورة أخرى وحاول مجددًا.');
                }
            } finally {
                if (modal.dataset.imageSelectionToken === token) {
                    imageSaveButton.disabled = false;
                    imageFileInput.value = '';
                }
            }
        });
        modal.querySelectorAll('#adminPurchasePrice, #adminSalePrice, #adminMechanicPrice').forEach(function (input) {
            input.addEventListener('input', function () {
                if (input.id === 'adminPurchasePrice') modal._purchasePriceEdited = true;
                updateAdminProfitLabels(modal);
            });
        });
        modal.querySelector('#locationEditForm').addEventListener('submit', async function (event) {
            event.preventDefault();
            var itemId = modal.dataset.itemId, item = items.find(function (entry) { return entry.id === itemId; });
            var input = modal.querySelector('#locationEditInput'), error = modal.querySelector('#locationEditError'), save = modal.querySelector('.location-edit-save');
            var isCreate = modal.dataset.mode === 'create';
            var imageUploadStarted = false;
            if (!item && !isCreate) return;
            if (save.disabled) return;
            error.textContent = '';
            if (modal._abortImageUpload) {
                error.textContent = 'انتظر اكتمال رفع الصورة قبل الحفظ.';
                return;
            }
            save.disabled = true;
            try {
                var name = modal.querySelector('#adminProductName').value.trim(), location = input.value.trim(), imageInput = modal.querySelector('#imageUrlEditInput').value.trim(), imageUrl = pendingCompressedImage ? uploadedPendingImageUrl : normalizeImageUrl(imageInput);
                var purchasePrice = number(modal.querySelector('#adminPurchasePrice').value), salePrice = number(modal.querySelector('#adminSalePrice').value), mechanicPriceValue = number(modal.querySelector('#adminMechanicPrice').value), quantity = number(modal.querySelector('#adminQuantity').value);
                if (!pendingCompressedImage && imageInput && !imageUrl) {
                    error.textContent = 'رابط الصورة غير صالح. استخدم رابطًا يبدأ بـ http:// أو https://.';
                    save.disabled = false;
                    return;
                }
                if (item && !modal._purchasePriceEdited) purchasePrice = number(item.purchasePrice);
                else if (modal.dataset.purchaseCurrency === 'secondary') purchasePrice = primary(purchasePrice);
                if (item && window.PriceHelpers && window.PriceHelpers.getPrimaryPriceFromInput) {
                    salePrice = window.PriceHelpers.getPrimaryPriceFromInput(salePrice, item.salePrice, modal.dataset.saleCurrency === 'secondary', currency.exchangeRate);
                    mechanicPriceValue = window.PriceHelpers.getPrimaryPriceFromInput(mechanicPriceValue, mechanicPrice(item), modal.dataset.mechanicCurrency === 'secondary', currency.exchangeRate);
                } else {
                    if (modal.dataset.saleCurrency === 'secondary') salePrice = primary(salePrice);
                    if (modal.dataset.mechanicCurrency === 'secondary') mechanicPriceValue = primary(mechanicPriceValue);
                }
                if (!name || [purchasePrice, salePrice, mechanicPriceValue, quantity].some(function (value) { return value === null || value < 0; })) {
                    error.textContent = !name ? 'يرجى إدخال اسم المنتج' : 'يرجى إدخال أسعار وكمية صحيحة غير سالبة';
                    save.disabled = false;
                    return;
                }
                if (pendingCompressedImage && !uploadedPendingImageUrl) {
                    imageUploadStarted = true;
                    if (!auth || !auth.currentUser) throw new Error('يجب تسجيل الدخول قبل رفع الصورة.');
                    imageUploadButton.disabled = true;
                    imageUrlInput.disabled = true;
                    imageUploadStatus.textContent = 'جارٍ تحميل إعدادات Cloudinary...';
                    var settingsSnapshot = await db.collection('settings').doc('cloudinary').get();
                    if (modal.hidden || !pendingCompressedImage) return;
                    var settingsData = settingsSnapshot.exists ? settingsSnapshot.data() : {};
                    var config = {
                        cloudName: settingsData && typeof settingsData.cloudName === 'string' ? settingsData.cloudName.trim() : '',
                        uploadPreset: settingsData && typeof settingsData.uploadPreset === 'string' ? settingsData.uploadPreset.trim() : ''
                    };
                    if (!validCloudinarySettings(config)) throw new Error('إعدادات Cloudinary غير جاهزة. احفظها من إعدادات النظام الأساسية أولًا.');
                    imageUploadStatus.textContent = 'جارٍ رفع الصورة...';
                    var request = uploadProductImage(pendingCompressedImage, config, function (percent) {
                        if (!modal.hidden) imageUploadStatus.textContent = 'جارٍ رفع الصورة... ' + percent + '%';
                    });
                    modal._abortImageUpload = request.abort;
                    uploadedPendingImageUrl = await request.promise;
                    modal._abortImageUpload = null;
                    imageUrl = uploadedPendingImageUrl;
                    imageUploadStatus.textContent = 'تم رفع الصورة؛ جارٍ حفظ بيانات المنتج...';
                } else if (pendingCompressedImage && uploadedPendingImageUrl) {
                    imageUploadStatus.textContent = 'تم رفع الصورة مسبقًا؛ جارٍ حفظ بيانات المنتج...';
                }
                var images = Array.isArray(item && item.images) ? item.images.map(function (image) { return image && typeof image === 'object' ? Object.assign({}, image) : image; }) : [];
                if (imageUrl) {
                    var primaryIndex = images.findIndex(function (image) { return image && image.isPrimary; });
                    if (primaryIndex === -1) primaryIndex = images.findIndex(function (image) { return image && typeof image === 'object' && image.url; });
                    if (primaryIndex === -1) primaryIndex = images.findIndex(function (image) { return typeof image === 'string' && image.trim(); });
                    if (primaryIndex !== -1 && typeof images[primaryIndex] === 'object') images[primaryIndex].url = imageUrl;
                    else if (primaryIndex !== -1) images[primaryIndex] = { url: imageUrl, isPrimary: true };
                    else images.unshift({ url: imageUrl, isPrimary: true });
                    var primaryImageIndex = primaryIndex === -1 ? 0 : primaryIndex;
                    images.forEach(function (image, index) { if (image && typeof image === 'object') image.isPrimary = index === primaryImageIndex; });
                } else {
                    images = [];
                }
                var categoryId = modal.querySelector('#adminProductCategoryId').value;
                var selectedCategory = categories.find(function (entry) { return entry.id === categoryId; });
                var categoryName = selectedCategory ? selectedCategory.name : (item && item.categoryId === categoryId ? item.categoryName || '' : '');
                var productData = { name: name, location: location, categoryId: categoryId || null, categoryName: categoryName, images: images, purchasePrice: purchasePrice, salePrice: salePrice, mechanicPrice: mechanicPriceValue, quantity: quantity, updatedAt: Date.now() };
                if (isCreate) {
                    productData.createdAt = Date.now();
                    var created = await db.collection('items').add(productData);
                    items.push(Object.assign({ id: created.id }, productData));
                } else {
                    await db.collection('items').doc(itemId).update(productData);
                    item.name = name;
                    item.location = location;
                    item.images = images;
                    item.purchasePrice = purchasePrice;
                    item.salePrice = salePrice;
                    item.mechanicPrice = mechanicPriceValue;
                    item.quantity = quantity;
                }
                saveCache();
                if (pendingCompressedImage) imageUrlInput.value = uploadedPendingImageUrl;
                if (discardPendingImage) discardPendingImage();
                modal.hidden = true;
                saveUiState();
                renderProducts();
                notify(isCreate ? 'تم إنشاء المنتج' : 'تم تحديث بيانات المنتج');
                if (modal.dataset.showImageAfterSave === 'true' && imageUrl) {
                    var imageModal = ensureProductImageModal();
                    imageModal.dataset.itemId = itemId || (created && created.id) || '';
                    imageModal.querySelector('.product-image-replace').hidden = !imageModal.dataset.itemId;
                    imageModal.querySelector('img').src = imageUrl;
                    imageModal.querySelector('img').alt = name || 'صورة المنتج';
                    imageModal.hidden = false;
                }
                modal.dataset.showImageAfterSave = 'false';
            } catch (updateError) {
                if (modal.hidden) return;
                if (pendingCompressedImage && uploadedPendingImageUrl) {
                    error.textContent = 'تم رفع الصورة لكن تعذر حفظ المنتج. اضغط حفظ للمحاولة مجددًا؛ لن يعاد رفع الصورة.';
                    imageUploadStatus.textContent = 'تم رفع الصورة، وتعذر حفظ بيانات المنتج. يمكنك إعادة المحاولة.';
                } else if (imageUploadStarted) {
                    error.textContent = updateError.message || 'تعذر رفع الصورة إلى Cloudinary؛ لم يتم حفظ المنتج.';
                    imageUploadStatus.textContent = error.textContent;
                } else {
                    error.textContent = isCreate ? 'تعذر إنشاء المنتج حاليًا' : 'تعذر حفظ بيانات المنتج حاليًا';
                }
                console.error(updateError);
            } finally {
                modal._abortImageUpload = null;
                imageUploadButton.disabled = false;
                imageUrlInput.disabled = false;
                if (!modal.hidden) save.disabled = false;
            }
        });
        return modal;
    }

    function updateAdminProfitLabels(modal) {
        var purchase = number(modal.querySelector('#adminPurchasePrice').value);
        if (modal.dataset.purchaseCurrency === 'secondary') purchase = purchase === null ? null : primary(purchase);
        ['sale', 'mechanic'].forEach(function (field) {
            var value = number(modal.querySelector('#admin' + field.charAt(0).toUpperCase() + field.slice(1) + 'Price').value);
            if (modal.dataset[field + 'Currency'] === 'secondary') value = value === null ? null : primary(value);
            var label = modal.querySelector('[data-profit-for="admin' + field.charAt(0).toUpperCase() + field.slice(1) + 'Price"]');
            if (purchase === null || value === null || purchase <= 0) { label.textContent = ' —'; label.classList.remove('negative-profit'); return; }
            var percent = Math.round(((value - purchase) / purchase) * 100);
            label.textContent = ' ' + (percent < 0 ? '-' : '') + money(Math.abs(percent)) + '%';
            label.classList.toggle('negative-profit', percent < 0);
        });
    }

    function openLocationEdit(item) {
        var modal = ensureLocationEditModal();
        if (modal._resetPendingImage) modal._resetPendingImage();
        modal.dataset.showImageAfterSave = 'false';
        var content = modal.querySelector('.location-edit-content');
        modal.querySelector('.admin-image-upload-button').disabled = false;
        modal.querySelector('#imageUrlEditInput').disabled = false;
        modal.querySelector('.location-edit-save').disabled = false;
        modal.dataset.mode = 'edit';
        modal.dataset.itemId = item.id;
        modal.querySelector('.location-edit-actions').classList.remove('is-create');
        modal.querySelector('.location-edit-delete').hidden = false;
        modal.querySelector('.location-edit-cancel').hidden = false;
        modal.querySelector('.location-edit-save').hidden = false;
        modal.querySelector('.location-edit-delete-cancel').hidden = true;
        modal.querySelector('.location-edit-delete-confirm').hidden = true;
        modal.querySelector('.location-edit-actions').classList.remove('is-confirming-delete');
        modal.querySelector('#locationEditEyebrow').hidden = false;
        modal.querySelector('#locationEditTitle').hidden = true;
        modal.querySelector('#locationEditEyebrow').textContent = 'تعديل بيانات المنتج';
        modal.querySelector('#locationEditTitle').textContent = 'تعديل المنتج';
        modal.querySelector('.location-edit-save').textContent = 'حفظ';
        modal.querySelector('#locationEditProduct').textContent = item.name || 'منتج';
        modal.querySelector('#locationEditProduct').hidden = true;
        modal.querySelector('#adminProductName').value = item.name || '';
        modal.querySelector('#locationEditInput').value = item.location || '';
        renderAdminProductCategorySelect(item.categoryId || '');
        var primaryImage = Array.isArray(item.images) ? (item.images.find(function (image) { return image && image.isPrimary; }) || item.images.find(function (image) { return image && typeof image === 'object' && image.url; }) || item.images.find(function (image) { return typeof image === 'string' && image.trim(); })) : null;
        modal.querySelector('#imageUrlEditInput').value = normalizeImageUrl(typeof primaryImage === 'string' ? primaryImage : primaryImage && primaryImage.url);
        modal.querySelector('#imageUrlEditInput').dispatchEvent(new Event('input'));
        modal.querySelector('.admin-image-upload-status').textContent = '';
        modal.querySelector('.admin-image-file-input').value = '';
        modal.dataset.purchaseCurrency = 'primary';
        modal._purchasePriceEdited = false;
        modal.dataset.saleCurrency = 'secondary';
        modal.dataset.mechanicCurrency = 'secondary';
        var purchasePrice = number(item.purchasePrice);
        modal.querySelector('#adminPurchasePrice').value = purchasePrice === null ? 0 : purchasePrice.toFixed(2);
        modal.querySelector('#adminSalePrice').value = productSecondary(number(item.salePrice) || 0);
        modal.querySelector('#adminMechanicPrice').value = productSecondary(number(mechanicPrice(item)) || 0);
        modal.querySelector('#adminPurchaseCurrencyLabel').textContent = '$';
        modal.querySelector('#adminSaleCurrencyLabel').textContent = currency.secondaryCurrencySymbol;
        modal.querySelector('#adminMechanicCurrencyLabel').textContent = currency.secondaryCurrencySymbol;
        modal.querySelector('#adminQuantity').value = number(item.quantity) || 0;
        updateAdminProfitLabels(modal);
        modal.querySelector('#locationEditError').textContent = '';
        modal.hidden = false;
        requestAnimationFrame(function () {
            content.style.top = '';
            content.style.left = '';
        });
    }

    function openNewProduct() {
        var modal = ensureLocationEditModal();
        if (modal._resetPendingImage) modal._resetPendingImage();
        modal.dataset.showImageAfterSave = 'false';
        modal.querySelector('.admin-image-upload-button').disabled = false;
        modal.querySelector('#imageUrlEditInput').disabled = false;
        modal.querySelector('.location-edit-save').disabled = false;
        modal.dataset.mode = 'create';
        modal.dataset.itemId = '';
        modal.querySelector('.location-edit-actions').classList.add('is-create');
        modal.querySelector('.location-edit-delete').hidden = true;
        modal.querySelector('.location-edit-cancel').hidden = false;
        modal.querySelector('.location-edit-save').hidden = false;
        modal.querySelector('.location-edit-delete-cancel').hidden = true;
        modal.querySelector('.location-edit-delete-confirm').hidden = true;
        modal.querySelector('.location-edit-actions').classList.remove('is-confirming-delete');
        modal.querySelector('#locationEditEyebrow').hidden = true;
        modal.querySelector('#locationEditEyebrow').textContent = 'إضافة منتج';
        modal.querySelector('#locationEditTitle').textContent = 'إضافة منتج';
        modal.querySelector('#locationEditTitle').hidden = false;
        modal.querySelector('#locationEditProduct').textContent = '';
        modal.querySelector('#locationEditProduct').hidden = true;
        modal.querySelector('.location-edit-save').textContent = 'إضافة';
        modal.querySelector('#adminProductName').value = '';
        modal.querySelector('#locationEditInput').value = '';
        renderAdminProductCategorySelect('');
        modal.querySelector('#imageUrlEditInput').value = '';
        modal.querySelector('#imageUrlEditInput').dispatchEvent(new Event('input'));
        modal.querySelector('.admin-image-upload-status').textContent = '';
        modal.querySelector('.admin-image-file-input').value = '';
        modal.dataset.purchaseCurrency = 'primary';
        modal.dataset.saleCurrency = 'secondary';
        modal.dataset.mechanicCurrency = 'secondary';
        modal.querySelector('#adminPurchasePrice').value = '';
        modal._purchasePriceEdited = false;
        modal.querySelector('#adminSalePrice').value = '';
        modal.querySelector('#adminMechanicPrice').value = '';
        modal.querySelector('#adminQuantity').value = '';
        modal.querySelector('#adminPurchaseCurrencyLabel').textContent = '$';
        modal.querySelector('#adminSaleCurrencyLabel').textContent = currency.secondaryCurrencySymbol;
        modal.querySelector('#adminMechanicCurrencyLabel').textContent = currency.secondaryCurrencySymbol;
        modal.querySelector('#locationEditError').textContent = '';
        updateAdminProfitLabels(modal);
        modal.hidden = false;
        requestAnimationFrame(function () {});
    }

    function notify(message) {
        var el = $('toast'); el.textContent = message; el.classList.add('show');
        clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
    }

    function sortedAdminCategories() {
        return categories.slice().sort(function (a, b) {
            return String(a.name || '').localeCompare(String(b.name || ''), 'ar', { sensitivity: 'base' });
        });
    }

    function appendCategoryIcon(container, iconClass) {
        var icon = document.createElement('i');
        icon.className = /^[a-zA-Z0-9 _-]{1,100}$/.test(iconClass || '') ? iconClass : 'fas fa-tag';
        icon.setAttribute('aria-hidden', 'true');
        container.appendChild(icon);
    }

    function renderAdminProductCategorySelect(selectedId) {
        var select = $('adminProductCategoryId');
        if (!select) return;
        var selectedCategoryId = selectedId === undefined ? select.value : String(selectedId || '');
        select.replaceChildren();
        var noCategory = document.createElement('option');
        noCategory.value = '';
        noCategory.textContent = '-- بدون فئة --';
        select.appendChild(noCategory);
        sortedAdminCategories().forEach(function (category) {
            var option = document.createElement('option');
            option.value = category.id;
            option.textContent = category.name || 'فئة';
            select.appendChild(option);
        });
        if (selectedCategoryId && !categories.some(function (category) { return category.id === selectedCategoryId; })) {
            var item = items.find(function (entry) { return entry.categoryId === selectedCategoryId; });
            var unavailable = document.createElement('option');
            unavailable.value = selectedCategoryId;
            unavailable.textContent = item && item.categoryName ? item.categoryName : 'فئة غير متاحة';
            select.appendChild(unavailable);
        }
        select.value = selectedCategoryId;
    }

    function renderCategoryProductChecklist(categoryId, containerId, selection, searchValue, allowAssigned) {
        var container = $(containerId);
        if (!container) return;
        container.replaceChildren();
        if (!categoryId && allowAssigned) {
            var emptyChoice = document.createElement('div');
            emptyChoice.className = 'category-products-empty';
            emptyChoice.textContent = 'اختر فئة أولاً';
            container.appendChild(emptyChoice);
            return;
        }
        var search = String(searchValue || '').trim().toLocaleLowerCase();
        var products = items.filter(function (item) {
            var eligible = !item.categoryId || item.categoryId === categoryId;
            return eligible && String(item.name || '').toLocaleLowerCase().includes(search);
        }).sort(compareArabic);
        if (!products.length) {
            var empty = document.createElement('div');
            empty.className = 'category-products-empty';
            empty.textContent = search ? 'لا توجد منتجات مطابقة' : 'لا توجد منتجات غير مصنفة أو ضمن هذه الفئة';
            container.appendChild(empty);
            return;
        }
        products.forEach(function (item) {
            var label = document.createElement('label');
            label.className = 'category-product-option';
            var checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.categoryProductId = item.id;
            checkbox.checked = selection.has(item.id);
            var name = document.createElement('span');
            name.textContent = item.name || 'منتج';
            label.appendChild(checkbox);
            label.appendChild(name);
            container.appendChild(label);
        });
    }

    function renderAdminCategorySettings() {
        var list = $('adminCategoriesList');
        renderAdminProductCategorySelect();
        if (!list || $('settingsModal').hidden) return;
        list.replaceChildren();
        if (!categories.length) {
            var empty = document.createElement('div');
            empty.className = 'admin-category-empty';
            empty.textContent = categoriesLoaded ? 'لا توجد فئات' : 'جارٍ تحميل الفئات...';
            list.appendChild(empty);
        }
        sortedAdminCategories().forEach(function (category) {
            var products = items.filter(function (item) { return item.categoryId === category.id; }).sort(compareArabic);
            var card = document.createElement('article');
            card.className = 'admin-category-card';
            var heading = document.createElement('div');
            heading.className = 'admin-category-heading';
            var icon = document.createElement('span');
            icon.className = 'admin-category-icon';
            appendCategoryIcon(icon, category.icon);
            var name = document.createElement('button');
            name.type = 'button';
            name.className = 'admin-category-name';
            name.dataset.categoryAction = 'edit';
            name.dataset.categoryId = category.id;
            name.setAttribute('aria-label', 'تعديل فئة ' + (category.name || ''));
            name.textContent = category.name || 'فئة';
            var count = document.createElement('span');
            count.className = 'admin-category-count';
            count.textContent = products.length + ' منتج';
            heading.appendChild(icon);
            heading.appendChild(name);
            heading.appendChild(count);
            card.appendChild(heading);
            list.appendChild(card);
        });

        var select = $('manageCategorySelect');
        var selectedId = managedCategoryId || select.value;
        select.replaceChildren();
        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'اختر فئة';
        select.appendChild(placeholder);
        sortedAdminCategories().forEach(function (category) {
            var option = document.createElement('option');
            option.value = category.id;
            option.textContent = category.name || 'فئة';
            select.appendChild(option);
        });
        select.value = selectedId;
        if (select.value !== selectedId) {
            managedCategoryId = '';
            managedCategorySelection = new Set();
        }
        renderCategoryProductChecklist(managedCategoryId, 'manageProductsChecklist', managedCategorySelection, $('manageProductSearch').value, true);
        if (!$('categoryCreateModal').hidden) {
            renderCategoryProductChecklist('', 'newCategoryProductsChecklist', newCategoryProductSelection, $('newCategoryProductSearch').value, false);
        }
    }

    function activateSettingsTab(tab) {
        var tabs = document.querySelectorAll('[data-settings-tab]');
        tabs.forEach(function (button) {
            var active = button === tab;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', String(active));
            button.tabIndex = active ? 0 : -1;
            var panel = $(button.dataset.settingsTab);
            if (panel) panel.hidden = !active;
        });
        if (tab.dataset.settingsTab === 'employeeSettingsPanel') loadEmployeeSearchHistory();
    }

    function activateCategoryTab(tab) {
        var tabs = $('categorySettingsPanel').querySelectorAll('[data-category-tab]');
        tabs.forEach(function (button) {
            var active = button === tab;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', String(active));
            button.tabIndex = active ? 0 : -1;
            var panel = $(button.dataset.categoryTab);
            if (panel) panel.hidden = !active;
        });
    }

    async function createAdminCategory() {
        var name = $('newCategoryName').value.trim();
        var icon = $('newCategoryIcon').value.trim();
        var error = $('categoryCreateError');
        if (!name) {
            error.textContent = 'يرجى إدخال اسم الفئة';
            $('newCategoryName').focus();
            return;
        }
        if (icon && !/^[a-zA-Z0-9 _-]{1,100}$/.test(icon)) {
            error.textContent = 'صيغة الأيقونة غير صالحة';
            return;
        }
        var save = $('saveNewCategory');
        save.disabled = true;
        error.textContent = '';
        var category = { name: name, icon: icon, createdAt: Date.now() };
        var createdCategory = false;
        try {
            var categoryRef = db.collection('categories').doc();
            await categoryRef.set(category);
            createdCategory = true;
            var selectedItems = items.filter(function (item) {
                return newCategoryProductSelection.has(item.id) && !item.categoryId;
            });
            for (var start = 0; start < selectedItems.length; start += 450) {
                var batch = db.batch();
                selectedItems.slice(start, start + 450).forEach(function (item) {
                    batch.update(db.collection('items').doc(item.id), { categoryId: categoryRef.id, categoryName: name });
                });
                await batch.commit();
            }
            var categoryIndex = categories.findIndex(function (entry) { return entry.id === categoryRef.id; });
            var createdCategoryData = Object.assign({ id: categoryRef.id }, category);
            if (categoryIndex === -1) categories.push(createdCategoryData);
            else categories[categoryIndex] = createdCategoryData;
            selectedItems.forEach(function (item) { item.categoryId = categoryRef.id; item.categoryName = name; });
            $('categoryCreateModal').hidden = true;
            $('newCategoryName').value = '';
            $('newCategoryIcon').value = '';
            newCategoryProductSelection = new Set();
            renderAdminCategorySettings();
            notify('تمت إضافة الفئة');
        } catch (errorValue) {
            console.error('Mobile admin category creation failed:', errorValue);
            if (createdCategory) {
                $('categoryCreateModal').hidden = true;
                renderAdminCategorySettings();
                notify('تمت إضافة الفئة، لكن تعذر إسناد بعض المنتجات');
            } else {
                error.textContent = 'تعذر إضافة الفئة حاليًا';
            }
        } finally {
            save.disabled = false;
            if ($('settingsModal').hidden && $('categoryCreateModal').hidden) document.body.style.overflow = '';
        }
    }

    async function saveAdminCategoryProducts() {
        var categoryId = managedCategoryId;
        var category = categories.find(function (entry) { return entry.id === categoryId; });
        var error = $('categoryManageError');
        if (!category) {
            error.textContent = 'اختر فئة أولاً';
            return;
        }
        error.textContent = '';
        var currentProducts = items.filter(function (item) { return item.categoryId === categoryId; });
        var changes = [];
        currentProducts.forEach(function (item) {
            if (!managedCategorySelection.has(item.id)) changes.push({ item: item, categoryId: null, categoryName: '' });
        });
        items.forEach(function (item) {
            if (!item.categoryId && managedCategorySelection.has(item.id)) changes.push({ item: item, categoryId: categoryId, categoryName: category.name });
        });
        if (!changes.length) {
            error.textContent = 'لم يتم تغيير أي منتج';
            return;
        }
        var save = $('saveCategoryProducts');
        save.disabled = true;
        try {
            for (var start = 0; start < changes.length; start += 450) {
                var batch = db.batch();
                changes.slice(start, start + 450).forEach(function (change) {
                    batch.update(db.collection('items').doc(change.item.id), {
                        categoryId: change.categoryId,
                        categoryName: change.categoryName
                    });
                });
                await batch.commit();
            }
            changes.forEach(function (change) {
                change.item.categoryId = change.categoryId;
                change.item.categoryName = change.categoryName;
            });
            managedCategorySelection = new Set(items.filter(function (item) { return item.categoryId === categoryId; }).map(function (item) { return item.id; }));
            renderAdminCategorySettings();
            notify('تم تحديث منتجات الفئة');
        } catch (errorValue) {
            console.error('Mobile admin category assignment failed:', errorValue);
            error.textContent = 'تعذر حفظ منتجات الفئة؛ تحقق من الاتصال ثم أعد المحاولة';
        } finally {
            save.disabled = false;
        }
    }

    function openAdminCategoryEditor(categoryId) {
        var category = categories.find(function (entry) { return entry.id === categoryId; });
        if (!category) return;
        $('categoryEditModal').dataset.categoryId = categoryId;
        $('editCategoryName').value = category.name || '';
        $('editCategoryIcon').value = category.icon || '';
        $('categoryEditError').textContent = '';
        openModal('categoryEditModal');
        $('editCategoryName').focus();
    }

    async function updateAdminCategory() {
        var categoryId = $('categoryEditModal').dataset.categoryId;
        var category = categories.find(function (entry) { return entry.id === categoryId; });
        if (!category) return;
        var name = $('editCategoryName').value.trim();
        var icon = $('editCategoryIcon').value.trim();
        var error = $('categoryEditError');
        if (!name) {
            error.textContent = 'يرجى إدخال اسم الفئة';
            $('editCategoryName').focus();
            return;
        }
        if (icon && !/^[a-zA-Z0-9 _-]{1,100}$/.test(icon)) {
            error.textContent = 'صيغة الأيقونة غير صالحة';
            $('editCategoryIcon').focus();
            return;
        }
        var save = $('saveEditedCategory');
        save.disabled = true;
        error.textContent = '';
        try {
            var updated = { name: name, icon: icon };
            await db.collection('categories').doc(categoryId).update(updated);
            Object.assign(category, updated);
            items.forEach(function (item) {
                if (item.categoryId === categoryId) item.categoryName = updated.name;
            });
            renderAdminCategorySettings();
            saveCache();
            closeModal('categoryEditModal');
            notify('تم تحديث الفئة');
        } catch (errorValue) {
            console.error('Mobile admin category update failed:', errorValue);
            error.textContent = 'تعذر تحديث الفئة حاليًا';
        } finally {
            save.disabled = false;
        }
    }

    async function deleteAdminCategory(categoryId) {
        var category = categories.find(function (entry) { return entry.id === categoryId; });
        if (!category || !confirm('حذف الفئة "' + category.name + '"؟ ستبقى المنتجات دون فئة.')) return;
        var assignedItems = items.filter(function (item) { return item.categoryId === categoryId; });
        try {
            for (var start = 0; start < assignedItems.length; start += 450) {
                var batch = db.batch();
                assignedItems.slice(start, start + 450).forEach(function (item) {
                    batch.update(db.collection('items').doc(item.id), { categoryId: null, categoryName: '' });
                });
                await batch.commit();
            }
            await db.collection('categories').doc(categoryId).delete();
            assignedItems.forEach(function (item) { item.categoryId = null; item.categoryName = ''; });
            categories = categories.filter(function (entry) { return entry.id !== categoryId; });
            if (managedCategoryId === categoryId) {
                managedCategoryId = '';
                managedCategorySelection = new Set();
            }
            renderAdminCategorySettings();
            saveCache();
            notify('تم حذف الفئة');
            if ($('categoryEditModal').dataset.categoryId === categoryId) closeModal('categoryEditModal');
        } catch (errorValue) {
            console.error('Mobile admin category deletion failed:', errorValue);
            notify('تعذر حذف الفئة أو بعض منتجاتها');
        }
    }

    function mergeDisplayNameMap(source) {
        if (!source || typeof source !== 'object') return {};
        var merged = {};
        if (helpers.flattenNameMap) {
            Object.assign(merged, helpers.flattenNameMap(source));
        } else if (source.emails && typeof source.emails === 'object') {
            Object.assign(merged, source.emails);
        }
        Object.keys(source).forEach(function (key) {
            var value = source[key];
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                if (value.name || value.displayName || value.fullName || value.email || value.userEmail) {
                    var nestedEmail = value.email || value.userEmail || key;
                    if (nestedEmail && (value.name || value.displayName || value.fullName || value.label)) merged[String(nestedEmail).trim().toLowerCase()] = String(value.name || value.displayName || value.fullName || value.label).trim();
                }
            }
        });
        return merged;
    }

    function restoreUserDisplayNameMapCache() {
        try {
            var cached = JSON.parse(localStorage.getItem(USER_DISPLAY_NAMES_CACHE_KEY) || 'null');
            if (cached && cached.map && typeof cached.map === 'object' && !Array.isArray(cached.map)) {
                userDisplayNameMap = cached.map;
                userDisplayNameMapFetchedAt = Number(cached.savedAt) || 0;
            }
        } catch (error) {
            console.warn('Unable to read cached seller names.', error);
        }
    }

    restoreUserDisplayNameMapCache();
    window.xmetalUserDisplayNameMap = userDisplayNameMap;

    function refreshUserDisplayNameMap() {
        if (userDisplayNameMapPromise) return userDisplayNameMapPromise;
        if (userDisplayNameMapFetchedAt && Date.now() - userDisplayNameMapFetchedAt < 60000) {
            return Promise.resolve(userDisplayNameMap);
        }
        var docs = [
            db.collection('settings').doc('userDisplayNames'),
            db.collection('settings').doc('userNames'),
            db.collection('systemSettings').doc('userDisplayNames'),
            db.collection('systemSettings').doc('userNames'),
            db.collection('adminSettings').doc('userDisplayNames')
        ];
        var refresh = Promise.all(docs.map(function (reference) {
            return reference.get().then(function (doc) {
                return doc && doc.exists ? mergeDisplayNameMap(doc.data()) : {};
            }, function () { return {}; });
        })).then(function (maps) {
            var merged = {};
            maps.forEach(function (map) { Object.assign(merged, map); });
            userDisplayNameMap = merged;
            window.xmetalUserDisplayNameMap = merged;
            userDisplayNameMapFetchedAt = Date.now();
            try { localStorage.setItem(USER_DISPLAY_NAMES_CACHE_KEY, JSON.stringify({ map: merged, savedAt: userDisplayNameMapFetchedAt })); }
            catch (error) { console.warn('Unable to cache seller names.', error); }
            return merged;
        });
        userDisplayNameMapPromise = refresh.then(function (map) {
            userDisplayNameMapPromise = null;
            return map;
        }, function (error) {
            userDisplayNameMapPromise = null;
            throw error;
        });
        return userDisplayNameMapPromise;
    }
    window.xmetalRefreshUserDisplayNameMap = refreshUserDisplayNameMap;

    function getCurrentSellerInfo() {
        var currentUser = auth && auth.currentUser ? auth.currentUser : null;
        var email = currentUser && currentUser.email ? String(currentUser.email).trim() : '';
        var fallbackName = currentUser && currentUser.displayName ? String(currentUser.displayName).trim() : '';
        var name = helpers.resolveSellerName ? helpers.resolveSellerName(email, fallbackName, userDisplayNameMap) : (fallbackName || email);
        return { email: email, name: name };
    }

    function getSellerLabel(sale) {
        var email = sale && (sale.sellerEmail || sale.user || sale.email || '');
        var fallbackName = sale && (sale.sellerName || sale.displayName || '');
        if (helpers.resolveSellerName) return helpers.resolveSellerName(email, fallbackName, userDisplayNameMap) || 'غير محدد';
        return fallbackName || email || 'غير محدد';
    }

    function updateCustomScrollbar() {
        var track = $('customScrollbar'), thumb = $('customScrollbarThumb');
        if (!track || !thumb) return;
        var cards = Array.from(document.querySelectorAll('.product-card'));
        if (!cards.length) { track.hidden = true; return; }
        var firstCard = cards[0];
        var lastCard = cards[cards.length - 1];
        var firstRect = firstCard.getBoundingClientRect();
        var lastRect = lastCard.getBoundingClientRect();
        var trackTop = Math.max(74, firstRect.top);
        var trackBottom = Math.min(window.innerHeight - 24, lastRect.bottom);
        var trackHeight = Math.max(58, trackBottom - trackTop);
        track.style.top = trackTop + 'px';
        track.style.height = trackHeight + 'px';
        track.hidden = false;

        var contentStart = firstRect.top + window.scrollY;
        var contentEnd = lastRect.bottom + window.scrollY;
        var contentHeight = Math.max(1, contentEnd - contentStart);
        var viewportHeight = Math.max(1, window.innerHeight - 24);
        if (contentHeight <= viewportHeight + 80) { thumb.style.height = '0px'; thumb.style.transform = 'translateY(0px)'; track.hidden = true; return; }

        var thumbHeight = Math.max(48, Math.min(trackHeight - 8, trackHeight * viewportHeight / contentHeight));
        var scrollRange = Math.max(1, contentHeight - viewportHeight);
        var thumbTop = Math.max(0, Math.min(trackHeight - thumbHeight, ((window.scrollY - contentStart + 24) / scrollRange) * (trackHeight - thumbHeight)));
        thumb.style.height = thumbHeight + 'px';
        thumb.style.transform = 'translateY(' + thumbTop + 'px)';
        track.setAttribute('aria-valuenow', String(Math.round(((window.scrollY - contentStart + 24) / scrollRange) * 100)));
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
            var trackHeight = track.offsetHeight, thumbHeight = thumb.offsetHeight, maxThumbTop = Math.max(0, trackHeight - thumbHeight), nextTop = Math.max(0, Math.min(maxThumbTop, startTop + event.clientY - startY));
            var cards = Array.from(document.querySelectorAll('.product-card'));
            if (!cards.length) return;
            var firstCard = cards[0];
            var lastCard = cards[cards.length - 1];
            var contentStart = firstCard.getBoundingClientRect().top + window.scrollY;
            var contentEnd = lastCard.getBoundingClientRect().bottom + window.scrollY;
            var contentHeight = Math.max(1, contentEnd - contentStart);
            var viewportHeight = Math.max(1, window.innerHeight - 24);
            var scrollRange = Math.max(1, contentHeight - viewportHeight);
            window.scrollTo(0, Math.max(0, contentStart + (nextTop / maxThumbTop) * scrollRange - 24));
        });
        thumb.addEventListener('pointerup', function () { dragging = false; });
        thumb.addEventListener('pointercancel', function () { dragging = false; });
        track.addEventListener('pointerdown', function (event) {
            if (event.target === thumb) return;
            var rect = track.getBoundingClientRect(), target = Math.max(0, Math.min(track.offsetHeight, event.clientY - rect.top)), cards = Array.from(document.querySelectorAll('.product-card'));
            if (!cards.length) return;
            var firstCard = cards[0];
            var lastCard = cards[cards.length - 1];
            var contentStart = firstCard.getBoundingClientRect().top + window.scrollY;
            var contentEnd = lastCard.getBoundingClientRect().bottom + window.scrollY;
            var contentHeight = Math.max(1, contentEnd - contentStart);
            var viewportHeight = Math.max(1, window.innerHeight - 24);
            var scrollRange = Math.max(1, contentHeight - viewportHeight);
            window.scrollTo({ top: Math.max(0, contentStart + (target / track.offsetHeight) * scrollRange - 24), behavior: 'smooth' });
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

    function captureUiState() {
        var values = {};
        document.querySelectorAll('input[id], textarea[id], select[id]').forEach(function (field) {
            if (field.id === 'productSearch' || field.type === 'password' || field.type === 'file' || field.closest('#loginForm')) return;
            values[field.id] = { value: field.value, checked: field.checked };
        });
        var modals = {};
        ['saleModal', 'historyModal', 'priceWarning', 'quantityWarning'].forEach(function (id) {
            var element = $(id);
            if (element) modals[id] = element.hidden;
        });
        var locationModal = $('locationEditModal');
        var locationEdit = locationModal && !locationModal.hidden ? {
            mode: locationModal.dataset.mode,
            itemId: locationModal.dataset.itemId,
            purchasePriceEdited: Boolean(locationModal._purchasePriceEdited),
            purchaseCurrency: locationModal.dataset.purchaseCurrency,
            saleCurrency: locationModal.dataset.saleCurrency,
            mechanicCurrency: locationModal.dataset.mechanicCurrency
        } : null;
        return {
            values: values,
            modals: modals,
            locationEdit: locationEdit,
            inventorySort: inventorySort,
            scrollY: window.scrollY,
            selectedItemId: selectedItem && selectedItem.id || '',
            editingSale: editingSale,
            activeSaleMode: activeSaleMode,
            saleDefaultPrice: saleDefaultPrice,
            salePriceManuallyEdited: salePriceManuallyEdited,
            unusualPriceApproved: unusualPriceApproved,
            historyStartDate: historyStartDate ? historyStartDate.getTime() : null,
            historyHasMore: historyHasMore
        };
    }

    function saveUiState() {
        try {
            localStorage.setItem(UI_STATE_KEY, JSON.stringify(captureUiState()));
        } catch (error) {
            console.warn('Unable to persist mobile admin page state.', error);
        }
    }

    function restoreUiState() {
        if (uiStateRestored) return true;
        if (!pendingUiState) {
            try { pendingUiState = JSON.parse(localStorage.getItem(UI_STATE_KEY) || 'null'); }
            catch (error) { console.warn('Unable to read saved mobile admin page state.', error); }
        }
        var state = pendingUiState;
        if (!state || typeof state !== 'object') {
            uiStateRestored = true;
            return true;
        }
        if (typeof state.inventorySort === 'string') inventorySort = state.inventorySort;
        renderProducts();

        var saleModalOpen = state.modals && state.modals.saleModal === false;
        var item = items.find(function (entry) { return entry.id === state.selectedItemId; });
        var saleToEdit = state.editingSale && (sales.find(function (entry) { return entry.saleId === state.editingSale.saleId; }) || state.editingSale);
        if (saleModalOpen && (state.editingSale ? !items.some(function (entry) { return entry.id === state.editingSale.itemId; }) : !item)) return false;
        if (state.locationEdit) {
            if (state.locationEdit.mode === 'edit') {
                var locationItem = items.find(function (entry) { return entry.id === state.locationEdit.itemId; });
                if (!locationItem) return false;
                openLocationEdit(locationItem);
            } else if (state.locationEdit.mode === 'create') {
                openNewProduct();
            }
        }
        if (saleModalOpen) {
            if (state.editingSale && saleToEdit) openEditSale(saleToEdit);
            else openNewSale(item, state.activeSaleMode === 'mechanic' ? mechanicPrice(item) : item.salePrice, state.activeSaleMode);
        }

        if (state.values && typeof state.values === 'object') {
            Object.keys(state.values).forEach(function (id) {
                var field = $(id), saved = state.values[id];
                if (!field || !saved || id === 'productSearch' || field.closest('#loginForm') || field.type === 'password' || field.type === 'file') return;
                if (id === 'adminPurchasePrice' && state.locationEdit && state.locationEdit.mode === 'edit') {
                    var editModal = $('locationEditModal');
                    var editItem = items.find(function (entry) { return entry.id === state.locationEdit.itemId; });
                    var originalPurchase = editItem ? number(editItem.purchasePrice) : null;
                    var edited = typeof state.locationEdit.purchasePriceEdited === 'boolean'
                        ? state.locationEdit.purchasePriceEdited
                        : number(saved.value) !== originalPurchase;
                    editModal._purchasePriceEdited = edited;
                    if (edited) field.value = saved.value;
                    else if (originalPurchase !== null && state.locationEdit.purchaseCurrency !== 'secondary') field.value = originalPurchase.toFixed(2);
                    else if (number(saved.value) !== null) field.value = number(saved.value).toFixed(2);
                    return;
                }
                if (field.type === 'checkbox' || field.type === 'radio') field.checked = Boolean(saved.checked);
                else if (typeof saved.value === 'string') field.value = saved.value;
            });
        }
        updateSearchClearButton();
        if (state.locationEdit && $('locationEditModal')) {
            var locationModal = $('locationEditModal');
            locationModal.dataset.purchaseCurrency = state.locationEdit.purchaseCurrency || 'primary';
            if (typeof state.locationEdit.purchasePriceEdited === 'boolean') locationModal._purchasePriceEdited = state.locationEdit.purchasePriceEdited;
            locationModal.dataset.saleCurrency = state.locationEdit.saleCurrency || 'secondary';
            locationModal.dataset.mechanicCurrency = state.locationEdit.mechanicCurrency || 'secondary';
            locationModal.querySelector('#adminPurchaseCurrencyLabel').textContent = locationModal.dataset.purchaseCurrency === 'secondary' ? currency.secondaryCurrencySymbol : '$';
            locationModal.querySelector('#adminSaleCurrencyLabel').textContent = locationModal.dataset.saleCurrency === 'secondary' ? currency.secondaryCurrencySymbol : '$';
            locationModal.querySelector('#adminMechanicCurrencyLabel').textContent = locationModal.dataset.mechanicCurrency === 'secondary' ? currency.secondaryCurrencySymbol : '$';
            locationModal.querySelector('#imageUrlEditInput').dispatchEvent(new Event('input'));
            updateAdminProfitLabels(locationModal);
        }
        selectedItem = item || (state.editingSale && items.find(function (entry) { return entry.id === state.editingSale.itemId; })) || selectedItem;
        editingSale = saleToEdit || null;
        activeSaleMode = state.activeSaleMode || activeSaleMode;
        saleDefaultPrice = state.saleDefaultPrice === null || Number.isFinite(Number(state.saleDefaultPrice)) ? state.saleDefaultPrice : saleDefaultPrice;
        salePriceManuallyEdited = Boolean(state.salePriceManuallyEdited);
        unusualPriceApproved = Boolean(state.unusualPriceApproved);
        if (Number.isFinite(Number(state.historyStartDate)) && Number(state.historyStartDate) > 0) historyStartDate = new Date(Number(state.historyStartDate));
        if (typeof state.historyHasMore === 'boolean') historyHasMore = state.historyHasMore;
        if ($('saleModal')) $('saleModal').hidden = !saleModalOpen;
        if (state.modals && state.modals.historyModal === false) {
            renderHistory();
            openModal('historyModal');
        } else if ($('historyModal')) {
            $('historyModal').hidden = true;
        }
        if (state.modals) {
            ['priceWarning', 'quantityWarning'].forEach(function (id) {
                if (typeof state.modals[id] === 'boolean' && $(id)) $(id).hidden = state.modals[id];
            });
        }
        if (saleModalOpen) updateSalePriceGuide();
        var locationOpen = Boolean(state.locationEdit);
        if ($('locationEditModal')) $('locationEditModal').hidden = !locationOpen;
        if ($('saleModal').hidden && $('historyModal').hidden && !locationOpen) document.body.style.overflow = '';
        else document.body.style.overflow = 'hidden';
        var scrollY = Number(state.scrollY);
        if (Number.isFinite(scrollY)) setTimeout(function () { window.scrollTo(0, scrollY); }, 0);
        uiStateRestored = true;
        pendingUiState = null;
        return true;
    }

    function openModal(id) { $(id).hidden = false; document.body.style.overflow = 'hidden'; }
    function closeModal(id) {
        $(id).hidden = true;
        var hasOpenModal = ['saleModal', 'historyModal', 'settingsModal', 'categoryCreateModal', 'categoryEditModal'].some(function (modalId) {
            return !$(modalId).hidden;
        });
        var locationModal = $('locationEditModal');
        if (!hasOpenModal && (!locationModal || locationModal.hidden)) document.body.style.overflow = '';
        saveUiState();
    }

    function mechanicPrice(item) {
        var value = number(item.mechanicPrice);
        return value !== null && value >= 0 ? value : (number(item.salePrice) || 0);
    }

    function profitPercent(cost, price) {
        var purchase = number(cost), sale = number(price);
        if (purchase === null || sale === null || purchase <= 0) return '—';
        var percent = ((sale - purchase) / purchase) * 100;
        return (percent < 0 ? '-' : '') + money(Math.round(Math.abs(percent))) + '%';
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

    function matchesProductFilter(item) {
        var available = (number(item.quantity) || 0) > 0;
        return productFilter === 'all' || (productFilter === 'available' && available) || (productFilter === 'expired' && !available);
    }

    function productCategoryName(item) {
        if (!item.categoryId) return 'فئة غير محددة';
        var category = categories.find(function (entry) { return entry.id === item.categoryId; });
        return category ? (category.name || 'فئة غير محددة') : (item.categoryName || 'فئة غير محددة');
    }

    function renderCategoryFilters() {
        var nav = $('categoryFilters');
        if (!nav) return;
        var previousScrollLeft = nav.scrollLeft;
        if (categoriesLoaded && activeProductCategoryId && (!categories.some(function (category) { return category.id === activeProductCategoryId; }) ||
            (productsLoaded && !items.some(function (item) { return item.categoryId === activeProductCategoryId; })))) {
            activeProductCategoryId = '';
        }
        nav.replaceChildren();
        var allProductsCount = items.filter(matchesProductFilter).length;
        var allProducts = document.createElement('button');
        allProducts.type = 'button';
        allProducts.className = 'category-filter' + (activeProductCategoryId ? '' : ' active');
        allProducts.dataset.categoryFilter = '';
        allProducts.setAttribute('aria-pressed', String(!activeProductCategoryId));
        var allProductsName = document.createElement('span');
        allProductsName.className = 'category-filter-name';
        allProductsName.textContent = 'الكل';
        var allProductsCountElement = document.createElement('span');
        allProductsCountElement.className = 'category-filter-count';
        allProductsCountElement.textContent = String(allProductsCount);
        allProducts.appendChild(allProductsName);
        allProducts.appendChild(allProductsCountElement);
        nav.appendChild(allProducts);

        categories.filter(function (category) {
            return items.some(function (item) { return item.categoryId === category.id; });
        }).sort(compareArabic).forEach(function (category) {
            var count = items.filter(function (item) {
                return item.categoryId === category.id && matchesProductFilter(item);
            }).length;
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'category-filter' + (activeProductCategoryId === category.id ? ' active' : '');
            button.dataset.categoryFilter = category.id;
            button.setAttribute('aria-pressed', String(activeProductCategoryId === category.id));
            var name = document.createElement('span');
            name.className = 'category-filter-name';
            name.textContent = category.name || 'فئة';
            var countElement = document.createElement('span');
            countElement.className = 'category-filter-count';
            countElement.textContent = String(count);
            button.appendChild(name);
            button.appendChild(countElement);
            nav.appendChild(button);
        });
        nav.scrollLeft = previousScrollLeft;
    }

    function filterAndSortProducts(term) {
        var searchTerm = String(term || '').trim(), normalizedSearchTerm = searchTerm.toLocaleLowerCase();
        var source = (Array.isArray(items) ? items : []).filter(function (item) {
            return matchesProductFilter(item) && (searchTerm || !activeProductCategoryId || item.categoryId === activeProductCategoryId);
        });
        if (searchTerm) {
            var searched = source.filter(function (item) { return String(item.name || '').toLocaleLowerCase().includes(normalizedSearchTerm); });
            searched.forEach(function (item) {
                item._searchPriority = 3;
                var normalizedName = String(item.name || '').toLocaleLowerCase();
                if (normalizedName.startsWith(normalizedSearchTerm)) item._searchPriority = 1;
                else if (normalizedName.split(/\s+/).some(function (word) { return word.startsWith(normalizedSearchTerm); })) item._searchPriority = 2;
            });
            searched.sort(function (a, b) { return a._searchPriority - b._searchPriority || compareInventoryItems(a, b); });
            searched.forEach(function (item) { delete item._searchPriority; });
            return searched;
        }
        return source.sort(compareInventoryItems);
    }

    function updateProductFilterCounts() {
        var all = Array.isArray(items) ? items : [];
        var counts = {
            all: all.length,
            available: all.filter(function (item) { return (number(item.quantity) || 0) > 0; }).length,
            expired: all.filter(function (item) { return (number(item.quantity) || 0) <= 0; }).length
        };
        document.querySelectorAll('[data-filter-count]').forEach(function (element) { element.textContent = counts[element.dataset.filterCount] || 0; });
        document.querySelectorAll('[data-product-filter]').forEach(function (button) { button.classList.toggle('active', button.dataset.productFilter === productFilter); });
        renderCategoryFilters();
    }

    function updateSearchSummary(searchTerm, visibleCount) {
        var summary = $('searchSummary'), term = String(searchTerm || '').trim();
        if (!summary) return;
        if (!term) { summary.hidden = true; summary.textContent = ''; return; }
        var filterNames = { all: 'كل المنتجات', available: 'المتوفر', expired: 'المنتهية' }, filterName = filterNames[productFilter] || filterNames.available;
        var highlightedTerm = '<span class="search-summary-term">"' + highlightMatches(term, term) + '"</span>';
        summary.hidden = false;
        summary.innerHTML = visibleCount
            ? 'نتائج البحث عن ' + highlightedTerm + ' في ' + filterName + ': ' + visibleCount + ' منتجات'
            : (productFilter === 'all'
                ? 'لم نجد منتجات مطابقة لـ ' + highlightedTerm + '.'
                : 'لم نجد منتجات مطابقة لـ ' + highlightedTerm + ' في ' + filterName + '.<br><span class="search-summary-hint">جرّب تغيير الفلتر إلى "كل المنتجات".</span>');
    }

    function renderProducts() {
        var searchTerm = $('productSearch').value, visible = filterAndSortProducts(searchTerm);
        updateProductFilterCounts();
        updateSearchSummary(searchTerm, visible.length);
        $('productsEmpty').hidden = visible.length !== 0;
        var visibleIds = new Set(visible.map(function (item) { return item.id; }));
        productElements.forEach(function (element, id) {
            if (!visibleIds.has(id)) {
                clearTimeout(element._mechanicPriceRevealTimer);
                clearTimeout(element._purchasePriceRevealTimer);
                element._mechanicPriceRevealTimer = null;
                element._purchasePriceRevealTimer = null;
                element.classList.add('mechanic-price-obscured', 'purchase-price-obscured');
                element.remove();
            }
        });
        visible.forEach(function (item, index) {
            var stock = number(item.quantity) || 0, categoryName = productCategoryName(item), purchaseInSecondary = currency.defaultInputCurrency === 'secondary', purchaseSymbol = purchaseInSecondary ? currency.secondaryCurrencySymbol : '$', purchaseDisplay = purchaseInSecondary ? secondary(item.purchasePrice) : item.purchasePrice, signature = JSON.stringify([item.name, categoryName, stock, item.purchasePrice, item.salePrice, mechanicPrice(item), currency.defaultInputCurrency, currency.secondaryCurrencySymbol, currency.exchangeRate, item.location, $('productSearch').value, Array.isArray(item.images) ? item.images.map(function (img) { return img && img.url ? img.url : ''; }).join('|') : '']);
            var element = productElements.get(item.id);
            if (!element) { element = document.createElement('article'); element.className = 'product-card mechanic-price-obscured purchase-price-obscured'; element.dataset.productId = item.id; productElements.set(item.id, element); }
            element.classList.toggle('expired-product', stock <= 0);
            if (element.dataset.signature !== signature) {
                clearTimeout(element._mechanicPriceRevealTimer);
                clearTimeout(element._purchasePriceRevealTimer);
                element._mechanicPriceRevealTimer = null;
                element._purchasePriceRevealTimer = null;
                element.classList.add('mechanic-price-obscured', 'purchase-price-obscured');
                var productImages = Array.isArray(item.images) ? item.images.filter(function (img) { return img && typeof img.url === 'string' && img.url.trim(); }) : [];
                var primaryImage = productImages.find(function (img) { return img.isPrimary; }) || productImages[0] || null;
                element.dataset.signature = signature;
                element.innerHTML =
                '<span class="product-card-number" aria-hidden="true"></span>' +
                (primaryImage ? '<button class="product-thumb" type="button" data-image-view="' + esc(item.id) + '" aria-label="عرض صورة المنتج"><img src="' + esc(primaryImage.url) + '" alt="' + esc(item.name || 'صورة المنتج') + '"></button>' : '<button class="product-thumb placeholder" type="button" data-image-replace="' + esc(item.id) + '" aria-label="إضافة صورة للمنتج"><span>XM</span></button>') +
                '<div class="product-title-group"><h2 class="product-name product-edit-trigger" role="button" tabindex="0" data-edit-product="' + esc(item.id) + '">' + highlightMatches(item.name || 'منتج', $('productSearch').value) + '</h2><p class="product-category">' + esc(categoryName) + '</p></div>' +
                '<p class="stock"><span><span class="stock-label">المتوفر:</span> (<strong>' + money(stock) + '</strong>)</span><span class="stock-divider">|</span><span>(<button class="location-label location-edit-trigger" type="button" data-edit-location="' + esc(item.id) + '">مكان القطعة:</button> <strong class="location-value">' + esc(item.location && String(item.location).trim() ? item.location : 'غير محدد') + '</strong>)</span></p>' +
                '<div class="prices">' +
                '<button class="price-line purchase-price" type="button" aria-label="إظهار سعر الشراء" aria-pressed="false"><span>شراء</span><strong class="sensitive-price">' + price(purchaseDisplay) + ' ' + esc(purchaseSymbol) + '</strong></button>' +
                '<button class="price-line price-action base-price" type="button" data-sell-item="' + esc(item.id) + '" data-sell-price="' + esc(item.salePrice) + '" data-sell-mode="base" ' + (stock <= 0 ? 'disabled' : '') + '><span class="price-label-with-profit"><small class="' + (number(item.purchasePrice) > 0 && number(item.salePrice) < number(item.purchasePrice) ? 'negative-profit' : '') + '">' + profitPercent(item.purchasePrice, item.salePrice) + '</small><span>زبون</span></span><strong>' + price(productSecondary(item.salePrice)) + ' ' + esc(currency.secondaryCurrencySymbol) + '</strong></button>' +
                '<button class="price-line price-action mechanic-price" type="button" data-sell-item="' + esc(item.id) + '" data-sell-price="' + esc(mechanicPrice(item)) + '" data-sell-mode="mechanic" ' + (stock <= 0 ? 'disabled' : '') + '><span class="price-label-with-profit"><small class="' + (number(item.purchasePrice) > 0 && number(mechanicPrice(item)) < number(item.purchasePrice) ? 'negative-profit' : '') + '">' + profitPercent(item.purchasePrice, mechanicPrice(item)) + '</small><span>ميكانيكي</span></span><strong>' + price(productSecondary(mechanicPrice(item))) + ' ' + esc(currency.secondaryCurrencySymbol) + '</strong></button>' +
                '</div>';
            }
            var cardNumber = element.querySelector('.product-card-number');
            cardNumber.textContent = String(index + 1);
            var purchasePriceButton = element.querySelector('.purchase-price');
            var purchasePriceObscured = element.classList.contains('purchase-price-obscured');
            purchasePriceButton.setAttribute('aria-pressed', purchasePriceObscured ? 'false' : 'true');
            purchasePriceButton.setAttribute('aria-label', purchasePriceObscured ? 'إظهار سعر الشراء' : 'إخفاء سعر الشراء');
            $('productsGrid').appendChild(element);
        });
    }

    function scrollToProductsTop() {
        requestAnimationFrame(function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
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
            var buttonValue = Number(button.dataset.quickQuantity);
            button.classList.toggle('selected', quantity !== null && Math.abs(quantity - buttonValue) < 0.0001);
        });
    }

    function updateQuickQuantityButtons() {
        var available = selectedItem ? Number(selectedItem.quantity) || 0 : 0;
        var maxQuick = Math.min(10, available || 0);
        document.querySelectorAll('[data-quick-quantity]').forEach(function (button) {
            var buttonValue = Number(button.dataset.quickQuantity);
            var visible = Number.isFinite(buttonValue) && buttonValue > 0 && buttonValue <= maxQuick;
            button.hidden = !visible;
            button.disabled = !visible;
            button.title = visible ? 'بيع بسرعة ' + buttonValue : 'غير متاح في المخزون الحالي';
            button.setAttribute('aria-disabled', visible ? 'false' : 'true');
            if (!visible) button.classList.remove('selected');
        });
    }

    function updateAvailableStock(item) {
        var available = item ? number(item.quantity) : null;
        $('availableStock').textContent = available === null ? '' : 'المتوفر في المخزون: ' + money(available);
        updateQuickQuantityButtons();
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
            var defaultPrice = saleDefaultPrice === null ? productSecondary(selectedItem.salePrice) : saleDefaultPrice;
            $('salePrice').value = Number((defaultPrice * quantity).toFixed(2));
        }
        var total = number($('salePrice').value) || 0;
        var unit = quantity > 0 ? total / quantity : 0;
        $('saleUnitPrice').value = price(unit) + ' ' + currency.secondaryCurrencySymbol;
        $('calculatedTotal').textContent = 'الإجمالي: ' + price(total) + ' ' + currency.secondaryCurrencySymbol;
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
        return (info.level === 'danger' ? '⚠ ' : 'ⓘ ') + 'سعر القطعة المحسوب ' + info.direction + ' من ' + referenceName + ' بنسبة ' + money(info.percent) + '%.' + ' السعر المرجعي: ' + price(productSecondary(info.reference)) + ' ' + currency.secondaryCurrencySymbol;
    }

    function upsertSaleLocally(sale) {
        if (!sale || !sale.saleId) return;
        var index = sales.findIndex(function (entry) { return entry.saleId === sale.saleId; });
        if (index === -1) sales.push(sale);
        else sales[index] = Object.assign({}, sales[index], sale);
    }

    function makeMobileSaleId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return 'sale_' + window.crypto.randomUUID();
        return 'sale_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    }

    function readPendingSalesQueue() {
        try {
            var raw = localStorage.getItem('xmetal_mobile_sales_pending_v1');
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function writePendingSalesQueue(queue) {
        try {
            localStorage.setItem('xmetal_mobile_sales_pending_v1', JSON.stringify(queue));
        } catch (error) {
            console.warn('Unable to persist mobile-sales pending queue', error);
        }
    }

    function queueMobileSaleOperation(op, sale) {
        if (!sale || !sale.saleId) return;
        var queue = readPendingSalesQueue();
        var entry = { op: op, saleId: sale.saleId, payload: JSON.parse(JSON.stringify(sale)), queuedAt: Date.now(), status: 'pending' };
        var existingIndex = queue.findIndex(function (item) { return item.saleId === sale.saleId && item.op === op; });
        if (existingIndex >= 0) queue[existingIndex] = entry;
        else queue.push(entry);
        writePendingSalesQueue(queue);
    }

    async function flushPendingSalesQueue() {
        if (!db || !navigator.onLine) return;
        var queue = readPendingSalesQueue();
        if (!queue.length) return;
        var remaining = [];
        for (var i = 0; i < queue.length; i++) {
            var entry = queue[i];
            if (!entry || !entry.saleId || !entry.op) continue;
            try {
                if (entry.op === 'create') {
                    await db.collection('sales').doc(entry.saleId).set(sanitizeFirestoreData(entry.payload));
                    await logMobileActivity('sell', entry.payload || { saleId: entry.saleId });
                } else if (entry.op === 'update') {
                    await db.collection('sales').doc(entry.saleId).set(sanitizeFirestoreData(entry.payload), { merge: true });
                    await logMobileActivity('update', entry.payload || { saleId: entry.saleId });
                } else if (entry.op === 'delete') {
                    await db.collection('sales').doc(entry.saleId).delete();
                    await logMobileActivity('cancel', entry.payload || { saleId: entry.saleId });
                }
            } catch (error) {
                console.warn('Pending mobile sale redo failed', error);
                remaining.push(entry);
            }
        }
        writePendingSalesQueue(remaining);
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
        selectedItem = item; editingSale = null; activeSaleMode = mode === 'mechanic' ? 'mechanic' : 'base'; var selectedPrice = number(defaultPricePrimary); saleDefaultPrice = productSecondary(selectedPrice === null ? item.salePrice : selectedPrice); resetSaleForm();
        $('saleModal').classList.toggle('base-price-mode', mode === 'base');
        $('saleModal').classList.toggle('mechanic-price-mode', mode === 'mechanic');
        $('saleModalEyebrow').textContent = mode === 'mechanic' ? 'تسجيل بيع لميكانيكي' : 'تسجيل بيع';
        $('saleModalTitle').textContent = mode === 'mechanic' ? 'بيع منتج وفق سعر الميكانيكي' : 'بيع منتج وفق السعر الأساسي'; $('saleProductName').textContent = item.name || 'منتج';
        updateAvailableStock(item);
        $('saleQuantity').max = Number(item.quantity) || 0;
        $('saleCurrencyLabel').textContent = '(' + currency.secondaryCurrencySymbol + ')';
        $('saleForm').querySelector('button[type="submit"]').textContent = 'تأكيد البيع';
        updateSalePriceGuide();
        openModal('saleModal');
    }

    function openEditSale(sale) {
        var item = items.find(function (entry) { return entry.id === sale.itemId; });
        if (!item) return notify('المنتج غير موجود');
        selectedItem = item; editingSale = sale; activeSaleMode = null; saleDefaultPrice = null; resetSaleForm();
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

    function historyQuery(startDate, endDate) {
        return db.collection('sales').where('source', '==', SOURCE).where('timestamp', '>=', startDate.getTime()).where('timestamp', '<', endDate.getTime()).orderBy('timestamp', 'desc');
    }

    function salesFromSnapshot(snap) {
        return uniqueSales(snap.docs.map(function (doc) { return Object.assign({ saleId: doc.id }, doc.data()); }));
    }

    async function loadOlderSales() {
        if (historyLoading || !historyStartDate) return;
        historyLoading = true;
        var button = $('loadMoreSales');
        if (button) { button.disabled = true; button.textContent = 'جاري تحميل الأقدم...'; }
        var endDate = historyStartDate, startDate = addDays(endDate, -2);
        try {
            var snap = await historyQuery(startDate, endDate).get();
            var olderSales = salesFromSnapshot(snap);
            sales = uniqueSales(sales.concat(olderSales));
            historyStartDate = startDate;
            if (!olderSales.length) historyHasMore = false;
            saveCache();
            renderHistory();
        } catch (error) {
            notify('تعذر تحميل المبيعات الأقدم');
            if (button) { button.disabled = false; button.textContent = 'عرض المزيد'; }
        } finally { historyLoading = false; }
    }

    function renderHistory() {
        try {
        Promise.resolve(refreshUserDisplayNameMap()).catch(function () {});
        var ordered = (Array.isArray(sales) ? sales : []).slice().sort(function (a, b) { return timestampValue(b.timestamp) - timestampValue(a.timestamp); });
        var dayStats = {};
        ordered.forEach(function (sale) {
            var key = dayKey(sale.timestamp);
            if (!dayStats[key]) dayStats[key] = { count: 0, total: 0 };
            dayStats[key].count += 1;
            dayStats[key].total += secondary((Number(sale.unitPrice) || 0) * (Number(sale.quantity) || 0));
        });
        var todayTotal = dayStats[dayKey(Date.now())] ? dayStats[dayKey(Date.now())].total : 0;
        window.xmetalDailySalesTotal = todayTotal;
        window.dispatchEvent(new CustomEvent('xmetal:daily-sales-total', { detail: { total: todayTotal } }));
        var shown = ordered, previousDay = null, dayNumber = 0, html = '';
        shown.forEach(function (sale) {
            var currentDay = dayKey(sale.timestamp);
            if (currentDay !== previousDay) {
                dayNumber = dayStats[currentDay].count;
                html += '<div class="history-day"><strong>' + esc(dayLabel(sale.timestamp)) + '</strong><span class="day-total">إجمالي مبيعات اليوم: ' + price(dayStats[currentDay].total) + ' ' + esc(currency.secondaryCurrencySymbol) + '</span></div>';
                previousDay = currentDay;
            }
            var warningBadge = sale.priceWarningLevel && sale.priceWarningLevel !== 'none' ? '<button type="button" class="warning-badge ' + esc(sale.priceWarningLevel) + '" data-warning-sale="' + esc(sale.saleId) + '" aria-label="عرض سبب التنبيه">!</button>' : '';
            var sellerLabel = getSellerLabel(sale);
            var saleModeClass = sale.saleMode === 'base' ? ' sale-mode-base' : (sale.saleMode === 'mechanic' ? ' sale-mode-mechanic' : '');
            html += '<article class="sale-record' + saleModeClass + (sale.priceWarningLevel && sale.priceWarningLevel !== 'none' ? ' has-price-warning ' + esc(sale.priceWarningLevel) : '') + '"><div class="sale-number" aria-label="رقم العملية">' + dayNumber + '</div><h3>' + esc(sale.itemName || 'منتج') + warningBadge + '</h3>' +
                '<div class="sale-meta"><span>' + esc(date(sale.timestamp)) + '</span><span>البائع: ' + esc(sellerLabel) + '</span><span>الكمية: ' + money(sale.quantity) + '</span></div>' +
                '<p class="sale-total">سعر القطعة: <span class="sale-unit-value">' + price(secondary(sale.unitPrice)) + '</span> × الكمية: <span class="sale-quantity-value">' + money(sale.quantity) + '</span> = الإجمالي: <span class="sale-grand-total">' + price(secondary((Number(sale.unitPrice) || 0) * (Number(sale.quantity) || 0))) + ' ' + esc(currency.secondaryCurrencySymbol) + '</span></p>' +
                '<div class="record-actions"><button type="button" data-edit-sale="' + esc(sale.saleId) + '">تعديل الكمية/السعر</button>' +
                '<button type="button" class="cancel-sale" data-cancel-sale="' + esc(sale.saleId) + '">إلغاء البيع</button></div></article>';
            dayNumber -= 1;
        });
        if (!ordered.length) html = '<div class="empty-state">لا توجد عمليات بيع حتى الآن</div>';
        if (historyHasMore && historyStartDate) html += '<button class="load-more" id="loadMoreSales" type="button">عرض المزيد</button>';
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
        var qtyInput = $('saleQuantity').value;
        var qty = Number(qtyInput);
        var enteredPrice = number($('salePrice').value);
        var availableStock = Number(selectedItem ? selectedItem.quantity : 0) || 0;
        var oldQty = editingSale ? Number(editingSale.quantity) || 0 : 0;
        var maxAllowedQty = Math.max(0, availableStock + oldQty);
        var displayedPrice = enteredPrice === null || !Number.isFinite(qty) || qty <= 0 ? null : enteredPrice / qty;
        if (!selectedItem || selectedItem.id === undefined || selectedItem.id === null || String(selectedItem.id).trim() === '' || !Number.isFinite(qty) || qty <= 0 || qty > maxAllowedQty || enteredPrice === null || enteredPrice < 0 || displayedPrice === null || displayedPrice < 0) {
            showError('saleError', 'يرجى إدخال كمية صالحة في حدود المخزون المتاح');
            return;
        }
        if (qty > availableStock + oldQty) { showError('saleError', 'الكمية المتوفرة غير كافية'); return; }
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
                var currentSeller = getCurrentSellerInfo();
                var sale = { itemId: selectedItem.id, itemName: selectedItem.name, quantity: qty, unitPrice: primary(displayedPrice), totalAmount: primary(displayedPrice) * qty, profit: (primary(displayedPrice) - cost) * qty, purchasePriceAtTime: cost, timestamp: Date.now(), sellerEmail: currentSeller.email, sellerName: currentSeller.name, user: currentSeller.email, saleCurrency: 'secondary', source: SOURCE, saleMode: activeSaleMode, priceType: warning.type, priceWarningLevel: warning.level, priceWarningPercent: warning.percent, priceWarningDirection: warning.direction, priceWarningReference: warning.reference };
                sale.saleId = makeMobileSaleId();
                if (allocations) sale.purchaseBatchAllocations = allocations;
                try {
                    await db.collection('sales').doc(sale.saleId).set(sanitizeFirestoreData(sale));
                    await updateStats(sale.profit);
                    await logMobileActivity('sell', sale);
                    selectedItem.quantity = stockResult.quantity; selectedItem.purchaseBatches = stockResult.purchaseBatches || selectedItem.purchaseBatches;
                    upsertSaleLocally(sale); saveCache(); notify('تم تسجيل البيع بنجاح');
                } catch (offlineCreateError) {
                    sale.pending = 'pending'; sale.syncStatus = 'pending';
                    queueMobileSaleOperation('create', sale);
                    upsertSaleLocally(sale); saveCache(); notify('تم حفظ البيع محليًا وسيتم مزامنته عند عودة الإنترنت');
                    console.warn('Mobile sales offline create queued', offlineCreateError);
                }
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
                var seller = getCurrentSellerInfo();
                var updated = Object.assign({}, editingSale, { quantity: qty, unitPrice: newPrice, totalAmount: newPrice * qty, profit: newProfit, sellerEmail: editingSale.sellerEmail || seller.email, sellerName: editingSale.sellerName || seller.name, user: editingSale.user || seller.email, saleCurrency: 'secondary', purchaseBatchAllocations: allocations, updatedAt: Date.now(), source: SOURCE, priceType: warning.type, priceWarningLevel: warning.level, priceWarningPercent: warning.percent, priceWarningDirection: warning.direction, priceWarningReference: warning.reference });
                try {
                    await db.collection('sales').doc(editingSale.saleId).set(sanitizeFirestoreData(updated));
                    await updateStats(profitDiff); await logMobileActivity('update', updated);
                    sales = sales.map(function (entry) { return entry.saleId === updated.saleId ? updated : entry; }); saveCache(); notify('تم تعديل البيع');
                } catch (offlineUpdateError) {
                    updated.pending = 'pending'; updated.syncStatus = 'pending';
                    queueMobileSaleOperation('update', updated);
                    sales = sales.map(function (entry) { return entry.saleId === updated.saleId ? updated : entry; }); saveCache(); notify('تم حفظ التعديل محليًا وسيتم مزامنته عند عودة الإنترنت');
                    console.warn('Mobile sales offline update queued', offlineUpdateError);
                }
            }
            closeModal('saleModal'); renderProducts(); renderHistory(); saveUiState();
        } catch (error) { showError('saleError', error.message || 'تعذر حفظ العملية'); }
        button.disabled = false;
    }

    async function updateStats(delta) { if (delta) await db.collection('stats').doc('totals').set({ allTimeProfit: firebase.firestore.FieldValue.increment(delta), updatedAt: Date.now() }, { merge: true }); }
    async function logMobileActivity(action, sale) {
        var sellerInfo = getCurrentSellerInfo();
        var saleRecord = sale || {};
        var email = (saleRecord.user || saleRecord.sellerEmail || sellerInfo.email || (auth && auth.currentUser && auth.currentUser.email) || 'unknown');
        var qty = Number(saleRecord.quantity) || 0;
        var itemName = saleRecord.itemName || saleRecord.name || 'منتج';
        var profitValue = Number(saleRecord.profit) || 0;
        var details = '';
        if (action === 'sell') {
            details = 'بيع منتج: ' + itemName + '، الكمية: ' + qty + '، الربح: ' + (profitValue || 0);
        } else if (action === 'cancel') {
            details = 'إلغاء بيع: ' + itemName + '، الكمية: ' + qty + '، الربح: ' + (profitValue || 0);
        } else {
            details = 'تعديل بيع: ' + itemName + '، الكمية الجديدة: ' + qty + '، السعر: ' + (Number(saleRecord.unitPrice) || 0);
        }
        var metadata = {
            saleId: saleRecord.saleId || null,
            itemId: saleRecord.itemId || null,
            itemName: itemName,
            quantity: qty,
            profit: profitValue,
            source: SOURCE
        };
        return db.collection('activityLog').add({
            timestamp: Date.now(),
            actionType: action === 'sell' ? 'sell' : (action === 'cancel' ? 'cancelSale' : 'update'),
            entity: 'sale',
            entityId: saleRecord.saleId || null,
            details: details,
            user: email,
            sellerEmail: email,
            sellerName: sellerInfo.name || saleRecord.sellerName || '',
            itemId: saleRecord.itemId || null,
            itemName: itemName,
            quantity: qty,
            metadata: metadata,
            source: SOURCE
        });
    }

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
            try {
                await db.collection('sales').doc(saleId).delete(); await updateStats(-(Number(sale.profit) || 0)); await logMobileActivity('cancel', sale);
                item.quantity = typeof result === 'number' ? result : result.quantity;
                if (typeof result === 'object' && result.purchaseBatches) item.purchaseBatches = result.purchaseBatches;
                var localItemIndex = items.findIndex(function (entry) { return entry && entry.id === item.id; });
                if (localItemIndex >= 0) items[localItemIndex] = item;
                else items.push(item);
                sales = sales.filter(function (entry) { return !entry || entry.saleId !== saleId; }); saveCache();
                renderProducts(); renderHistory(); notify('تم إلغاء البيع وإعادة الكمية للمخزون');
            } catch (syncCancelError) {
                sale.pending = 'pending'; sale.syncStatus = 'pending';
                queueMobileSaleOperation('delete', sale);
                sales = sales.filter(function (entry) { return !entry || entry.saleId !== saleId; }); saveCache();
                renderProducts(); renderHistory(); notify('تم حفظ إلغاء البيع محليًا وسيتم مزامنته عند عودة الإنترنت');
                console.warn('Mobile sales cancel queued', syncCancelError);
            }
        } catch (error) { notify(error.message || 'تعذر إلغاء البيع'); }
    }

    async function loadData() {
        if (dataLoaded) return;
        dataLoaded = true;
        var hasCache = restoreCache();
        historyLiveStartDate = historyInitialStart();
        historyStartDate = historyLiveStartDate;
        sales = uniqueSales(sales);
        if (hasCache) { renderProducts(); renderHistory(); }
        restoreUiState();
        try { flushPendingSalesQueue(); } catch (error) { console.warn('Pending mobile sales flush setup failed', error); }
        startLiveListeners();
        if (hasCache) return;
        try {
            var cacheRead = Promise.all([
                db.collection('items').get({ source: 'cache' }),
                db.collection('currencySettings').doc('settings').get({ source: 'cache' })
            ]).then(function (result) {
                items = result[0].docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
                if (result[1].exists) currency = Object.assign(currency, result[1].data());
                renderProducts(); renderHistory(); saveCache();
                restoreUiState();
            });
            await Promise.race([cacheRead, new Promise(function (resolve) { setTimeout(resolve, 1200); })]);
        } catch (error) { notify('تعذر الاتصال بالنظام'); console.error(error); }
    }

    function startLiveListeners() {
        if (listenersStarted) return;
        listenersStarted = true;
        db.collection('items').onSnapshot(function (snap) {
            var nextItems = snap.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
            var firstProductsSnapshot = !productsLoaded;
            productsLoaded = true;
            var changed = nextItems.length !== items.length || nextItems.some(function (next) {
                var previous = items.find(function (item) { return item.id === next.id; });
                return !previous || JSON.stringify(previous) !== JSON.stringify(next);
            });
            if (changed) {
                items = nextItems;
                renderProducts();
                renderAdminCategorySettings();
                saveCache();
                restoreUiState();
            } else if (firstProductsSnapshot) renderProducts();
            lastSyncAt = Date.now();
        });
        db.collection('categories').onSnapshot(function (snap) {
            categories = snap.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
            categoriesLoaded = true;
            renderProducts();
            renderAdminCategorySettings();
        }, function (error) {
            console.error('Mobile admin category sync failed:', error);
            categoriesLoaded = true;
            renderProducts();
            renderAdminCategorySettings();
            if (!$('settingsModal').hidden) notify('تعذر تحديث الفئات؛ تحقق من الاتصال');
        });
        historyLiveStartDate = historyLiveStartDate || historyInitialStart();
        historyStartDate = historyStartDate || historyLiveStartDate;
        historyQuery(historyLiveStartDate, addDays(historyLiveStartDate, 2)).onSnapshot(function (snap) {
            var nextSales = salesFromSnapshot(snap);
            var olderSales = sales.filter(function (sale) { return timestampValue(sale.timestamp) < historyLiveStartDate.getTime(); });
            var mergedSales = uniqueSales(nextSales.concat(olderSales));
            if (JSON.stringify(mergedSales) !== JSON.stringify(uniqueSales(sales))) { sales = mergedSales; renderHistory(); saveCache(); }
            lastSyncAt = Date.now();
        });
        db.collection('currencySettings').doc('settings').onSnapshot(function (doc) {
            if (doc.exists) { var nextCurrency = Object.assign({}, currency, doc.data()); if (JSON.stringify(nextCurrency) !== JSON.stringify(currency)) { currency = nextCurrency; renderProducts(); renderHistory(); saveCache(); } }
            lastSyncAt = Date.now();
        });
    }

    function updateSearchClearButton() {
        $('clearProductSearch').hidden = !$('productSearch').value;
    }

    function renderEmployeeSearchHistory(records) {
        var container = $('employeeSearchHistoryEntries');
        container.replaceChildren();
        if (!records.length) {
            var empty = document.createElement('p');
            empty.className = 'search-history-empty';
            empty.textContent = 'لا توجد عمليات بحث خلال آخر يومين';
            container.appendChild(empty);
            return;
        }
        records.forEach(function (record) {
            var row = document.createElement('article');
            row.className = 'employee-search-history-entry';
            var details = document.createElement('div');
            details.className = 'employee-search-history-details';
            var query = document.createElement('strong');
            query.textContent = record.query || '';
            var employee = document.createElement('span');
            employee.textContent = [record.employeeName, record.employeeEmail].filter(Boolean).join(' · ') || 'موظف غير محدد';
            var time = document.createElement('time');
            var occurredAt = record.createdAt.toDate();
            time.dateTime = occurredAt.toISOString();
            time.textContent = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { dateStyle: 'medium', timeStyle: 'medium' }).format(occurredAt);
            details.append(query, employee, time);
            var remove = document.createElement('button');
            remove.className = 'search-history-delete';
            remove.type = 'button';
            remove.dataset.searchHistoryDelete = record.id;
            remove.setAttribute('aria-label', 'حذف عملية البحث');
            remove.textContent = '×';
            row.append(details, remove);
            container.appendChild(row);
        });
    }

    async function deleteExpiredEmployeeSearchHistory(cutoff) {
        var expired = await db.collection('employeeSearchHistory')
            .where('createdAt', '<', firebase.firestore.Timestamp.fromDate(cutoff))
            .get();
        for (var index = 0; index < expired.docs.length; index += 500) {
            var batch = db.batch();
            expired.docs.slice(index, index + 500).forEach(function (doc) { batch.delete(doc.ref); });
            await batch.commit();
        }
    }

    async function loadEmployeeSearchHistory() {
        var requestId = ++employeeSearchHistoryRequest;
        $('employeeSearchHistoryStatus').textContent = 'جارٍ تحميل السجل...';
        try {
            var cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
            await deleteExpiredEmployeeSearchHistory(cutoff);
            if (requestId !== employeeSearchHistoryRequest) return;
            var snapshot = await db.collection('employeeSearchHistory')
                .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(cutoff))
                .orderBy('createdAt', 'desc')
                .get();
            if (requestId !== employeeSearchHistoryRequest) return;
            var records = snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
            renderEmployeeSearchHistory(records);
            $('employeeSearchHistoryStatus').textContent = '';
        } catch (error) {
            if (requestId !== employeeSearchHistoryRequest) return;
            console.error('Unable to load employee search history:', error);
            $('employeeSearchHistoryStatus').textContent = 'تعذر تحميل سجل البحث';
        }
    }

    $('employeeSearchHistoryEntries').addEventListener('click', async function (event) {
        var button = event.target.closest('[data-search-history-delete]');
        if (!button) return;
        button.disabled = true;
        try {
            await db.collection('employeeSearchHistory').doc(button.dataset.searchHistoryDelete).delete();
            await loadEmployeeSearchHistory();
        } catch (error) {
            console.error('Unable to delete employee search history entry:', error);
            button.disabled = false;
            $('employeeSearchHistoryStatus').textContent = 'تعذر حذف عملية البحث';
        }
    });
    $('refreshEmployeeSearchHistory').addEventListener('click', loadEmployeeSearchHistory);
    try { localStorage.removeItem('xmetalMobAdminSearchHistoryV1'); }
    catch (error) { console.warn('Unable to clear old local mobile admin search history.', error); }

    $('clearProductSearch').addEventListener('click', function () {
        $('productSearch').value = '';
        $('productSearch').dispatchEvent(new Event('input', { bubbles: true }));
        $('productSearch').focus();
    });
    $('productSearch').addEventListener('input', updateSearchClearButton);
    updateSearchClearButton();

    $('loginForm').addEventListener('submit', function (event) { event.preventDefault(); showError('loginError', ''); auth.signInWithEmailAndPassword($('email').value.trim(), $('password').value).catch(function () { showError('loginError', 'بيانات الدخول غير صحيحة'); }); });
    $('productSearch').addEventListener('input', function () { renderProducts(); scrollToProductsTop(); });
    $('productFilters').addEventListener('click', function (event) {
        var button = event.target.closest('[data-product-filter]');
        if (!button) return;
        productFilter = button.dataset.productFilter || 'available';
        renderProducts();
        saveUiState();
        scrollToProductsTop();
    });
    $('categoryFilters').addEventListener('click', function (event) {
        var button = event.target.closest('[data-category-filter]');
        if (!button) return;
        activeProductCategoryId = button.dataset.categoryFilter || '';
        renderProducts();
        saveUiState();
        scrollToProductsTop();
    });
    $('saleQuantity').addEventListener('input', function () {
        var quantity = number($('saleQuantity').value);
        var available = selectedItem ? Number(selectedItem.quantity) || 0 : 0;
        if (quantity !== null && available > 0 && quantity > available) {
            $('saleQuantity').value = available;
        }
        if (quantity !== null && quantity <= 0) {
            $('saleQuantity').value = 0.01;
        }
        unusualPriceApproved = false; $('priceWarning').hidden = true; updateSalePriceGuide();
    });
    $('salePrice').addEventListener('input', function () { salePriceManuallyEdited = true; unusualPriceApproved = false; $('priceWarning').hidden = true; updateSalePriceGuide(); });
    $('resetSalePrice').addEventListener('click', function () { salePriceManuallyEdited = false; updateSalePriceGuide(true); });
    $('quickQuantityButtons').addEventListener('click', function (event) {
        var button = event.target.closest('[data-quick-quantity]');
        if (!button || button.disabled || button.hidden) return;
        var quickValue = Number(button.dataset.quickQuantity);
        var stock = selectedItem ? Number(selectedItem.quantity) || 0 : 0;
        if (!Number.isFinite(quickValue) || quickValue <= 0 || quickValue > Math.min(10, stock) || quickValue > stock) return;
        $('saleQuantity').value = quickValue;
        $('saleQuantity').dispatchEvent(new Event('input', { bubbles: true }));
    });
    $('backFromWarning').addEventListener('click', function () { unusualPriceApproved = false; $('priceWarning').hidden = true; });
    $('confirmUnusualPrice').addEventListener('click', function () { unusualPriceApproved = true; $('priceWarning').hidden = true; $('saleForm').requestSubmit(); });
    window.addEventListener('scroll', function () {
        try { localStorage.setItem(CACHE_KEY + ':scrollY', String(window.scrollY)); } catch (error) {}
        scheduleUiStateSave();
        updateCustomScrollbar();
    }, { passive: true });
    $('historyButton').addEventListener('click', function () { renderHistory(); openModal('historyModal'); });
    $('themeToggleButton').addEventListener('click', function () {
        applyMobileTheme(currentTheme === 'dark' ? 'light' : 'dark', true);
    });
    $('settingsButton').addEventListener('click', function () {
        openModal('settingsModal');
        activateSettingsTab($('categorySettingsTab'));
        activateCategoryTab($('assignCategoryProductsTab'));
        renderAdminCategorySettings();
    });
    $('settingsModal').querySelector('[role="tablist"]').addEventListener('click', function (event) {
        var tab = event.target.closest('[data-settings-tab]');
        if (tab) activateSettingsTab(tab);
    });
    $('settingsModal').querySelector('[role="tablist"]').addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        var tabs = Array.from(this.querySelectorAll('[data-settings-tab]'));
        var current = tabs.indexOf(document.activeElement);
        if (current === -1) return;
        event.preventDefault();
        var direction = event.key === 'ArrowRight' ? 1 : -1;
        var next = tabs[(current + direction + tabs.length) % tabs.length];
        activateSettingsTab(next);
        next.focus();
    });
    $('categorySettingsPanel').querySelector('[role="tablist"]').addEventListener('click', function (event) {
        var tab = event.target.closest('[data-category-tab]');
        if (tab) activateCategoryTab(tab);
    });
    $('categorySettingsPanel').querySelector('[role="tablist"]').addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        var tabs = Array.from(this.querySelectorAll('[data-category-tab]'));
        var current = tabs.indexOf(document.activeElement);
        if (current === -1) return;
        event.preventDefault();
        var direction = event.key === 'ArrowRight' ? 1 : -1;
        var next = tabs[(current + direction + tabs.length) % tabs.length];
        activateCategoryTab(next);
        next.focus();
    });
    $('addCategoryButton').addEventListener('click', function () {
        $('newCategoryName').value = '';
        $('newCategoryIcon').value = '';
        $('newCategoryProductSearch').value = '';
        $('categoryCreateError').textContent = '';
        newCategoryProductSelection = new Set();
        renderAdminCategorySettings();
        openModal('categoryCreateModal');
        renderCategoryProductChecklist('', 'newCategoryProductsChecklist', newCategoryProductSelection, '', false);
        $('newCategoryName').focus();
    });
    $('saveNewCategory').addEventListener('click', createAdminCategory);
    $('saveEditedCategory').addEventListener('click', updateAdminCategory);
    $('deleteEditedCategory').addEventListener('click', async function () {
        var button = this;
        var saveButton = $('saveEditedCategory');
        button.disabled = true;
        saveButton.disabled = true;
        try {
            await deleteAdminCategory($('categoryEditModal').dataset.categoryId);
        } finally {
            button.disabled = false;
            saveButton.disabled = false;
        }
    });
    $('newCategoryProductSearch').addEventListener('input', function () {
        renderCategoryProductChecklist('', 'newCategoryProductsChecklist', newCategoryProductSelection, this.value, false);
    });
    $('newCategoryProductsChecklist').addEventListener('change', function (event) {
        var checkbox = event.target.closest('[data-category-product-id]');
        if (!checkbox) return;
        if (checkbox.checked) newCategoryProductSelection.add(checkbox.dataset.categoryProductId);
        else newCategoryProductSelection.delete(checkbox.dataset.categoryProductId);
    });
    $('manageCategorySelect').addEventListener('change', function () {
        managedCategoryId = this.value;
        managedCategorySelection = new Set(items.filter(function (item) { return item.categoryId === managedCategoryId && managedCategoryId; }).map(function (item) { return item.id; }));
        $('categoryManageError').textContent = '';
        renderCategoryProductChecklist(managedCategoryId, 'manageProductsChecklist', managedCategorySelection, $('manageProductSearch').value, true);
    });
    $('manageProductSearch').addEventListener('input', function () {
        renderCategoryProductChecklist(managedCategoryId, 'manageProductsChecklist', managedCategorySelection, this.value, true);
    });
    $('manageProductsChecklist').addEventListener('change', function (event) {
        var checkbox = event.target.closest('[data-category-product-id]');
        if (!checkbox) return;
        if (checkbox.checked) managedCategorySelection.add(checkbox.dataset.categoryProductId);
        else managedCategorySelection.delete(checkbox.dataset.categoryProductId);
    });
    $('saveCategoryProducts').addEventListener('click', saveAdminCategoryProducts);
    $('adminCategoriesList').addEventListener('click', function (event) {
        var button = event.target.closest('[data-category-action]');
        if (!button) return;
        if (button.dataset.categoryAction === 'edit') openAdminCategoryEditor(button.dataset.categoryId);
    });
    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        if (!$('categoryEditModal').hidden) closeModal('categoryEditModal');
        else if (!$('categoryCreateModal').hidden) closeModal('categoryCreateModal');
        else if (!$('settingsModal').hidden) closeModal('settingsModal');
    });
    $('productsGrid').addEventListener('click', function (event) {
        var mechanicPriceButton = event.target.closest('.mechanic-price');
        if (mechanicPriceButton) {
            var mechanicPriceCard = mechanicPriceButton.closest('.product-card');
            if (mechanicPriceCard.classList.contains('mechanic-price-obscured')) {
                clearTimeout(mechanicPriceCard._mechanicPriceRevealTimer);
                mechanicPriceCard.classList.remove('mechanic-price-obscured');
                mechanicPriceCard._mechanicPriceRevealTimer = setTimeout(function () {
                    mechanicPriceCard.classList.add('mechanic-price-obscured');
                    mechanicPriceCard._mechanicPriceRevealTimer = null;
                }, 5000);
                return;
            }
        }
        var purchasePriceButton = event.target.closest('.purchase-price');
        if (purchasePriceButton) {
            var purchasePriceCard = purchasePriceButton.closest('.product-card');
            clearTimeout(purchasePriceCard._purchasePriceRevealTimer);
            if (!purchasePriceCard.classList.contains('purchase-price-obscured')) {
                purchasePriceCard.classList.add('purchase-price-obscured');
                purchasePriceButton.setAttribute('aria-pressed', 'false');
                purchasePriceButton.setAttribute('aria-label', 'إظهار سعر الشراء');
                purchasePriceCard._purchasePriceRevealTimer = null;
            } else {
                purchasePriceCard.classList.remove('purchase-price-obscured');
                purchasePriceButton.setAttribute('aria-pressed', 'true');
                purchasePriceButton.setAttribute('aria-label', 'إخفاء سعر الشراء');
                purchasePriceCard._purchasePriceRevealTimer = setTimeout(function () {
                    purchasePriceCard.classList.add('purchase-price-obscured');
                    purchasePriceButton.setAttribute('aria-pressed', 'false');
                    purchasePriceButton.setAttribute('aria-label', 'إظهار سعر الشراء');
                    purchasePriceCard._purchasePriceRevealTimer = null;
                }, 5000);
            }
            return;
        }
        var locationEditButton = event.target.closest('[data-edit-location]');
        if (locationEditButton) {
            var locationEditItem = items.find(function (entry) { return entry.id === locationEditButton.dataset.editLocation; });
            if (locationEditItem) openProductLocationEditor(locationEditItem);
            return;
        }
        var replaceImageButton = event.target.closest('[data-image-replace]');
        if (replaceImageButton) {
            var replaceImageItem = items.find(function (entry) { return entry.id === replaceImageButton.dataset.imageReplace; });
            if (replaceImageItem) openProductImagePicker(replaceImageItem, false);
            return;
        }
        var locationButton = event.target.closest('[data-edit-product]');
        if (locationButton) {
            var locationItem = items.find(function (entry) { return entry.id === locationButton.dataset.editProduct; });
            if (locationItem) openLocationEdit(locationItem);
            return;
        }
        var button = event.target.closest('[data-sell-item]');
        if (button && !button.disabled) {
            var item = items.find(function (entry) { return entry.id === button.dataset.sellItem; });
            if (item) openNewSale(item, number(button.dataset.sellPrice), button.dataset.sellMode);
            return;
        }
        var imageButton = event.target.closest('[data-image-view]');
        if (imageButton) {
            var product = items.find(function (entry) { return entry.id === imageButton.dataset.imageView; });
            if (!product) return;
            var images = Array.isArray(product.images) ? product.images.filter(function (img) { return img && typeof img.url === 'string' && img.url.trim(); }) : [];
            var primaryImage = images.find(function (img) { return img.isPrimary; }) || images[0] || null;
            if (!primaryImage) return;
            var modal = ensureProductImageModal();
            modal.dataset.itemId = product.id;
            modal.querySelector('.product-image-replace').hidden = false;
            var imageElement = modal.querySelector('img');
            imageElement.src = primaryImage.url;
            imageElement.alt = product.name || 'صورة المنتج';
            modal.hidden = false;
            return;
        }
    });
    $('productsGrid').addEventListener('keydown', function (event) {
        var locationButton = event.target.closest('[data-edit-product]');
        if (!locationButton || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        var locationItem = items.find(function (entry) { return entry.id === locationButton.dataset.editProduct; });
        if (locationItem) openLocationEdit(locationItem);
    });
    $('addProductButton').addEventListener('click', openNewProduct);
    $('salesHistory').addEventListener('click', function (event) { var edit = event.target.closest('[data-edit-sale]'), cancel = event.target.closest('[data-cancel-sale]'), warningButton = event.target.closest('[data-warning-sale]'); if (edit) { var sale = sales.find(function (entry) { return entry.saleId === edit.dataset.editSale; }); if (sale) { closeModal('historyModal'); openEditSale(sale); } } if (cancel) cancelSale(cancel.dataset.cancelSale); if (warningButton) { var warningSale = sales.find(function (entry) { return entry.saleId === warningButton.dataset.warningSale; }); if (warningSale) window.alert('سبب التنبيه: سعر القطعة المحسوب ' + (warningSale.priceWarningDirection || '') + ' من ' + (warningSale.priceType === 'mechanic' ? 'سعر الجملة' : 'سعر البيع الأساسي') + ' بنسبة ' + money(warningSale.priceWarningPercent || 0) + '%.'); } });
    $('salesHistory').addEventListener('click', function (event) { if (event.target.id === 'loadMoreSales') loadOlderSales(); });
    $('backToTop').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('backToBottom').addEventListener('click', function () {
        var products = document.querySelectorAll('.product-card');
        var lastProduct = products[products.length - 1];
        var target = lastProduct ? lastProduct.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 16 : document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    });
    window.addEventListener('scroll', function () {
        var showNavigation = window.scrollY > 220;
        $('backToTop').classList.toggle('show', showNavigation);
        $('backToBottom').classList.toggle('show', showNavigation);
    }, { passive: true });
    window.addEventListener('resize', updateCustomScrollbar);
    setupCustomScrollbar();
    updateCustomScrollbar();
    $('saleForm').addEventListener('submit', submitSale);
    document.querySelectorAll('[data-close-modal]').forEach(function (button) { button.addEventListener('click', function () { closeModal(button.dataset.closeModal); }); });
    document.querySelectorAll('.modal-backdrop').forEach(function (backdrop) { backdrop.addEventListener('click', function (event) { if (event.target === backdrop) closeModal(backdrop.id); }); });

    function hideSplash() { setTimeout(function () { $('splashScreen').classList.add('ready'); }, 180); }
    var authStateObserved = false;
    var authStateResolved = false;
    var authObserverStarted = false;
    var authUiInitialized = false;
    var appliedAuthUid = null;

    function scheduleUiStateSave() {
        clearTimeout(uiStateSaveTimer);
        uiStateSaveTimer = setTimeout(saveUiState, 200);
    }

    document.addEventListener('input', scheduleUiStateSave);
    document.addEventListener('change', scheduleUiStateSave);
    document.addEventListener('click', scheduleUiStateSave);
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) saveUiState();
    });
    window.addEventListener('pagehide', saveUiState);

    async function applyAuthState(user) {
        var currentUser = user || (auth && auth.currentUser ? auth.currentUser : null);
        authStateResolved = true;

        if (currentUser) {
            $('loginScreen').hidden = true;
            $('appShell').hidden = false;
            if (!authUiInitialized || appliedAuthUid !== currentUser.uid) {
                authUiInitialized = true;
                appliedAuthUid = currentUser.uid;
                var displayNamesPromise = refreshUserDisplayNameMap();
                await loadData();
                displayNamesPromise.then(function () {
                    if (!$('historyModal').hidden) renderHistory();
                }).catch(function (error) { console.warn('Unable to refresh seller names.', error); });
            }
        } else if (authStateObserved || authStateResolved) {
            authUiInitialized = true;
            appliedAuthUid = null;
            $('loginScreen').hidden = false;
            $('appShell').hidden = true;
        }
        hideSplash();
    }

    function observeAuthState() {
        if (authObserverStarted) return;
        authObserverStarted = true;
        if (!auth) {
            authStateObserved = true;
            authStateResolved = true;
            applyAuthState(null);
            return;
        }

        auth.onAuthStateChanged(function (user) {
            authStateObserved = true;
            authStateResolved = true;
            applyAuthState(user);
        });

        if (auth.currentUser) {
            authStateObserved = true;
            authStateResolved = true;
            applyAuthState(auth.currentUser);
            return;
        }

        setTimeout(function () {
            if (!authStateObserved) {
                authStateObserved = true;
                authStateResolved = true;
                applyAuthState(auth.currentUser || null);
            }
        }, 3500);
    }

    Promise.race([
        Promise.resolve(window.firebaseAuthPersistenceReady),
        new Promise(function (resolve) { setTimeout(resolve, 1200); })
    ]).then(observeAuthState).catch(observeAuthState);

    window.addEventListener('pageshow', function () {
        if (auth && auth.currentUser) {
            authStateObserved = true;
            authStateResolved = true;
            applyAuthState(auth.currentUser);
            return;
        }
        if (!authStateObserved) {
            observeAuthState();
        }
    });

    window.addEventListener('beforeinstallprompt', function (event) {
        event.preventDefault(); installPrompt = event; $('installButton').style.display = 'block';
    });
    $('installButton').addEventListener('click', async function () {
        if (!installPrompt) return;
        installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('installButton').style.display = 'none';
    });
    window.addEventListener('appinstalled', function () { $('installButton').style.display = 'none'; });

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('mob-admin-sw.js').catch(function () {});
    }

    window.addEventListener('online', function () {
        try { flushPendingSalesQueue(); } catch (error) { console.warn('Retry mobile-sales flush failed', error); }
    });
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) {
            if (!authStateObserved) {
                observeAuthState();
            } else if ((auth && auth.currentUser ? auth.currentUser.uid : null) !== appliedAuthUid) {
                authStateObserved = true;
                authStateResolved = true;
                applyAuthState(auth ? auth.currentUser : null);
            }
        }
    });
}());
