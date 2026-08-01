(function(global) {
    'use strict';

    const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';
    const DEFAULT_MODEL = 'gemini-flash-latest';
    const DAY_MS = 24 * 60 * 60 * 1000;

    function toNumber(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function formatCurrency(value, symbol) {
        return `${(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${symbol || '$'}`;
    }

    function getGeminiApiKey() {
        return global.getGeminiApiKey ? global.getGeminiApiKey() : '';
    }

    function buildContextSummary(context) {
        const items = Array.isArray(context && context.items) ? context.items : [];
        const sales = Array.isArray(context && context.sales) ? context.sales : [];
        const expenses = Array.isArray(context && context.expenses) ? context.expenses : [];
        const debts = Array.isArray(context && context.debts) ? context.debts : [];
        const purchases = Array.isArray(context && context.purchases) ? context.purchases : [];
        const customers = Array.isArray(context && context.customers) ? context.customers : [];
        const categories = Array.isArray(context && context.categories) ? context.categories : [];
        const storeInfo = context && context.storeInfo ? context.storeInfo : {};
        const currencySettings = context && context.currencySettings ? context.currencySettings : {};
        const now = Date.now();

        const totalInventoryValue = items.reduce((sum, item) => sum + (toNumber(item.quantity) * toNumber(item.purchasePrice || item.cost || 0)), 0);
        const totalRevenue = sales.reduce((sum, sale) => sum + toNumber(sale.totalAmount || sale.amount || 0), 0);
        const totalProfit = sales.reduce((sum, sale) => sum + toNumber(sale.profit || 0), 0);
        const totalExpenses = expenses.reduce((sum, expense) => sum + toNumber(expense.amount || expense.value || 0), 0);
        const totalPurchases = purchases.reduce((sum, purchase) => sum + toNumber(purchase.amount || purchase.totalAmount || 0), 0);
        const totalDebt = debts.reduce((sum, debt) => sum + toNumber(debt.amount || debt.balance || 0), 0);

        const lowStock = items
            .filter(item => {
                const quantity = toNumber(item.quantity);
                const threshold = toNumber(item.lowStockThreshold || item.reorderThreshold || 5);
                return quantity <= threshold;
            })
            .sort((a, b) => toNumber(a.quantity) - toNumber(b.quantity))
            .slice(0, 10)
            .map(item => ({ id: item.id, name: item.name, quantity: toNumber(item.quantity) }));

        const staleProducts = items
            .map(item => {
                const itemSales = sales.filter(sale => sale.itemId === item.id || sale.productId === item.id || sale.itemName === item.name);
                const lastSaleTimestamp = itemSales.length
                    ? itemSales.reduce((latest, sale) => Math.max(latest, toNumber(sale.timestamp || 0)), 0)
                    : 0;
                return { item, lastSaleTimestamp, ageDays: lastSaleTimestamp ? Math.floor((now - lastSaleTimestamp) / DAY_MS) : null };
            })
            .filter(entry => {
                const quantity = toNumber(entry.item.quantity);
                const hasNoRecentSale = !entry.lastSaleTimestamp || (now - entry.lastSaleTimestamp) > 90 * DAY_MS;
                return hasNoRecentSale && quantity > 0;
            })
            .sort((a, b) => (a.ageDays || 999) - (b.ageDays || 999))
            .slice(0, 10)
            .map(entry => ({ id: entry.item.id, name: entry.item.name, ageDays: entry.ageDays || 0 }));

        const outOfStock = items
            .filter(item => toNumber(item.quantity) <= 0)
            .slice(0, 10)
            .map(item => ({ id: item.id, name: item.name }));

        const priceAnomalies = items
            .filter(item => toNumber(item.salePrice) > 0 && toNumber(item.purchasePrice) > 0 && toNumber(item.salePrice) < toNumber(item.purchasePrice))
            .slice(0, 10)
            .map(item => ({ id: item.id, name: item.name, purchasePrice: item.purchasePrice, salePrice: item.salePrice }));

        const monthlySales = sales.reduce((map, sale) => {
            const monthKey = new Date(toNumber(sale.timestamp || now)).toISOString().slice(0, 7);
            if (!map[monthKey]) {
                map[monthKey] = { revenue: 0, profit: 0, count: 0 };
            }
            map[monthKey].revenue += toNumber(sale.totalAmount || sale.amount || 0);
            map[monthKey].profit += toNumber(sale.profit || 0);
            map[monthKey].count += 1;
            return map;
        }, {});

        const topProducts = items
            .map(item => {
                const matchingSales = sales.filter(sale => sale.itemId === item.id || sale.productId === item.id || sale.itemName === item.name);
                const soldQty = matchingSales.reduce((sum, sale) => sum + toNumber(sale.quantity || 0), 0);
                const revenue = matchingSales.reduce((sum, sale) => sum + toNumber(sale.totalAmount || sale.amount || 0), 0);
                const profit = matchingSales.reduce((sum, sale) => sum + toNumber(sale.profit || 0), 0);
                return { id: item.id, name: item.name, soldQty, revenue, profit };
            })
            .filter(item => item.soldQty > 0)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);

        const summaryText = [
            `المتجر: ${storeInfo.name || 'غير محدد'}`,
            `إجمالي قيمة المخزون: ${formatCurrency(totalInventoryValue, currencySettings.secondaryCurrencySymbol || '$')}`,
            `إجمالي الإيرادات: ${formatCurrency(totalRevenue, currencySettings.secondaryCurrencySymbol || '$')}`,
            `إجمالي الأرباح: ${formatCurrency(totalProfit, currencySettings.secondaryCurrencySymbol || '$')}`,
            `إجمالي المصاريف: ${formatCurrency(totalExpenses, currencySettings.secondaryCurrencySymbol || '$')}`,
            `إجمالي المشتريات: ${formatCurrency(totalPurchases, currencySettings.secondaryCurrencySymbol || '$')}`,
            `إجمالي الديون: ${formatCurrency(totalDebt, currencySettings.secondaryCurrencySymbol || '$')}`
        ].join(' | ');

        return {
            summaryText,
            totalInventoryValue,
            totalRevenue,
            totalProfit,
            totalExpenses,
            totalPurchases,
            totalDebt,
            lowStock,
            outOfStock,
            staleProducts,
            priceAnomalies,
            topProducts,
            monthlySales,
            categories,
            customersCount: customers.length,
            debtsCount: debts.length,
            itemsCount: items.length,
            salesCount: sales.length,
            expensesCount: expenses.length
        };
    }

    function buildPrompt(question, summary) {
        const categoryNames = summary.categories.slice(0, 6).map(category => category.name || category.id).join(', ') || 'لا توجد فئات';
        return `أنت مساعد ذكي لمتجر يدير المخزون والمبيعات والديون. استخدم البيانات التالية لتشكيل إجابة دقيقة ومختصرة بالعربية.

السؤال: ${question}

ملخص البيانات:
- اسم المتجر: ${summary.summaryText}
- عدد المنتجات: ${summary.itemsCount}
- عدد المبيعات: ${summary.salesCount}
- عدد المصاريف: ${summary.expensesCount}
- عدد العملاء: ${summary.customersCount}
- عدد الديون: ${summary.debtsCount}
- الفئات: ${categoryNames}
- المنتجات التي تحتاج إعادة طلب: ${summary.lowStock.map(item => `${item.name} (${item.quantity})`).join(', ') || 'لا توجد'}
- المنتجات الراكدة: ${summary.staleProducts.map(item => item.name).join(', ') || 'لا توجد'}
- المنتجات غير المتوفرة: ${summary.outOfStock.map(item => item.name).join(', ') || 'لا توجد'}
- anomalie الأسعار: ${summary.priceAnomalies.map(item => `${item.name} (${item.purchasePrice} -> ${item.salePrice})`).join(', ') || 'لا توجد'}
- أهم المنتجات مبيعاً: ${summary.topProducts.map(item => `${item.name} (${item.soldQty} قطعة / ${item.revenue} دخل)`).join(', ') || 'لا توجد'}
- المبيعات الشهرية: ${JSON.stringify(summary.monthlySales)}

التعليمات:
1) قدم إجابة عملية ومفيدة بالعربية.
2) إذا كان السؤال يتعلق بالمخزون، أشر إلى المنتجات التي تحتاج إعادة طلب أو التي نفدت.
3) إذا كان السؤال يتعلق بالربح أو الخسارة، استند إلى أرقام المبيعات والمصاريف.
4) إذا كان السؤال يتعلق بالديون، أشر إلى وجود أو عدم وجود ديون.
5) إذا كانت البيانات غير كافية، أذكر ذلك بوضوح.
6) لا تذكر أنك مجرد نموذج، وابدأ بالإجابة مباشرة.
`;
    }

    async function fetchFirestoreContext() {
        const db = global.firebaseDb || global.window?.firebaseDb;
        if (!db) {
            throw new Error('Firebase Firestore غير متاح حالياً');
        }

        const [itemsSnap, salesSnap, expensesSnap, categoriesSnap, storeInfoSnap, currencySettingsSnap, debtsSnap, customersSnap, purchasesSnap] = await Promise.all([
            db.collection('items').get(),
            db.collection('sales').orderBy('timestamp', 'desc').limit(1000).get(),
            db.collection('expenses').orderBy('date', 'desc').get(),
            db.collection('categories').get(),
            db.collection('storeInfo').doc('info').get(),
            db.collection('currencySettings').doc('settings').get(),
            db.collection('debts').get().catch(() => ({ docs: [] })),
            db.collection('customers').get().catch(() => ({ docs: [] })),
            db.collection('purchases').get().catch(() => ({ docs: [] }))
        ]);

        return {
            items: itemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
            sales: salesSnap.docs.map(doc => ({ saleId: doc.id, ...doc.data() })),
            expenses: expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
            categories: categoriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
            storeInfo: storeInfoSnap.exists ? storeInfoSnap.data() : {},
            currencySettings: currencySettingsSnap.exists ? currencySettingsSnap.data() : {},
            debts: debtsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
            customers: customersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
            purchases: purchasesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
            fetchedAt: Date.now()
        };
    }

    async function askAssistant(question) {
        const apiKey = getGeminiApiKey();
        if (!apiKey) {
            throw new Error('يرجى إدخال مفتاح Gemini API أولاً من خلال حقل الإعداد داخل قسم AI Assistant.');
        }

        const context = await fetchFirestoreContext();
        const summary = buildContextSummary(context);
        const prompt = buildPrompt(question, summary);
        const endpoint = (global.GEMINI_AI_CONFIG && global.GEMINI_AI_CONFIG.endpoint) || DEFAULT_ENDPOINT;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': apiKey
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`فشل الاتصال مع Gemini: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        const answer = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text
            ? data.candidates[0].content.parts[0].text
            : 'لم أستطع استخراج إجابة من Gemini.';

        return { answer, contextSummary: summary };
    }

    const service = {
        buildContextSummary,
        buildPrompt,
        fetchFirestoreContext,
        askAssistant,
        getGeminiApiKey,
        setGeminiApiKey: function(key) {
            return global.setGeminiApiKey ? global.setGeminiApiKey(key) : '';
        }
    };

    global.XMetalAIService = service;
    global.window.XMetalAIService = service;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = service;
    }
})(typeof window !== 'undefined' ? window : globalThis);
