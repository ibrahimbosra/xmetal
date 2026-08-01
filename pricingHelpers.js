(function (global) {
    function toNumber(value) {
        var parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
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
        getMechanicDisplayPrice: getMechanicDisplayPrice,
        getProfitPercent: getProfitPercent,
        sortInventoryProducts: sortInventoryProducts
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    global.PriceHelpers = api;
})(typeof window !== 'undefined' ? window : globalThis);
