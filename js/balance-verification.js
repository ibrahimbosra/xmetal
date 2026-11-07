(function () {
    'use strict';

    var db = window.firebaseDb;
    var auth = window.firebaseAuth;
    var collection = 'balanceVerifications';
    var initialPageSize = 3;
    var additionalPageSize = 3;
    var thousandsSeparator = ',';
    var fieldLabels = {
        openingBalance: 'رصيد الدرج قبل بدء البيع',
        grossSales: 'إجمالي المبيعات الكاملة',
        debts: 'إجمالي الديون',
        debtPayments: 'إجمالي السدادات',
        withdrawals: 'إجمالي السحوبات',
        actualBalance: 'المبلغ الموجود في الدرج الآن'
    };
    var fieldNames = Object.keys(fieldLabels);
    var modal = document.getElementById('balanceVerificationModal');
    var form = document.getElementById('balanceVerificationForm');
    var fields = Array.from(form.querySelectorAll('[data-balance-field]'));
    var clearFieldButtons = Array.from(form.querySelectorAll('[data-clear-balance-field]'));
    var result = document.getElementById('balanceVerificationResult');
    var status = document.getElementById('balanceVerificationStatus');
    var totals = document.getElementById('balanceVerificationTotals');
    var equation = document.getElementById('balanceVerificationEquation');
    var message = document.getElementById('balanceVerificationMessage');
    var resultNote = document.getElementById('balanceVerificationNote');
    var feedback = document.getElementById('balanceVerificationFeedback');
    var saveButton = document.getElementById('saveBalanceVerification');
    var historyList = document.getElementById('balanceVerificationHistoryList');
    var historySection = document.querySelector('.balance-verification-history');
    var moreButton = document.getElementById('loadMoreBalanceVerifications');
    var detailPanel = document.getElementById('balanceVerificationDetail');
    var detailContent = document.getElementById('balanceVerificationDetailContent');
    var lastDocument = null;
    var hasMore = false;
    var loadingHistory = false;
    var historyReloadQueued = false;
    var displayedRecordCount = 0;
    var saving = false;
    var currentResult = null;
    var activeRecordId = null;
    var activeRecordSummary = null;
    var activeRecordDetail = null;
    var isAdminPage = document.body.classList.contains('mob-admin-page');
    var dailySalesTotal = Number(window.xmetalDailySalesTotal) || 0;
    var defaultsCustomized = false;

    function parseDecimal(value) {
        var text = String(value || '').trim().replace(/,/g, '');
        var match = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
        if (!match || (!match[1] && !match[2])) return null;
        var numeric = Number(text);
        if (!Number.isFinite(numeric) || numeric < 0) return null;
        var fraction = match[2] || '';
        var exponent = Number(match[3] || 0);
        var scale = fraction.length - exponent;
        var digits = (match[1] || '0') + fraction;
        if (Math.abs(exponent) > 100 || digits.length > 200) return null;
        if (scale < 0) {
            digits += '0'.repeat(-scale);
            scale = 0;
        }
        if (scale > 100 || digits.length + scale > 300) return null;
        var coefficient = BigInt(digits);
        return { coefficient: coefficient, scale: scale, text: text, numeric: numeric };
    }

    function scaledValue(decimal, scale) {
        return decimal.coefficient * (10n ** BigInt(scale - decimal.scale));
    }

    function decimalText(value, scale) {
        var negative = value < 0n;
        var absolute = negative ? -value : value;
        var digits = absolute.toString();
        if (scale === 0) return (negative ? '-' : '') + digits;
        digits = digits.padStart(scale + 1, '0');
        var whole = digits.slice(0, -scale);
        var fraction = digits.slice(-scale).replace(/0+$/, '');
        return (negative ? '-' : '') + whole + (fraction ? '.' + fraction : '');
    }

    function formatAmount(text) {
        var parts = String(text).replace(/[,،]/g, '').split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSeparator);
        return parts.join('.');
    }

    function formatInputValue(value) {
        var text = String(value).replace(/[,،]/g, '').replace(/[^\d.]/g, '');
        var decimalIndex = text.indexOf('.');
        if (decimalIndex !== -1) {
            text = text.slice(0, decimalIndex + 1) + text.slice(decimalIndex + 1).replace(/\./g, '');
        }
        var hasDecimal = text.indexOf('.') !== -1;
        var parts = text.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSeparator);
        return parts[0] + (hasDecimal ? '.' + (parts[1] || '') : '');
    }

    function formatInput(input) {
        var start = input.selectionStart;
        var beforeCaret = input.value.slice(0, start).replace(/[^\d.]/g, '').length;
        var formatted = formatInputValue(input.value);
        input.value = formatted;
        var caret = 0;
        var visibleCharacters = 0;
        while (caret < formatted.length && visibleCharacters < beforeCaret) {
            if (/\d|\./.test(formatted.charAt(caret))) visibleCharacters += 1;
            caret += 1;
        }
        input.setSelectionRange(caret, caret);
    }

    function defaultNumberText(value) {
        return String(Number(value.toFixed(2)));
    }

    function applyDefaultValues() {
        var dailySalesText = defaultNumberText(dailySalesTotal);
        var openingBalance = parseDecimal('50000');
        var grossSales = parseDecimal(dailySalesText);
        var scale = Math.max(openingBalance.scale, grossSales.scale);
        var actualBalance = decimalText(
            scaledValue(openingBalance, scale) + scaledValue(grossSales, scale),
            scale
        );
        var defaults = {
            openingBalance: '50000',
            grossSales: dailySalesText,
            debts: '0',
            debtPayments: '0',
            withdrawals: '0',
            actualBalance: actualBalance
        };
        fields.forEach(function (input) {
            input.value = formatInputValue(defaults[input.dataset.balanceField]);
        });
        calculate();
    }

    function renderEquation(container, values, expected) {
        var columns = [
            { label: 'الدرج', value: formatAmount(values.openingBalance), tone: 'increase' },
            { operator: '+', tone: 'increase' },
            { label: 'المبيعات', value: formatAmount(values.grossSales), tone: 'increase' },
            { operator: '+', tone: 'increase' },
            { label: 'السدادات', value: formatAmount(values.debtPayments), tone: 'increase' },
            { operator: '-', tone: 'decrease' },
            { label: 'الديون', value: formatAmount(values.debts), tone: 'decrease' },
            { operator: '-', tone: 'decrease' },
            { label: 'السحوبات', value: formatAmount(values.withdrawals), tone: 'decrease' },
            { operator: '=' },
            { label: 'النتيجة', value: formatAmount(expected) }
        ];
        var table = document.createElement('table');
        table.className = 'balance-verification-equation-table';
        table.setAttribute('aria-label', 'المعادلة التوضيحية لحساب الرصيد المتوقع');
        var body = document.createElement('tbody');
        var labelsRow = document.createElement('tr');
        var amountsRow = document.createElement('tr');
        columns.forEach(function (column) {
            if (column.operator) {
                var operator = document.createElement('td');
                operator.className = 'balance-verification-equation-operator-cell' +
                    (column.tone ? ' is-' + column.tone : '');
                operator.rowSpan = 2;
                operator.textContent = column.operator;
                operator.setAttribute('aria-hidden', 'true');
                labelsRow.appendChild(operator);
                return;
            }

            var label = document.createElement('th');
            label.className = 'balance-verification-equation-value-cell' +
                (column.tone ? ' is-' + column.tone : '');
            label.scope = 'col';
            label.textContent = column.label;
            labelsRow.appendChild(label);

            var amount = document.createElement('td');
            amount.className = 'balance-verification-equation-value-cell' +
                (column.tone ? ' is-' + column.tone : '');
            amount.dir = 'ltr';
            amount.textContent = column.value;
            amountsRow.appendChild(amount);
        });
        body.append(labelsRow, amountsRow);
        table.appendChild(body);
        container.replaceChildren(table);
    }

    function computeResult(parsed) {
        var scale = Math.max.apply(null, fieldNames.map(function (name) { return parsed[name].scale; }));
        var amounts = {};
        fieldNames.forEach(function (name) { amounts[name] = scaledValue(parsed[name], scale); });
        var expected = amounts.openingBalance + amounts.grossSales - amounts.debts + amounts.debtPayments - amounts.withdrawals;
        var difference = amounts.actualBalance - expected;
        var expectedText = decimalText(expected, scale);
        var differenceText = decimalText(difference, scale);
        if (!Number.isFinite(Number(expectedText)) || !Number.isFinite(Number(differenceText))) return null;
        return {
            status: difference === 0n ? 'correct' : difference < 0n ? 'short' : 'excess',
            valueTexts: fieldNames.reduce(function (texts, name) {
                texts[name] = parsed[name].text;
                return texts;
            }, {}),
            equationValues: fieldNames.reduce(function (texts, name) {
                texts[name] = decimalText(amounts[name], scale);
                return texts;
            }, {}),
            expectedText: expectedText,
            actualText: decimalText(amounts.actualBalance, scale),
            differenceText: differenceText
        };
    }

    function calculate() {
        var parsed = {};
        var invalid = false;
        var incomplete = false;
        fields.forEach(function (input) {
            var name = input.dataset.balanceField;
            var raw = input.value.trim();
            if (!raw) {
                incomplete = true;
                return;
            }
            parsed[name] = parseDecimal(raw);
            if (!parsed[name]) invalid = true;
        });

        if (invalid || incomplete) {
            currentResult = null;
            resultNote.hidden = true;
            totals.hidden = true;
            equation.hidden = true;
            equation.replaceChildren();
            saveButton.disabled = true;
            result.className = 'balance-verification-result ' + (invalid ? 'is-invalid' : 'is-incomplete');
            status.textContent = invalid ? 'تحقق من القيم المدخلة' : 'أدخل القيم الست لبدء التحقق';
            message.textContent = invalid ? 'يُسمح بالأرقام غير السالبة فقط.' : 'تُحسب النتيجة تلقائياً عند إدخال جميع القيم.';
            if (invalid) feedback.textContent = 'تأكد من إدخال أرقام صحيحة غير سالبة في جميع الخانات.';
            return;
        }

        currentResult = computeResult(parsed);
        if (!currentResult) {
            resultNote.hidden = true;
            totals.hidden = true;
            equation.hidden = true;
            equation.replaceChildren();
            saveButton.disabled = true;
            result.className = 'balance-verification-result is-invalid';
            status.textContent = 'القيم أكبر من الحد المسموح';
            message.textContent = 'أدخل مبالغ أصغر لإجراء التحقق بدقة.';
            return;
        }
        var resultMessages = {
            correct: ['الرصيد صحيح', 'ممتاز، الحساب صحيح وليس هناك أي مشاكل'],
            short: ['الرصيد ناقص', 'تأكد جيداً، هناك نقص في الأموال'],
            excess: ['الرصيد زائد', 'تأكد جيداً، هناك زيادة في الأموال']
        };
        var differenceMagnitude = currentResult.differenceText.charAt(0) === '-'
            ? currentResult.differenceText.slice(1)
            : currentResult.differenceText;
        result.className = 'balance-verification-result is-' + currentResult.status;
        status.textContent = resultMessages[currentResult.status][0] +
            (currentResult.status === 'correct' ? '' : ' — ' +
                (currentResult.status === 'short' ? 'قيمة النقص: ' : 'قيمة الزيادة: ') +
                formatAmount(differenceMagnitude));
        message.textContent = resultMessages[currentResult.status][1];
        resultNote.hidden = currentResult.status === 'correct';
        resultNote.textContent = currentResult.status === 'short'
            ? 'راجع سجلاتك وتذكر جيدا, ربما هناك ديون او سحوبات غير مسجلة'
            : currentResult.status === 'excess'
                ? 'راجع سجلاتك وتذكر جيدا, ربما هناك مبيعات او سدادات غير مسجلة'
                : '';
        totals.hidden = false;
        totals.textContent = 'الرصيد المتوقع: ' + formatAmount(currentResult.expectedText) + ' | الرصيد الفعلي: ' + formatAmount(currentResult.actualText);
        renderEquation(equation, currentResult.equationValues, currentResult.expectedText);
        equation.hidden = false;
        saveButton.disabled = false;
    }

    function dateFromTimestamp(timestamp) {
        if (timestamp && typeof timestamp.toDate === 'function') return timestamp.toDate();
        if (timestamp instanceof Date) return timestamp;
        return new Date(timestamp || Date.now());
    }

    function formatDateTime(timestamp) {
        var date = dateFromTimestamp(timestamp);
        var weekday = new Intl.DateTimeFormat('ar', { weekday: 'long' }).format(date);
        var formattedDate = new Intl.DateTimeFormat('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).format(date);
        var formattedTime = new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).format(date);
        return weekday + ' ' + formattedDate + ' — ' + formattedTime;
    }

    function statusLabel(value) {
        return value === 'correct' ? 'الرصيد صحيح' : value === 'short' ? 'الرصيد ناقص' : 'الرصيد زائد';
    }

    function displayCreatorName(value) {
        var name = String(value || '').trim();
        if (!name) return 'مستخدم غير محدد';
        if (/@/.test(name)) {
            var helpers = window.XMetalMobileSalesHelpers;
            var resolved = helpers && helpers.resolveSellerName
                ? helpers.resolveSellerName(name, '', window.xmetalUserDisplayNameMap || {})
                : '';
            return resolved && resolved !== name && !/@/.test(resolved) ? resolved : 'مستخدم غير محدد';
        }
        return name;
    }

    function currentUserDisplayName(user) {
        var email = String(user.email || '').trim();
        var helpers = window.XMetalMobileSalesHelpers;
        var resolved = helpers && helpers.resolveSellerName
            ? helpers.resolveSellerName(email, String(user.displayName || '').trim(), window.xmetalUserDisplayNameMap || {})
            : String(user.displayName || '').trim();
        return resolved && !/@/.test(resolved) ? resolved : 'مستخدم غير محدد';
    }

    function showHistoryMessage(text) {
        historyList.replaceChildren();
        var messageElement = document.createElement('p');
        messageElement.className = 'balance-verification-history-empty';
        messageElement.textContent = text;
        historyList.appendChild(messageElement);
    }

    function renderSummary(doc, index) {
        var record = doc.data();
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'balance-verification-history-item is-' + record.status;
        button.dataset.balanceVerificationId = doc.id;
        var copy = document.createElement('span');
        copy.className = 'balance-verification-history-copy';
        var title = document.createElement('strong');
        title.textContent = String(index) + '. تحقق حساب — ' + formatDateTime(record.createdAt);
        var creator = document.createElement('span');
        creator.textContent = displayCreatorName(record.createdByName);
        var badge = document.createElement('span');
        badge.className = 'balance-verification-status is-' + record.status;
        badge.textContent = statusLabel(record.status);
        copy.append(title, creator);
        button.append(copy, badge);
        historyList.appendChild(button);
    }

    async function loadHistory(reset) {
        if (!db) {
            showHistoryMessage('تعذر الاتصال بقاعدة البيانات.');
            return;
        }
        if (loadingHistory) {
            if (reset) historyReloadQueued = true;
            return;
        }
        if (reset) {
            lastDocument = null;
            hasMore = false;
            displayedRecordCount = 0;
            historyList.replaceChildren();
            moreButton.hidden = true;
        }
        loadingHistory = true;
        moreButton.disabled = true;
        if (!historyList.children.length) showHistoryMessage('جارٍ تحميل السجل...');
        try {
            if (typeof window.xmetalRefreshUserDisplayNameMap === 'function') {
                try {
                    await window.xmetalRefreshUserDisplayNameMap();
                } catch (nameError) {
                    console.warn('Unable to refresh user names before loading balance verification history.', nameError);
                }
            }
            var requestedCount = reset ? initialPageSize : additionalPageSize;
            var query = db.collection(collection).orderBy('createdAt', 'desc').limit(requestedCount + 1);
            if (lastDocument) query = query.startAfter(lastDocument);
            var snapshot = await query.get();
            if (reset) historyList.replaceChildren();
            var visibleDocs = snapshot.docs.slice(0, requestedCount);
            visibleDocs.forEach(function (doc) {
                displayedRecordCount += 1;
                renderSummary(doc, displayedRecordCount);
            });
            if (visibleDocs.length) lastDocument = visibleDocs[visibleDocs.length - 1];
            hasMore = snapshot.docs.length > visibleDocs.length;
            moreButton.hidden = !hasMore;
            if (!historyList.children.length) showHistoryMessage('لا توجد عمليات تحقق محفوظة.');
        } catch (error) {
            console.error('Unable to load balance verification summaries:', error);
            if (reset || !historyList.children.length) {
                showHistoryMessage('تعذر تحميل سجل التحقق. تحقق من الاتصال والصلاحيات ثم أعد فتح الحاسبة.');
            } else {
                var errorMessage = document.createElement('p');
                errorMessage.className = 'balance-verification-history-empty';
                errorMessage.textContent = 'تعذر تحميل المزيد من العمليات.';
                historyList.appendChild(errorMessage);
            }
        } finally {
            loadingHistory = false;
            moreButton.disabled = false;
            if (historyReloadQueued) {
                historyReloadQueued = false;
                loadHistory(true);
            }
        }
    }

    function appendDetailRow(list, label, value) {
        var term = document.createElement('dt');
        term.textContent = label;
        var description = document.createElement('dd');
        description.textContent = value;
        list.append(term, description);
    }

    function renderRecordDetails(summary, detail, notice) {
        var definitionList = document.createElement('dl');
        definitionList.className = 'balance-verification-detail-grid';
        fieldNames.forEach(function (name) {
            appendDetailRow(definitionList, fieldLabels[name], formatAmount(detail.values[name]));
        });
        appendDetailRow(definitionList, 'الرصيد المتوقع', formatAmount(detail.expectedBalance));
        var detailEquation = document.createElement('div');
        detailEquation.className = 'balance-verification-equation';
        renderEquation(detailEquation, detail.values, detail.expectedBalance);
        appendDetailRow(definitionList, 'الرصيد الفعلي', formatAmount(detail.actualBalance));
        appendDetailRow(definitionList, 'الفرق', formatAmount(detail.difference));
        var resultElement = document.createElement('section');
        resultElement.className = 'balance-verification-result balance-verification-detail-result is-' + detail.status;
        var resultHeading = document.createElement('strong');
        var resultAmount = detail.status === 'correct'
            ? detail.actualBalance
            : String(detail.difference).replace(/^-/, '');
        resultHeading.textContent = statusLabel(detail.status) + ' بقيمة ' + formatAmount(resultAmount);
        var resultMessage = document.createElement('p');
        resultMessage.textContent = detail.status === 'correct'
            ? 'ممتاز، الحساب صحيح وليس هناك أي مشاكل'
            : detail.status === 'short' ? 'تأكد جيداً، هناك نقص في الأموال' : 'تأكد جيداً، هناك زيادة في الأموال';
        resultElement.append(resultHeading, resultMessage);
        if (detail.status !== 'correct') {
            var resultNote = document.createElement('p');
            resultNote.className = 'balance-verification-note';
            resultNote.textContent = detail.status === 'short'
                ? 'راجع سجلاتك وتذكر جيدا, ربما هناك ديون او سحوبات غير مسجلة'
                : 'راجع سجلاتك وتذكر جيدا, ربما هناك مبيعات او سدادات غير مسجلة';
            resultElement.appendChild(resultNote);
        }
        var meta = document.createElement('div');
        meta.className = 'balance-verification-detail-meta';
        var timestamp = document.createElement('time');
        timestamp.dateTime = dateFromTimestamp(summary.createdAt).toISOString();
        timestamp.textContent = 'تاريخ ووقت التحقق: ' + formatDateTime(summary.createdAt);
        var creator = document.createElement('span');
        creator.textContent = 'أجرى التحقق: ' + displayCreatorName(summary.createdByName);
        meta.append(timestamp, creator);
        detailContent.replaceChildren(definitionList, detailEquation, resultElement, meta);

        if (isAdminPage) {
            var actions = document.createElement('div');
            actions.className = 'balance-verification-admin-actions';
            var editButton = document.createElement('button');
            editButton.type = 'button';
            editButton.className = 'balance-verification-edit';
            editButton.textContent = 'تعديل العملية';
            editButton.addEventListener('click', renderEditForm);
            var deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'balance-verification-delete';
            deleteButton.textContent = 'حذف العملية';
            deleteButton.addEventListener('click', deleteActiveRecord);
            actions.append(editButton, deleteButton);
            detailContent.appendChild(actions);
            if (notice) {
                var noticeElement = document.createElement('p');
                noticeElement.className = 'balance-verification-admin-notice';
                noticeElement.textContent = notice;
                detailContent.appendChild(noticeElement);
            }
        }
    }

    function renderEditForm() {
        if (!isAdminPage || !activeRecordDetail) return;
        var editForm = document.createElement('form');
        editForm.className = 'balance-verification-edit-form';
        editForm.noValidate = true;
        var fieldsContainer = document.createElement('div');
        fieldsContainer.className = 'balance-verification-fields';
        fieldNames.forEach(function (name) {
            var label = document.createElement('label');
            label.textContent = fieldLabels[name];
            var input = document.createElement('input');
            input.type = 'text';
            input.inputMode = 'decimal';
            input.autocomplete = 'off';
            input.dataset.editBalanceField = name;
            input.value = formatInputValue(activeRecordDetail.values[name]);
            input.addEventListener('input', function () { formatInput(input); });
            label.appendChild(input);
            fieldsContainer.appendChild(label);
        });
        var editFeedback = document.createElement('p');
        editFeedback.className = 'balance-verification-admin-notice';
        editFeedback.setAttribute('role', 'status');
        var actions = document.createElement('div');
        actions.className = 'balance-verification-admin-actions';
        var saveEdit = document.createElement('button');
        saveEdit.type = 'submit';
        saveEdit.className = 'balance-verification-edit';
        saveEdit.textContent = 'حفظ التعديل';
        var cancelEdit = document.createElement('button');
        cancelEdit.type = 'button';
        cancelEdit.className = 'balance-verification-cancel-edit';
        cancelEdit.textContent = 'إلغاء';
        cancelEdit.addEventListener('click', function () {
            renderRecordDetails(activeRecordSummary, activeRecordDetail);
        });
        actions.append(saveEdit, cancelEdit);
        editForm.append(fieldsContainer, editFeedback, actions);
        editForm.addEventListener('submit', async function (event) {
            event.preventDefault();
            if (saving || !activeRecordId) return;
            var parsed = {};
            var invalid = false;
            Array.from(editForm.querySelectorAll('[data-edit-balance-field]')).forEach(function (input) {
                var raw = input.value.trim();
                parsed[input.dataset.editBalanceField] = raw ? parseDecimal(raw) : null;
                if (!parsed[input.dataset.editBalanceField]) invalid = true;
            });
            var updatedResult = invalid ? null : computeResult(parsed);
            if (!updatedResult) {
                editFeedback.textContent = invalid
                    ? 'أدخل مبالغ صحيحة غير سالبة في الخانات الست.'
                    : 'القيم أكبر من الحد المسموح لإجراء الحساب.';
                return;
            }
            saving = true;
            saveEdit.disabled = true;
            cancelEdit.disabled = true;
            editFeedback.textContent = 'جارٍ حفظ التعديل...';
            try {
                var recordRef = db.collection(collection).doc(activeRecordId);
                var detailRef = recordRef.collection('details').doc('entry');
                var writeBatch = db.batch();
                writeBatch.update(recordRef, { status: updatedResult.status });
                writeBatch.update(detailRef, {
                    values: updatedResult.valueTexts,
                    expectedBalance: updatedResult.expectedText,
                    actualBalance: updatedResult.valueTexts.actualBalance,
                    difference: updatedResult.differenceText,
                    status: updatedResult.status
                });
                await writeBatch.commit();
                activeRecordSummary.status = updatedResult.status;
                activeRecordDetail = {
                    values: updatedResult.valueTexts,
                    expectedBalance: updatedResult.expectedText,
                    actualBalance: updatedResult.valueTexts.actualBalance,
                    difference: updatedResult.differenceText,
                    status: updatedResult.status
                };
                renderRecordDetails(activeRecordSummary, activeRecordDetail, 'تم حفظ تعديل العملية.');
                await loadHistory(true);
            } catch (error) {
                console.error('Unable to update balance verification:', error);
                editFeedback.textContent = 'تعذر حفظ التعديل. تحقق من الاتصال والصلاحيات ثم حاول مجدداً.';
            } finally {
                saving = false;
            }
        });
        detailContent.replaceChildren(editForm);
        fieldsContainer.querySelector('input').focus();
    }

    async function deleteActiveRecord() {
        if (!isAdminPage || !activeRecordId || saving) return;
        if (!window.confirm('هل تريد حذف عملية التحقق نهائيًا؟')) return;
        saving = true;
        try {
            var recordRef = db.collection(collection).doc(activeRecordId);
            var writeBatch = db.batch();
            writeBatch.delete(recordRef.collection('details').doc('entry'));
            writeBatch.delete(recordRef);
            await writeBatch.commit();
            detailBack();
            await loadHistory(true);
        } catch (error) {
            console.error('Unable to delete balance verification:', error);
            renderRecordDetails(activeRecordSummary, activeRecordDetail, 'تعذر حذف العملية. تحقق من الاتصال والصلاحيات ثم حاول مجدداً.');
        } finally {
            saving = false;
        }
    }

    async function showDetails(id, button) {
        button.disabled = true;
        activeRecordId = id;
        activeRecordSummary = null;
        activeRecordDetail = null;
        detailPanel.hidden = false;
        detailContent.replaceChildren();
        var loading = document.createElement('p');
        loading.className = 'balance-verification-detail-loading';
        loading.textContent = 'جارٍ تحميل تفاصيل العملية...';
        detailContent.appendChild(loading);
        try {
            var doc = await db.collection(collection).doc(id).get();
            if (!doc.exists) throw new Error('Balance verification record was not found.');
            var summary = doc.data();
            var detailDoc = await doc.ref.collection('details').doc('entry').get();
            if (!detailDoc.exists) throw new Error('Balance verification details were not found.');
            if (activeRecordId !== id) return;
            var detail = detailDoc.data();
            activeRecordSummary = summary;
            activeRecordDetail = detail;
            renderRecordDetails(summary, detail);
        } catch (error) {
            console.error('Unable to load balance verification details:', error);
            var errorMessage = document.createElement('p');
            errorMessage.className = 'balance-verification-history-empty';
            errorMessage.textContent = 'تعذر تحميل تفاصيل العملية. تحقق من الاتصال والصلاحيات ثم حاول مجدداً.';
            detailContent.replaceChildren(errorMessage);
        } finally {
            button.disabled = false;
        }
    }

    function setModalOpen(open) {
        modal.hidden = !open;
        if (open) {
            if (!defaultsCustomized) applyDefaultValues();
            document.body.style.overflow = 'hidden';
            feedback.textContent = '';
            detailPanel.hidden = true;
            moreButton.hidden = true;
            loadHistory(true);
            document.getElementById('closeBalanceVerification').focus();
            return;
        }
        if (!document.querySelector('.modal-backdrop:not([hidden])')) document.body.style.overflow = '';
    }

    function detailBack() {
        detailPanel.hidden = true;
        detailContent.replaceChildren();
        activeRecordId = null;
        activeRecordSummary = null;
        activeRecordDetail = null;
    }

    fields.forEach(function (input) {
        input.addEventListener('input', function () {
            defaultsCustomized = true;
            formatInput(input);
            if (feedback.textContent !== 'جارٍ حفظ التحقق...') feedback.textContent = '';
            calculate();
        });
    });
    clearFieldButtons.forEach(function (button) {
        button.addEventListener('click', function () {
            if (saving) return;
            var input = form.querySelector('[data-balance-field="' + button.dataset.clearBalanceField + '"]');
            if (!input) return;
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
        });
    });
    window.addEventListener('xmetal:daily-sales-total', function (event) {
        var total = Number(event.detail && event.detail.total);
        if (!Number.isFinite(total) || total < 0) {
            console.warn('Ignoring an invalid daily sales total for balance verification.');
            return;
        }
        dailySalesTotal = total;
        if (!defaultsCustomized) applyDefaultValues();
    });
    form.addEventListener('submit', async function (event) {
        event.preventDefault();
        if (saving) return;
        calculate();
        if (!currentResult || !auth || !auth.currentUser || !db || !window.firebase || !firebase.firestore) {
            feedback.textContent = currentResult ? 'يلزم تسجيل الدخول والاتصال بقاعدة البيانات لحفظ التحقق.' : 'أكمل القيم الست وتأكد من صحتها قبل الحفظ.';
            return;
        }
        var user = auth.currentUser;
        saving = true;
        saveButton.disabled = true;
        fields.forEach(function (input) { input.disabled = true; });
        clearFieldButtons.forEach(function (button) { button.disabled = true; });
        feedback.textContent = 'جارٍ حفظ التحقق...';
        try {
            if (typeof window.xmetalRefreshUserDisplayNameMap === 'function') {
                try {
                    await window.xmetalRefreshUserDisplayNameMap();
                } catch (nameError) {
                    console.warn('Unable to refresh user display names before saving a balance verification.', nameError);
                }
            }
            var createdByName = currentUserDisplayName(user);
            var createdAt = firebase.firestore.FieldValue.serverTimestamp();
            var recordRef = db.collection(collection).doc();
            var writeBatch = db.batch();
            writeBatch.set(recordRef, {
                status: currentResult.status,
                createdAt: createdAt,
                createdByUid: user.uid,
                createdByName: createdByName
            });
            writeBatch.set(recordRef.collection('details').doc('entry'), {
                values: currentResult.valueTexts,
                expectedBalance: currentResult.expectedText,
                actualBalance: currentResult.valueTexts.actualBalance,
                difference: currentResult.differenceText,
                status: currentResult.status
            });
            await writeBatch.commit();
            feedback.textContent = 'تم حفظ عملية التحقق بنجاح.';
            saveButton.disabled = !currentResult;
            await loadHistory(true);
        } catch (error) {
            console.error('Unable to save balance verification:', error);
            calculate();
            feedback.textContent = 'تعذر حفظ العملية. تحقق من الاتصال والصلاحيات ثم حاول مجدداً.';
        } finally {
            saving = false;
            fields.forEach(function (input) { input.disabled = false; });
            clearFieldButtons.forEach(function (button) { button.disabled = false; });
        }
    });

    document.getElementById('openBalanceVerification').addEventListener('click', function () { setModalOpen(true); });
    document.getElementById('closeBalanceVerification').addEventListener('click', function () { setModalOpen(false); });
    modal.addEventListener('click', function (event) {
        if (event.target === modal) setModalOpen(false);
    });
    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || modal.hidden) return;
        if (!detailPanel.hidden) detailBack();
        else setModalOpen(false);
    });
    detailPanel.addEventListener('click', function (event) {
        if (event.target === detailPanel) detailBack();
    });
    moreButton.addEventListener('click', function () { if (hasMore) loadHistory(false); });
    historyList.addEventListener('click', function (event) {
        var button = event.target.closest('[data-balance-verification-id]');
        if (button) showDetails(button.dataset.balanceVerificationId, button);
    });
    document.getElementById('backToBalanceVerificationHistory').addEventListener('click', detailBack);
})();
