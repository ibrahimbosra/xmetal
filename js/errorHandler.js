// Unified Error Handling System
// معالجة موحدة وقابلة للتوسع لجميع الأخطاء

const ErrorMessages = {
    // Authentication Errors
    'auth/invalid-email': 'البريد الإلكتروني غير صالح',
    'auth/user-disabled': 'تم تعطيل هذا الحساب',
    'auth/user-not-found': 'بيانات الدخول غير صحيحة',
    'auth/wrong-password': 'بيانات الدخول غير صحيحة',
    'auth/invalid-credential': 'بيانات الدخول غير صحيحة',
    'auth/weak-password': 'كلمة المرور ضعيفة جداً (الحد الأدنى 6 أحرف)',
    'auth/email-already-in-use': 'هذا البريد الإلكتروني مستخدم بالفعل',
    
    // Firestore Errors
    'permission-denied': 'لا تملك صلاحية للوصول إلى هذه البيانات',
    'failed-precondition': 'يلزم إنشاء فهرس في Firebase (راجع Firebase Console)',
    'unavailable': 'الخدمة غير متاحة مؤقتاً، حاول لاحقاً',
    'internal': 'حدث خطأ داخلي في الخادم',
    'deadline-exceeded': 'انتهت مهلة الطلب، حاول مرة أخرى',
    'invalid-argument': 'البيانات المرسلة غير صالحة',
    'not-found': 'البيانات المطلوبة غير موجودة',
    'already-exists': 'هذا البند موجود بالفعل',
    
    // Network Errors
    'network-error': 'فشل الاتصال بالخادم، تحقق من الإنترنت',
    'timeout': 'انتهت مهلة انتظار الخادم',
    
    // Validation Errors
    'validation-error': 'البيانات المدخلة غير صحيحة',
    'missing-required-fields': 'يرجى ملء جميع الحقول المطلوبة',
    
    // Business Logic Errors
    'insufficient-inventory': 'الكمية المتوفرة غير كافية',
    'invalid-quantity': 'الكمية يجب أن تكون رقماً موجباً',
    'price-mismatch': 'السعر المدخل لا يطابق السعر الأصلي',
};

const ErrorSeverity = {
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical'
};

class ErrorHandler {
    constructor() {
        this.errors = [];
        this.maxErrorsStored = 50;
    }
    
    /**
     * معالجة خطأ Firebase
     */
    handleFirebaseError(error, context = '') {
        const message = ErrorMessages[error.code] || error.message || 'حدث خطأ غير معروف';
        const severity = this.getSeverity(error.code);
        
        this.logError({
            code: error.code,
            message: message,
            context: context,
            severity: severity,
            timestamp: Date.now(),
            originalError: error
        });
        
        return { code: error.code, message: message, severity: severity };
    }
    
    /**
     * معالجة خطأ validation
     */
    handleValidationError(fieldName, message) {
        const fullMessage = message || `حقل ${fieldName} غير صحيح`;
        
        this.logError({
            code: 'validation-error',
            message: fullMessage,
            field: fieldName,
            severity: ErrorSeverity.WARNING,
            timestamp: Date.now()
        });
        
        return { valid: false, message: fullMessage };
    }
    
    /**
     * معالجة خطأ عام
     */
    handleError(error, context = '', severity = ErrorSeverity.ERROR) {
        const message = typeof error === 'string' ? error : error.message || 'حدث خطأ غير متوقع';
        
        this.logError({
            code: error.code || 'unknown-error',
            message: message,
            context: context,
            severity: severity,
            timestamp: Date.now(),
            originalError: error
        });
        
        return { message: message, severity: severity };
    }
    
    /**
     * تسجيل الخطأ
     */
    logError(errorObj) {
        this.errors.push(errorObj);
        
        // Keep only last 50 errors
        if (this.errors.length > this.maxErrorsStored) {
            this.errors = this.errors.slice(-this.maxErrorsStored);
        }
        
        // Log to console in development
        if (typeof console !== 'undefined') {
            const color = errorObj.severity === ErrorSeverity.CRITICAL ? 'color: red' : 'color: orange';
            console.log(
                `%c[${errorObj.severity.toUpperCase()}] ${errorObj.code}`,
                color,
                errorObj.message,
                errorObj.context ? `(${errorObj.context})` : ''
            );
        }
    }
    
    /**
     * تحديد شدة الخطأ
     */
    getSeverity(errorCode) {
        const criticalErrors = ['permission-denied', 'failed-precondition', 'invalid-argument'];
        if (criticalErrors.includes(errorCode)) return ErrorSeverity.ERROR;
        if (errorCode.startsWith('auth/')) return ErrorSeverity.WARNING;
        return ErrorSeverity.WARNING;
    }
    
    /**
     * الحصول على سجل الأخطاء
     */
    getErrorLog() {
        return [...this.errors];
    }
    
    /**
     * مسح سجل الأخطاء
     */
    clearErrorLog() {
        this.errors = [];
    }
    
    /**
     * تصدير الأخطاء (للتشخيص)
     */
    exportErrorLog() {
        return JSON.stringify(this.errors, null, 2);
    }
}

// Create singleton instance
const errorHandler = new ErrorHandler();

// Helper functions
function showErrorToast(message, duration = 5000) {
    const toast = document.createElement('div');
    toast.className = 'toast error';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), duration);
}

function showSuccessToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast success';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), duration);
}

// Export
window.ErrorHandler = ErrorHandler;
window.ErrorMessages = ErrorMessages;
window.ErrorSeverity = ErrorSeverity;
window.errorHandler = errorHandler;
window.showErrorToast = showErrorToast;
window.showSuccessToast = showSuccessToast;
