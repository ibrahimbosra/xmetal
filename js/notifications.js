// Notification System
// نظام التنبيهات والإشعارات المتقدم

const NotificationType = {
    INFO: 'info',
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error',
    ALERT: 'alert'
};

const NotificationPriority = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    CRITICAL: 4
};

class NotificationManager {
    constructor() {
        this.notifications = [];
        this.maxNotifications = 20;
        this.listeners = [];
    }
    
    /**
     * إنشاء إشعار جديد
     */
    notify(message, type = NotificationType.INFO, options = {}) {
        const notification = {
            id: Date.now() + Math.random(),
            message,
            type,
            priority: options.priority || NotificationPriority.MEDIUM,
            duration: options.duration || (type === NotificationType.ERROR ? 5000 : 3000),
            timestamp: Date.now(),
            actionLabel: options.actionLabel || null,
            actionCallback: options.actionCallback || null,
            dismissible: options.dismissible !== false,
            sound: options.sound === true,
            persistent: options.persistent === true
        };
        
        this.notifications.push(notification);
        
        // Keep only last N notifications
        if (this.notifications.length > this.maxNotifications) {
            this.notifications = this.notifications.slice(-this.maxNotifications);
        }
        
        // Notify listeners
        this.notifyListeners(notification);
        
        // Auto-dismiss if not persistent
        if (!notification.persistent && notification.duration > 0) {
            setTimeout(() => this.dismiss(notification.id), notification.duration);
        }
        
        // Play sound if enabled
        if (notification.sound) {
            this.playNotificationSound();
        }
        
        return notification.id;
    }
    
    /**
     * تنبيهات سريعة
     */
    success(message, options = {}) {
        return this.notify(message, NotificationType.SUCCESS, options);
    }
    
    error(message, options = {}) {
        return this.notify(message, NotificationType.ERROR, { ...options, duration: 5000 });
    }
    
    warning(message, options = {}) {
        return this.notify(message, NotificationType.WARNING, options);
    }
    
    info(message, options = {}) {
        return this.notify(message, NotificationType.INFO, options);
    }
    
    alert(message, options = {}) {
        return this.notify(message, NotificationType.ALERT, {
            ...options,
            priority: NotificationPriority.CRITICAL,
            persistent: true
        });
    }
    
    /**
     * إزالة إشعار
     */
    dismiss(notificationId) {
        this.notifications = this.notifications.filter(n => n.id !== notificationId);
        this.notifyListeners(null);
    }
    
    /**
     * إزالة كل الإشعارات
     */
    dismissAll() {
        this.notifications = [];
        this.notifyListeners(null);
    }
    
    /**
     * الحصول على جميع الإشعارات
     */
    getAll() {
        return [...this.notifications];
    }
    
    /**
     * الحصول على الإشعارات حسب النوع
     */
    getByType(type) {
        return this.notifications.filter(n => n.type === type);
    }
    
    /**
     * مراقب الإشعارات
     */
    subscribe(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }
    
    /**
     * إخطار المستمعين
     */
    notifyListeners(notification) {
        this.listeners.forEach(listener => {
            try {
                listener(notification, this.notifications);
            } catch (e) {
                console.warn('Notification listener error:', e);
            }
        });
    }
    
    /**
     * تشغيل صوت التنبيه
     */
    playNotificationSound() {
        // استخدام Web Audio API أو alert sound
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800;
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (e) {
            // Fallback: do nothing
        }
    }
}

// Create singleton
const notificationManager = new NotificationManager();

// Business Logic Notifications
class BusinessNotifications {
    static lowStockAlert(productName, currentQty, threshold = 10) {
        return notificationManager.alert(
            `تنبيه: المنتج "${productName}" انخفضت كميته إلى ${currentQty} وحدة`,
            {
                priority: NotificationPriority.HIGH,
                actionLabel: 'إضافة مخزون',
                actionCallback: () => {
                    // Trigger add stock modal
                }
            }
        );
    }
    
    static salesTargetReached(percentage) {
        return notificationManager.success(
            `🎉 لقد وصلت إلى ${percentage}% من هدف المبيعات اليومي!`,
            { duration: 4000 }
        );
    }
    
    static salesTargetWarning(percentage) {
        return notificationManager.warning(
            `⏰ تبقى على وصول الهدف: ${100 - percentage}%`,
            { duration: 5000, persistent: false }
        );
    }
    
    static operationSuccess(operation) {
        return notificationManager.success(
            `✅ تمت ${operation} بنجاح`,
            { duration: 2000 }
        );
    }
    
    static operationFailed(operation, reason) {
        return notificationManager.error(
            `❌ فشلت ${operation}: ${reason}`,
            { duration: 5000 }
        );
    }
    
    static networkError() {
        return notificationManager.error(
            '🌐 فقدان الاتصال بالإنترنت',
            { persistent: true, duration: 0 }
        );
    }
    
    static networkRestored() {
        return notificationManager.success(
            '🌐 تم استعادة الاتصال',
            { duration: 2000 }
        );
    }
}

// Export
window.NotificationType = NotificationType;
window.NotificationPriority = NotificationPriority;
window.NotificationManager = NotificationManager;
window.notificationManager = notificationManager;
window.BusinessNotifications = BusinessNotifications;
