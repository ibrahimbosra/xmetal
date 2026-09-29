(function (global) {
    function toNumber(value) {
        var parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function roundSecondaryPrice(value) {
        var amount = toNumber(value);
        if (amount === null || amount <= 0) return amount === null ? null : 0;
        var step = amount >= 100000 ? 1000 : (amount >= 1000 ? 500 : (amount >= 100 ? 50 : (amount >= 10 ? 5 : 1)));
        return Math.round(amount / step) * step;
    }

    function getSecondaryPrice(primaryPrice, exchangeRate) {
        var price = toNumber(primaryPrice);
        var rate = toNumber(exchangeRate);
        if (price === null || rate === null || rate <= 0) return null;
        return roundSecondaryPrice(price * rate);
    }

    function getPrimaryPriceFromInput(inputValue, originalPrimaryPrice, inputIsSecondary, exchangeRate) {
        var input = toNumber(inputValue);
        var original = toNumber(originalPrimaryPrice);
        var rate = toNumber(exchangeRate);
        if (input === null || rate === null || rate <= 0) return null;
        if (original !== null) {
            var secondary = getSecondaryPrice(original, rate);
            var unchangedValues = inputIsSecondary ? [secondary] : [original, secondary / rate];
            if (unchangedValues.some(function(value) { return value !== null && Math.abs(input - value) < 0.005; })) {
                return original;
            }
        }
        return inputIsSecondary ? input / rate : input;
    }

    function groupItemsByPurchasePrice(items) {
        var groups = new Map();
        (Array.isArray(items) ? items : []).forEach(function(item) {
            var value = item && item.purchasePrice !== null && item.purchasePrice !== undefined && item.purchasePrice !== '' ? toNumber(item.purchasePrice) : null;
            var key = value === null ? null : value;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        });
        return Array.from(groups, function(entry) { return { purchasePrice: entry[0], items: entry[1] }; });
    }

    function getMechanicDisplayPrice(item) {
        if (!item) return null;
        var mechanicPrice = toNumber(item.mechanicPrice);
        if (mechanicPrice !== null && mechanicPrice >= 0) {
            return mechanicPrice;
        }
        return toNumber(item.salePrice);
    }

    function getProfitPercent(purchasePrice, salePrice) {
        var purchase = toNumber(purchasePrice);
        var sale = toNumber(salePrice);
        if (purchase === null || sale === null || purchase <= 0) return '--';
        var percent = ((sale - purchase) / purchase) * 100;
        if (!Number.isFinite(percent)) return '--';
        return Math.round(percent) + '%';
    }

    function sortInventoryProducts(items, sortMode) {
        var list = Array.isArray(items) ? items.slice() : [];
        if (!list.length) return list;

        var mode = String(sortMode || 'alphabetical').toLowerCase();
        var compareAlphabetically = function(a, b) {
            var aName = a && a.name ? String(a.name) : '';
            var bName = b && b.name ? String(b.name) : '';
            return aName.localeCompare(bName, 'ar', { sensitivity: 'variant', usage: 'sort' });
        };

        list.sort(function(a, b) {
            if (mode === 'purchase') {
                var purchaseDiff = (toNumber(b && b.purchasePrice) || 0) - (toNumber(a && a.purchasePrice) || 0);
                if (purchaseDiff !== 0) return purchaseDiff;
                return compareAlphabetically(a, b);
            }
            if (mode === 'sale') {
                var saleDiff = (toNumber(b && b.salePrice) || 0) - (toNumber(a && a.salePrice) || 0);
                if (saleDiff !== 0) return saleDiff;
                return compareAlphabetically(a, b);
            }
            if (mode === 'quantity') {
                var quantityDiff = (toNumber(b && b.quantity) || 0) - (toNumber(a && a.quantity) || 0);
                if (quantityDiff !== 0) return quantityDiff;
                return compareAlphabetically(a, b);
            }
            return compareAlphabetically(a, b);
        });

        return list;
    }

    var api = {
        roundSecondaryPrice: roundSecondaryPrice,
        getSecondaryPrice: getSecondaryPrice,
        getPrimaryPriceFromInput: getPrimaryPriceFromInput,
        groupItemsByPurchasePrice: groupItemsByPurchasePrice,
        getMechanicDisplayPrice: getMechanicDisplayPrice,
        getProfitPercent: getProfitPercent,
        sortInventoryProducts: sortInventoryProducts
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    global.PriceHelpers = api;
})(typeof window !== 'undefined' ? window : globalThis);
