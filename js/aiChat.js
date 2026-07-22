(function(global) {
    'use strict';

    function initAiChat() {
        const container = document.getElementById('aiChatMessages');
        const form = document.getElementById('aiChatForm');
        const input = document.getElementById('aiChatInput');
        const saveButton = document.getElementById('saveGeminiKeyBtn');
        const keyInput = document.getElementById('geminiApiKeyInput');
        const status = document.getElementById('aiAssistantStatus');
        const quickPrompts = document.querySelectorAll('.ai-suggest-chip');

        if (!container || !form || !input || !saveButton || !keyInput) {
            return;
        }

        function setStatus(message, tone) {
            if (!status) return;
            status.textContent = message || '';
            status.className = 'ai-assistant-status';
            if (tone) {
                status.classList.add(`tone-${tone}`);
            }
        }

        function appendMessage(role, text) {
            const wrapper = document.createElement('div');
            wrapper.className = `ai-message ${role === 'user' ? 'ai-message-user' : 'ai-message-assistant'}`;
            wrapper.innerHTML = `<div class="ai-message-bubble">${text}</div>`;
            container.appendChild(wrapper);
            container.scrollTop = container.scrollHeight;
        }

        function setBusy(isBusy) {
            form.classList.toggle('is-busy', isBusy);
            input.disabled = isBusy;
            saveButton.disabled = isBusy;
        }

        function syncApiKeyInput() {
            keyInput.value = (global.getGeminiApiKey && global.getGeminiApiKey()) || '';
            if (!keyInput.value) {
                setStatus('أدخل مفتاح Gemini API للبدء.', 'warning');
            }
        }

        saveButton.addEventListener('click', function() {
            const key = keyInput.value.trim();
            if (!key) {
                setStatus('يرجى إدخال مفتاح API أولاً.', 'warning');
                return;
            }
            if (global.setGeminiApiKey) {
                global.setGeminiApiKey(key);
            }
            setStatus('تم حفظ المفتاح محلياً في المتصفح.', 'success');
        });

        quickPrompts.forEach(function(chip) {
            chip.addEventListener('click', function() {
                input.value = chip.dataset.prompt || '';
                input.focus();
            });
        });

        form.addEventListener('submit', async function(event) {
            event.preventDefault();
            const question = input.value.trim();
            if (!question) return;

            appendMessage('user', question);
            input.value = '';
            setBusy(true);
            setStatus('جاري تحليل البيانات من Firestore...', 'info');

            try {
                const result = await global.XMetalAIService.askAssistant(question);
                appendMessage('assistant', result.answer.replace(/\n/g, '<br>'));
                setStatus('تم تحليل البيانات بنجاح.', 'success');
            } catch (error) {
                appendMessage('assistant', `خطأ: ${error.message}`);
                setStatus(error.message, 'warning');
            } finally {
                setBusy(false);
                input.focus();
            }
        });

        if (!container.dataset.initialized) {
            appendMessage('assistant', 'أهلاً! أنا مساعد AI Assistant لهذا المتجر. اسألني عن المخزون أو المبيعات أو الأرباح أو الديون وسأحلل البيانات الحقيقية من Firestore.');
            container.dataset.initialized = 'true';
        }

        syncApiKeyInput();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAiChat);
    } else {
        initAiChat();
    }
})(window);
