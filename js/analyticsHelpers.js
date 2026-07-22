(function(root, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.AnalyticsHelpers = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
    function toNumber(value) {
        var n = Number(value);
        return isNaN(n) ? 0 : n;
    }

    function getSaleWindow(sales) {
        if (!Array.isArray(sales) || !sales.length) {
            return { firstSaleTimestamp: null, lastSaleTimestamp: null };
        }
        var timestamps = sales
            .map(function(sale) { return Number(sale && sale.timestamp) || 0; })
            .filter(function(timestamp) { return timestamp > 0; });
        if (!timestamps.length) {
            return { firstSaleTimestamp: null, lastSaleTimestamp: null };
        }
        return {
            firstSaleTimestamp: Math.min.apply(null, timestamps),
            lastSaleTimestamp: Math.max.apply(null, timestamps)
        };
    }

    function buildStatsFromSales(sales, expenses, startTimestamp, endTimestamp) {
        var salesWindow = Array.isArray(sales) ? sales.filter(function(sale) {
            var timestamp = Number(sale && sale.timestamp) || 0;
            var withinStart = startTimestamp === null || startTimestamp === undefined || timestamp >= startTimestamp;
            var withinEnd = endTimestamp === null || endTimestamp === undefined || timestamp <= endTimestamp;
            return withinStart && withinEnd;
        }) : [];

        var revenue = salesWindow.reduce(function(total, sale) {
            return total + toNumber(sale && sale.totalAmount);
        }, 0);
        var grossProfit = salesWindow.reduce(function(total, sale) {
            return total + toNumber(sale && sale.profit);
        }, 0);
        var qtySold = salesWindow.reduce(function(total, sale) {
            return total + toNumber(sale && sale.quantity);
        }, 0);
        var expensesValue = Array.isArray(expenses) ? expenses.reduce(function(total, expense) {
            var timestamp = Number(expense && expense.date) || 0;
            var withinStart = startTimestamp === null || startTimestamp === undefined || timestamp >= startTimestamp;
            var withinEnd = endTimestamp === null || endTimestamp === undefined || timestamp <= endTimestamp;
            return total + (withinStart && withinEnd ? toNumber(expense && expense.amount) : 0);
        }, 0) : 0;

        return {
            revenue: revenue,
            grossProfit: grossProfit,
            netProfit: grossProfit - expensesValue,
            expenses: expensesValue,
            salesCount: salesWindow.length,
            qtySold: qtySold,
            startTimestamp: startTimestamp,
            endTimestamp: endTimestamp
        };
    }

    function buildLazyProfitSummary(sales, expenses) {
        var range = getSaleWindow(sales);
        var stats = buildStatsFromSales(sales, expenses, range.firstSaleTimestamp, range.lastSaleTimestamp);
        return {
            salesCount: stats.salesCount,
            revenue: stats.revenue,
            grossProfit: stats.grossProfit,
            netProfit: stats.netProfit,
            expenses: stats.expenses,
            qtySold: stats.qtySold,
            firstSaleTimestamp: range.firstSaleTimestamp,
            lastSaleTimestamp: range.lastSaleTimestamp
        };
    }

    function buildMonthStats(sales, monthKey, expenses) {
        var parts = String(monthKey || '').split('-');
        if (parts.length < 2) {
            return buildStatsFromSales(sales, expenses, null, null);
        }
        var year = parseInt(parts[0], 10);
        var monthIndex = parseInt(parts[1], 10) - 1;
        var start = new Date(year, monthIndex, 1).getTime();
        var end = new Date(year, monthIndex + 1, 1).getTime();
        var monthSales = Array.isArray(sales) ? sales.filter(function(sale) {
            var timestamp = Number(sale && sale.timestamp) || 0;
            return timestamp >= start && timestamp < end;
        }) : [];
        var actualStart = monthSales.length ? monthSales.reduce(function(current, sale) {
            var timestamp = Number(sale && sale.timestamp) || 0;
            return current === null || timestamp < current ? timestamp : current;
        }, null) : null;
        var actualEnd = monthSales.length ? monthSales.reduce(function(current, sale) {
            var timestamp = Number(sale && sale.timestamp) || 0;
            return current === null || timestamp > current ? timestamp : current;
        }, null) : null;
        var stats = buildStatsFromSales(monthSales, expenses, actualStart, actualEnd);
        return {
            salesCount: stats.salesCount,
            revenue: stats.revenue,
            grossProfit: stats.grossProfit,
            netProfit: stats.netProfit,
            expenses: stats.expenses,
            qtySold: stats.qtySold,
            periodStart: actualStart,
            periodEnd: actualEnd,
            monthKey: monthKey
        };
    }

    return {
        buildLazyProfitSummary: buildLazyProfitSummary,
        buildMonthStats: buildMonthStats,
        buildStatsFromSales: buildStatsFromSales
    };
});
