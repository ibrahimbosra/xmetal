(function () {
    'use strict';

    var dataSource = window.XMETALChallengeData;
    var modal = document.getElementById('xmetalChallengeModal');
    var menu = document.getElementById('xmetalChallengeMenu');
    var playScreen = document.getElementById('xmetalChallengePlay');
    var resultsScreen = document.getElementById('xmetalChallengeResults');
    var notice = document.getElementById('xmetalChallengeNotice');
    var optionsElement = document.getElementById('xmetalChallengeOptions');
    var priceFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
    var profile = createEmptyProfile();
    var profileKey = '';
    var previousBestScore = null;
    var mode = '';
    var pool = [];
    var initialQuestionCount = 0;
    var currentQuestion = null;
    var questionNumber = 0;
    var score = 0;
    var correctCount = 0;
    var wrongCount = 0;
    var streak = 0;
    var longestStreak = 0;
    var trueStatementQuestionCount = 0;
    var falseStatementQuestionCount = 0;
    var lastQuestionSignature = '';
    var answered = false;
    var memoryProfiles = {};
    var memoryAnonymousId = '';

    function byId(id) {
        return document.getElementById(id);
    }

    function createEmptyProfile() {
        return {
            totalPoints: 0,
            bestScore: null,
            completedGames: 0,
            totalCorrect: 0,
            totalWrong: 0,
            lastPlayedAt: null
        };
    }

    function randomItem(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    function shuffle(array) {
        for (var index = array.length - 1; index > 0; index -= 1) {
            var other = Math.floor(Math.random() * (index + 1));
            var item = array[index];
            array[index] = array[other];
            array[other] = item;
        }
        return array;
    }

    function numericValue(value) {
        if (value === null || value === undefined || value === '') return null;
        var parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }

    function displayPriceValue(value) {
        var displayValue = dataSource && dataSource.getDisplayPrice
            ? Number(dataSource.getDisplayPrice(value))
            : Number(value);
        return Number.isFinite(displayValue) ? displayValue : Number(value);
    }

    function formatPrice(value) {
        var formatted = priceFormatter.format(displayPriceValue(value));
        var symbol = dataSource && dataSource.getCurrencySymbol
            ? String(dataSource.getCurrencySymbol() || '').trim()
            : '';
        return symbol ? formatted + ' ' + symbol : formatted;
    }

    function validImageUrl(value) {
        if (typeof value !== 'string' || !value.trim()) return '';
        var source = value.trim();
        if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);/i.test(source)) return source;
        try {
            var url = new URL(source, window.location.href);
            if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'blob:') return source;
            if (window.location.protocol === 'file:' && url.protocol === 'file:') return source;
        } catch (error) {
            return '';
        }
        return '';
    }

    function normalizeProducts(source) {
        var products = [];
        var seenIds = {};
        (Array.isArray(source) ? source : []).forEach(function (item, index) {
            if (!item || typeof item !== 'object') return;
            var id = String(item.id || '');
            var name = String(item.name || '').trim();
            if (!id || !name || seenIds[id]) return;
            seenIds[id] = true;
            var images = Array.isArray(item.images) ? item.images.map(function (image) {
                return image && validImageUrl(image.url) ? {
                    url: validImageUrl(image.url),
                    isPrimary: Boolean(image.isPrimary)
                } : null;
            }).filter(Boolean) : [];
            var primaryImage = images.find(function (image) { return image.isPrimary; }) || images[0] || null;
            products.push({
                id: id,
                name: name,
                salePrice: numericValue(item.salePrice),
                mechanicPrice: numericValue(item.mechanicPrice),
                inStock: numericValue(item.quantity) > 0,
                image: primaryImage ? primaryImage.url : '',
                index: index
            });
        });
        return products;
    }

    function uniquePriceProducts(products, field) {
        var unique = [];
        var usedPrices = {};
        products.forEach(function (product) {
            var value = product[field];
            if (value === null) return;
            var key = String(displayPriceValue(value));
            if (usedPrices[key]) return;
            usedPrices[key] = true;
            unique.push({ product: product, value: value });
        });
        return unique;
    }

    function distinctImageChoices(product, imageProducts) {
        var choices = [product];
        var usedImages = {};
        usedImages[product.image] = true;
        shuffle(imageProducts.filter(function (other) {
            return other.id !== product.id && !usedImages[other.image];
        })).forEach(function (other) {
            if (choices.length < 3 && !usedImages[other.image]) {
                usedImages[other.image] = true;
                choices.push(other);
            }
        });
        return choices.length === 3 ? choices : null;
    }

    function makePriceQuestion(product, field, questionType, distractors) {
        var choices = [{ key: String(product[field]), value: product[field], correct: true }];
        shuffle(distractors).slice(0, 2).forEach(function (entry) {
            choices.push({ key: String(entry.value), value: entry.value, correct: false });
        });
        if (choices.length !== 3) return null;
        shuffle(choices);
        return {
            signature: questionType + ':' + product.id,
            type: questionType,
            name: product.name,
            choices: choices
        };
    }

    function buildQuestionDeck() {
        var products = normalizeProducts(dataSource && dataSource.getProducts ? dataSource.getProducts() : []);
        var deck = [];
        var imageProducts = products.filter(function (product) { return Boolean(product.image); });

        if (imageProducts.length >= 3) {
            imageProducts.forEach(function (product) {
                var options = distinctImageChoices(product, imageProducts);
                if (!options) return;
                shuffle(options);
                deck.push({
                    signature: 'image:' + product.id,
                    type: 'image',
                    name: product.name,
                    answerKey: product.id,
                    options: options.map(function (option) {
                        return { key: option.id, name: option.name, image: option.image };
                    })
                });
            });
        }

        [
            { field: 'salePrice', type: 'customer-price', label: 'الزبون' },
            { field: 'mechanicPrice', type: 'mechanic-price', label: 'الميكانيكي' }
        ].forEach(function (priceType) {
            var available = uniquePriceProducts(products.filter(function (product) {
                return product.inStock;
            }), priceType.field);
            if (available.length >= 3) {
                available.forEach(function (entry) {
                    var question = makePriceQuestion(entry.product, priceType.field, priceType.type,
                        available.filter(function (other) { return other.product.id !== entry.product.id; }));
                    if (!question) return;
                    question.label = priceType.label;
                    deck.push(question);
                });
            }
            if (available.length < 2) return;

            var priceValues = available.filter(function (entry) { return entry.value !== null; });
            available.forEach(function (entry) {
                deck.push({
                    signature: 'truefalse:' + priceType.type + ':true:' + entry.product.id,
                    type: 'truefalse-price',
                    trueFalse: true,
                    name: entry.product.name,
                    label: priceType.label,
                    statement: 'سعر بيع ' + entry.product.name + ' لـ' + priceType.label + ' هو ' + formatPrice(entry.value)
                });
                var falseValues = priceValues.filter(function (other) {
                    return displayPriceValue(other.value) !== displayPriceValue(entry.value);
                });
                if (!falseValues.length) return;
                var falseValue = randomItem(falseValues).value;
                deck.push({
                    signature: 'truefalse:' + priceType.type + ':false:' + entry.product.id,
                    type: 'truefalse-price',
                    trueFalse: false,
                    name: entry.product.name,
                    label: priceType.label,
                    statement: 'سعر بيع ' + entry.product.name + ' لـ' + priceType.label + ' هو ' + formatPrice(falseValue)
                });
            });
        });

        if (imageProducts.some(function (product) {
            return imageProducts.some(function (other) { return other.id !== product.id && other.image !== product.image; });
        })) {
            imageProducts.forEach(function (product) {
                var otherProducts = imageProducts.filter(function (entry) {
                    return entry.id !== product.id && entry.image !== product.image;
                });
                if (!otherProducts.length) return;
                deck.push({
                    signature: 'truefalse:image:true:' + product.id,
                    type: 'truefalse-image',
                    trueFalse: true,
                    name: product.name,
                    promptImage: product.image,
                    statement: 'هذه الصورة تخص المنتج ' + product.name
                });
                var other = randomItem(otherProducts);
                deck.push({
                    signature: 'truefalse:image:false:' + product.id + ':' + other.id,
                    type: 'truefalse-image',
                    trueFalse: false,
                    name: product.name,
                    promptImage: other.image,
                    statement: 'هذه الصورة تخص المنتج ' + product.name
                });
            });
        }

        var questionGroups = {};
        deck.forEach(function (question) {
            var group = question.type === 'truefalse-price' || question.type === 'truefalse-image'
                ? 'truefalse'
                : question.type;
            if (!questionGroups[group]) questionGroups[group] = [];
            questionGroups[group].push(question);
        });
        var groupNames = Object.keys(questionGroups);
        groupNames.forEach(function (group) { shuffle(questionGroups[group]); });
        var mixedDeck = [];
        while (groupNames.length) {
            shuffle(groupNames).forEach(function (group) {
                if (questionGroups[group].length) mixedDeck.push(questionGroups[group].pop());
            });
            groupNames = groupNames.filter(function (group) { return questionGroups[group].length; });
        }
        return mixedDeck;
    }

    function selectRoundQuestions(deck, target) {
        if (!target || deck.length <= target) return deck.slice();
        var selected = deck.slice(0, target);
        var remaining = deck.slice(target);
        var trueCount = selected.filter(function (question) { return question.trueFalse === true; }).length;
        var falseCount = selected.filter(function (question) { return question.trueFalse === false; }).length;

        while (Math.abs(trueCount - falseCount) > 1) {
            var excessTruth = trueCount > falseCount;
            var selectedIndex = selected.findIndex(function (question) {
                return question.trueFalse === excessTruth;
            });
            var replacementIndex = remaining.findIndex(function (question) {
                return question.trueFalse !== undefined && question.trueFalse !== excessTruth;
            });
            if (selectedIndex < 0 || replacementIndex < 0) break;

            var displaced = selected[selectedIndex];
            var replacement = remaining[replacementIndex];
            selected[selectedIndex] = replacement;
            remaining[replacementIndex] = displaced;
            if (excessTruth) {
                trueCount -= 1;
                falseCount += 1;
            } else {
                falseCount -= 1;
                trueCount += 1;
            }
        }
        return selected;
    }

    function getAnonymousId() {
        try {
            var value = window.localStorage.getItem('xmetalChallengeAnonymousId');
            if (value) return value;
            value = window.crypto && window.crypto.randomUUID
                ? window.crypto.randomUUID()
                : 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
            window.localStorage.setItem('xmetalChallengeAnonymousId', value);
            return value;
        } catch (error) {
            console.warn('Unable to access localStorage for the XMETAL challenge identity.', error);
            if (!memoryAnonymousId) memoryAnonymousId = 'session-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
            return memoryAnonymousId;
        }
    }

    function currentProfileKey() {
        var userId = dataSource && dataSource.getUserId ? String(dataSource.getUserId() || '').trim() : '';
        return 'xmetalChallengeResultsV1:' + (userId ? 'user-' + userId : 'local-' + getAnonymousId());
    }

    function loadProfile() {
        profileKey = currentProfileKey();
        try {
            var saved = window.localStorage.getItem(profileKey);
            var parsed = saved ? JSON.parse(saved) : null;
            profile = Object.assign(createEmptyProfile(), parsed || {});
        } catch (error) {
            console.warn('Unable to load XMETAL challenge results from localStorage.', error);
            profile = Object.assign(createEmptyProfile(), memoryProfiles[profileKey] || {});
        }
        renderBestSummary();
    }

    function saveProfile() {
        try {
            window.localStorage.setItem(profileKey, JSON.stringify(profile));
            return true;
        } catch (error) {
            console.warn('Unable to save XMETAL challenge results to localStorage.', error);
            memoryProfiles[profileKey] = Object.assign({}, profile);
            notice.textContent = 'تعذر حفظ النتائج على هذا الجهاز، وستبقى متاحة حتى إغلاق الصفحة.';
            return false;
        }
    }

    function renderBestSummary() {
        var best = profile.bestScore === null ? 'لا توجد نتيجة سابقة' : 'أفضل نتيجة: ' + profile.bestScore + ' نقطة';
        byId('xmetalChallengeBest').textContent = best + ' · الجولات المكتملة: ' + profile.completedGames;
    }

    function showScreen(screen) {
        menu.hidden = screen !== menu;
        playScreen.hidden = screen !== playScreen;
        resultsScreen.hidden = screen !== resultsScreen;
    }

    function openGame() {
        loadProfile();
        mode = '';
        notice.textContent = '';
        showScreen(menu);
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
        byId('closeXmetalChallenge').focus();
    }

    function closeGame() {
        modal.hidden = true;
        if (!document.querySelector('.modal-backdrop:not([hidden])') &&
            !document.querySelector('.balance-verification-backdrop:not([hidden])')) {
            document.body.style.overflow = '';
        }
        pool = [];
        mode = '';
        showScreen(menu);
    }

    function startGame(selectedMode) {
        var deck = buildQuestionDeck();
        var target = selectedMode === 'quick' ? 10 : selectedMode === 'knowledge' ? 25 : 0;
        if (!deck.length || (target && deck.length < target)) {
            var availableCount = deck.length;
            notice.textContent = !availableCount
                ? 'بيانات المنتجات المتاحة غير كافية لإنشاء أسئلة. تحقق من تحميل المنتجات والأسعار.'
                : 'المتاح حالياً ' + availableCount + ' سؤالاً فقط؛ لا يمكن بدء هذه الجولة بعددها المطلوب.';
            return;
        }

        mode = selectedMode;
        previousBestScore = profile.bestScore;
        pool = target ? selectRoundQuestions(deck, target) : deck;
        initialQuestionCount = pool.length;
        questionNumber = 0;
        score = 0;
        correctCount = 0;
        wrongCount = 0;
        streak = 0;
        longestStreak = 0;
        trueStatementQuestionCount = 0;
        falseStatementQuestionCount = 0;
        lastQuestionSignature = '';
        byId('xmetalChallengeStop').hidden = selectedMode !== 'free';
        showScreen(playScreen);
        showNextQuestion();
    }

    function takeNextQuestion() {
        if (!pool.length && mode === 'free') {
            pool = buildQuestionDeck();
            if (pool.length > 1 && pool[0].signature === lastQuestionSignature) {
                var replacement = pool.findIndex(function (question) { return question.signature !== lastQuestionSignature; });
                if (replacement > 0) {
                    var first = pool[0];
                    pool[0] = pool[replacement];
                    pool[replacement] = first;
                }
            }
        }
        if (!pool.length) return null;

        var index = -1;
        var trueFalseDifference = trueStatementQuestionCount - falseStatementQuestionCount;
        var desiredTruth = trueFalseDifference > 0 ? false : trueFalseDifference < 0 ? true : null;
        if (desiredTruth !== null) {
            index = pool.findIndex(function (question) {
                return question.trueFalse !== undefined && question.trueFalse === desiredTruth;
            });
        }
        if (index < 0) index = 0;
        var question = pool.splice(index, 1)[0];
        if (question.trueFalse === true) trueStatementQuestionCount += 1;
        if (question.trueFalse === false) falseStatementQuestionCount += 1;
        lastQuestionSignature = question.signature;
        return question;
    }

    function renderImage(image, alt, onError) {
        var element = document.createElement('img');
        element.alt = alt;
        element.loading = 'lazy';
        element.src = image;
        element.addEventListener('error', onError, { once: true });
        return element;
    }

    function showNextQuestion() {
        currentQuestion = takeNextQuestion();
        if (!currentQuestion) {
            finishGame();
            return;
        }
        questionNumber += 1;
        answered = false;
        byId('xmetalChallengeScore').textContent = score + ' نقطة';
        byId('xmetalChallengeProgress').textContent = mode === 'free'
            ? 'السؤال ' + questionNumber
            : 'السؤال ' + questionNumber + ' من ' + initialQuestionCount;
        byId('xmetalChallengeProgressBar').style.width = mode === 'free'
            ? '100%'
            : Math.round((questionNumber - 1) / initialQuestionCount * 100) + '%';
        byId('xmetalChallengeFeedback').textContent = '';
        byId('xmetalChallengeNext').hidden = true;
        byId('xmetalChallengeType').textContent = questionTypeLabel(currentQuestion.type);
        byId('xmetalChallengeQuestion').textContent = questionText(currentQuestion);
        var promptImage = byId('xmetalChallengePromptImage');
        promptImage.hidden = !currentQuestion.promptImage;
        promptImage.removeAttribute('src');
        if (currentQuestion.promptImage) {
            promptImage.alt = 'صورة للمنتج المذكور في السؤال';
            promptImage.onerror = skipImageQuestion;
            promptImage.src = currentQuestion.promptImage;
        } else {
            promptImage.onerror = null;
        }
        renderOptions(currentQuestion);
    }

    function questionTypeLabel(type) {
        if (type === 'image') return 'التعرف على الصورة';
        if (type === 'customer-price') return 'سعر الزبون';
        if (type === 'mechanic-price') return 'سعر الميكانيكي';
        return 'صح أم خطأ';
    }

    function questionText(question) {
        if (question.type === 'image') return 'اختر الصورة الصحيحة للمنتج: ' + question.name;
        if (question.type === 'customer-price') return 'كم سعر بيع ' + question.name + ' وفق سعر الزبون؟';
        if (question.type === 'mechanic-price') return 'كم سعر بيع ' + question.name + ' وفق سعر الميكانيكي؟';
        return question.statement + '؟';
    }

    function renderOptions(question) {
        optionsElement.replaceChildren();
        optionsElement.classList.toggle('has-images', question.type === 'image');
        var options = question.type === 'image'
            ? question.options
            : question.type === 'customer-price' || question.type === 'mechanic-price'
                ? question.choices.map(function (choice) { return { key: choice.key, label: formatPrice(choice.value), correct: choice.correct }; })
                : [
                    { key: 'true', label: 'صح', correct: question.trueFalse },
                    { key: 'false', label: 'خطأ', correct: !question.trueFalse }
                ];
        options.forEach(function (option) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'xmetal-challenge-option' + (question.type === 'image' ? ' xmetal-challenge-option-image' : '');
            button.dataset.answerKey = String(option.key);
            if (question.type === 'image') {
                button.appendChild(renderImage(option.image, 'صورة ' + option.name, function () {
                    skipImageQuestion();
                }));
            } else {
                button.textContent = option.label;
            }
            button.addEventListener('click', function () { answerQuestion(button, option); });
            optionsElement.appendChild(button);
        });
    }

    function skipImageQuestion() {
        if (answered) return;
        answered = true;
        Array.from(optionsElement.querySelectorAll('button')).forEach(function (button) { button.disabled = true; });
        byId('xmetalChallengeFeedback').textContent = 'تعذر عرض صورة السؤال؛ تم تخطيه دون احتساب نقاط.';
        byId('xmetalChallengeNext').hidden = false;
    }

    function answerQuestion(selectedButton, selectedOption) {
        if (answered) return;
        answered = true;
        var isCorrect = currentQuestion.type === 'image'
            ? selectedOption.key === currentQuestion.answerKey
            : currentQuestion.type === 'customer-price' || currentQuestion.type === 'mechanic-price'
                ? selectedOption.correct
                : selectedOption.correct;
        Array.from(optionsElement.querySelectorAll('button')).forEach(function (button) {
            var correct = currentQuestion.type === 'image'
                ? button.dataset.answerKey === currentQuestion.answerKey
                : (currentQuestion.type === 'customer-price' || currentQuestion.type === 'mechanic-price')
                    ? currentQuestion.choices.find(function (choice) { return choice.key === button.dataset.answerKey; }).correct
                    : button.dataset.answerKey === String(currentQuestion.trueFalse);
            if (correct) button.classList.add('is-correct');
            if (button === selectedButton && !isCorrect) button.classList.add('is-wrong');
            button.disabled = true;
        });

        var pointsChange;
        var bonus = 0;
        if (isCorrect) {
            correctCount += 1;
            streak += 1;
            longestStreak = Math.max(longestStreak, streak);
            pointsChange = 10;
            if (streak === 5) bonus = 10;
            if (streak === 10) bonus = 25;
            pointsChange += bonus;
        } else {
            wrongCount += 1;
            streak = 0;
            pointsChange = -5;
        }
        score += pointsChange;
        byId('xmetalChallengeScore').textContent = score + ' نقطة';
        var feedback = isCorrect ? 'إجابة صحيحة، أحسنت! +' + (pointsChange - bonus) + ' نقطة' : 'إجابة خاطئة، الإجابة الصحيحة محددة باللون الأخضر. -5 نقاط';
        if (bonus) feedback += ' · مكافأة التتابع +' + bonus;
        byId('xmetalChallengeFeedback').textContent = feedback;
        byId('xmetalChallengeProgressBar').style.width = mode === 'free'
            ? '100%'
            : Math.round(questionNumber / initialQuestionCount * 100) + '%';
        byId('xmetalChallengeNext').textContent = mode !== 'free' && questionNumber >= initialQuestionCount
            ? 'عرض النتائج'
            : 'السؤال التالي';
        byId('xmetalChallengeNext').hidden = false;
    }

    function finishGame() {
        if (!questionNumber) {
            showScreen(menu);
            return;
        }
        profile.totalPoints += score;
        profile.completedGames += 1;
        profile.totalCorrect += correctCount;
        profile.totalWrong += wrongCount;
        profile.lastPlayedAt = new Date().toISOString();
        if (profile.bestScore === null || score > profile.bestScore) profile.bestScore = score;
        saveProfile();
        renderBestSummary();
        renderResults();
        showScreen(resultsScreen);
    }

    function renderResults() {
        var total = correctCount + wrongCount;
        var rate = total ? Math.round(correctCount / total * 100) : 0;
        var modeLabel = mode === 'quick' ? 'الجولة السريعة' : mode === 'knowledge' ? 'تحدي المعرفة' : 'اللعب الحر';
        byId('xmetalChallengeResultTitle').textContent = 'نتائج ' + modeLabel;
        var stats = [
            ['مجموع النقاط', score],
            ['الإجابات الصحيحة', correctCount],
            ['الإجابات الخاطئة', wrongCount],
            ['نسبة الإجابات الصحيحة', rate + '%'],
            ['أطول سلسلة صحيحة', longestStreak],
            ['أفضل نتيجة سابقة', previousBestScore === null ? 'لا توجد' : previousBestScore + ' نقطة']
        ];
        var container = byId('xmetalChallengeResultStats');
        container.replaceChildren();
        stats.forEach(function (entry) {
            var item = document.createElement('div');
            item.className = 'xmetal-challenge-result-stat';
            var value = document.createElement('strong');
            value.textContent = String(entry[1]);
            var label = document.createElement('span');
            label.textContent = entry[0];
            item.append(value, label);
            container.appendChild(item);
        });
        byId('xmetalChallengeResultMessage').textContent = rate >= 90
            ? 'ممتاز! معرفتك بالمنتجات وأسعارها رائعة.'
            : rate >= 70 ? 'أداء جيد! جولة أخرى ستجعلك أكثر خبرة.'
                : 'واصل التدريب، ستتعرف على المنتجات أكثر مع كل جولة.';
        byId('xmetalChallengeProgressBar').style.width = '100%';
    }

    function nextQuestion() {
        if (!answered) return;
        if (mode !== 'free' && questionNumber >= initialQuestionCount) {
            finishGame();
            return;
        }
        showNextQuestion();
    }

    document.getElementById('openXmetalChallenge').addEventListener('click', openGame);
    document.getElementById('closeXmetalChallenge').addEventListener('click', closeGame);
    modal.addEventListener('click', function (event) {
        if (event.target === modal) closeGame();
    });
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && !modal.hidden) closeGame();
    });
    Array.from(document.querySelectorAll('[data-challenge-mode]')).forEach(function (button) {
        button.addEventListener('click', function () { startGame(button.dataset.challengeMode); });
    });
    byId('xmetalChallengeNext').addEventListener('click', nextQuestion);
    byId('xmetalChallengeStop').addEventListener('click', finishGame);
    byId('xmetalChallengeReplay').addEventListener('click', function () { startGame(mode); });
    byId('xmetalChallengeReturn').addEventListener('click', closeGame);
})();
