// Input Validation System
// معالجة موحدة لـ validation جميع المدخلات

const ValidationRules = {
    // Item Validation
    itemName: {
        required: true,
        minLength: 1,
        maxLength: 255,
        pattern: /^[a-zA-Z0-9\u0600-\u06FF\s\-\.،]*$/,
        message: 'اسم المنتج يجب ألا يكون فارغاً وحد أقصى 255 حرف'
    },
    
    price: {
        required: true,
        min: 0,
        max: 1000000,
        pattern: /^\d+(\.\d{1,2})?$/,
        message: 'السعر يجب أن يكون رقماً موجباً'
    },
    
    quantity: {
        required: true,
        min: 0,
        max: 1000000,
        pattern: /^\d+(\.\d{1,2})?$/,
        message: 'الكمية يجب أن تكون رقماً موجباً ويمكن أن تحتوي على كسور حتى منزلتين'
    },
    
    email: {
        required: true,
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        message: 'البريد الإلكتروني غير صحيح'
    },
    
    phone: {
        pattern: /^[\d\+\-\s]+$/,
        minLength: 7,
        message: 'رقم الهاتف غير صحيح'
    },
    
    url: {
        pattern: /^https?:\/\/.+/,
        message: 'الرابط يجب أن يبدأ بـ http:// أو https://'
    },
    
    categoryName: {
        required: true,
        minLength: 1,
        maxLength: 100,
        message: 'اسم الفئة يجب ألا يكون فارغاً'
    },
    
    expenseAmount: {
        required: true,
        min: 0,
        max: 1000000,
        pattern: /^\d+(\.\d{1,2})?$/,
        message: 'مبلغ المصروف يجب أن يكون رقماً موجباً'
    },
    
    date: {
        pattern: /^\d{4}-\d{1,2}-\d{1,2}$/,
        message: 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD'
    }
};

function validateField(value, fieldName, customRules = null) {
    const rules = customRules || ValidationRules[fieldName];
    
    if (!rules) {
        console.warn('No validation rules for field:', fieldName);
        return { valid: true };
    }
    
    // Check required
    if (rules.required && (!value || value.toString().trim() === '')) {
        return { valid: false, message: `${fieldName} مطلوب` };
    }
    
    if (!value) return { valid: true }; // Optional field is empty
    
    // Convert to string for checks
    const strValue = value.toString().trim();
    
    // Check minLength
    if (rules.minLength && strValue.length < rules.minLength) {
        return { valid: false, message: rules.message || `الحد الأدنى للطول ${rules.minLength}` };
    }
    
    // Check maxLength
    if (rules.maxLength && strValue.length > rules.maxLength) {
        return { valid: false, message: rules.message || `الحد الأقصى للطول ${rules.maxLength}` };
    }
    
    // Check numeric min/max
    if (typeof value === 'number' || !isNaN(value)) {
        const num = parseFloat(value);
        if (rules.min !== undefined && num < rules.min) {
            return { valid: false, message: rules.message || `القيمة يجب أن تكون >= ${rules.min}` };
        }
        if (rules.max !== undefined && num > rules.max) {
            return { valid: false, message: rules.message || `القيمة يجب أن تكون <= ${rules.max}` };
        }
    }
    
    // Check pattern
    if (rules.pattern && !rules.pattern.test(strValue)) {
        return { valid: false, message: rules.message || 'الصيغة غير صحيحة' };
    }
    
    return { valid: true };
}

function validateForm(formData, fieldsToValidate) {
    const errors = {};
    let isValid = true;
    
    for (const fieldName of fieldsToValidate) {
        const result = validateField(formData[fieldName], fieldName);
        if (!result.valid) {
            errors[fieldName] = result.message;
            isValid = false;
        }
    }
    
    return { isValid, errors };
}

function sanitizeInput(value, fieldType = 'text') {
    if (!value) return '';
    
    let sanitized = value.toString().trim();
    
    // Remove dangerous characters
    if (fieldType === 'text') {
        sanitized = sanitized.replace(/[<>\"']/g, '');
    } else if (fieldType === 'email') {
        sanitized = sanitized.toLowerCase();
    } else if (fieldType === 'number') {
        sanitized = sanitized.replace(/[^\d\.\-]/g, '');
    } else if (fieldType === 'url') {
        sanitized = encodeURI(sanitized);
    }
    
    return sanitized;
}

// Export
window.ValidationRules = ValidationRules;
window.validateField = validateField;
window.validateForm = validateForm;
window.sanitizeInput = sanitizeInput;
