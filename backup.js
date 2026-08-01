// Backup & Restore System
// نظام النسخ الاحتياطية واستعادة البيانات

class BackupManager {
    constructor() {
        this.backups = this.loadBackupsFromStorage();
        this.maxBackupsStored = 10;
        this.isExporting = false;
        this.isImporting = false;
    }
    
    /**
     * إنشاء نسخة احتياطية
     */
    async createBackup(name = null) {
        try {
            this.isExporting = true;
            
            const backupName = name || `نسخة احتياطية_${new Date().toLocaleString('ar-EG')}`;
            
            const backup = {
                id: Date.now(),
                name: backupName,
                timestamp: Date.now(),
                dataSize: 0,
                version: '1.0',
                data: {
                    sales: appState.data.sales,
                    items: appState.data.items,
                    categories: appState.data.categories,
                    expenses: appState.data.expenses,
                    sliderItems: appState.data.sliderItems,
                    storeInfo: appState.storeInfo,
                    currency: appState.currency,
                    metadata: {
                        createdAt: Date.now(),
                        user: appState.user.email || 'unknown',
                        itemsCount: appState.data.items.length,
                        salesCount: appState.data.sales.length,
                        expensesCount: appState.data.expenses.length
                    }
                }
            };
            
            // Calculate data size
            backup.dataSize = this.calculateSize(backup.data);
            
            // Store backup
            this.backups.push(backup);
            
            // Keep only last N backups
            if (this.backups.length > this.maxBackupsStored) {
                this.backups = this.backups.slice(-this.maxBackupsStored);
            }
            
            this.saveBackupsToStorage();
            
            notificationManager.success(
                `✅ تم إنشاء نسخة احتياطية: ${backupName}`,
                { duration: 3000 }
            );
            
            return backup;
        } catch (error) {
            notificationManager.error(`❌ فشل إنشاء النسخة الاحتياطية: ${error.message}`);
            throw error;
        } finally {
            this.isExporting = false;
        }
    }
    
    /**
     * استعادة من نسخة احتياطية
     */
    async restoreBackup(backupId) {
        try {
            this.isImporting = true;
            
            const backup = this.backups.find(b => b.id === backupId);
            if (!backup) {
                throw new Error('النسخة الاحتياطية غير موجودة');
            }
            
            // Confirm before restore
            if (!confirm(`هل أنت متأكد من استعادة النسخة: "${backup.name}"؟\nسيتم استبدال جميع البيانات الحالية.`)) {
                return false;
            }
            
            // Restore data
            appState.data.sales = [...backup.data.sales];
            appState.data.items = [...backup.data.items];
            appState.data.categories = [...backup.data.categories];
            appState.data.expenses = [...backup.data.expenses];
            appState.data.sliderItems = [...backup.data.sliderItems];
            appState.storeInfo = { ...backup.data.storeInfo };
            appState.currency = { ...backup.data.currency };
            
            // Update UI
            renderCurrentSection();
            
            notificationManager.success(
                `✅ تمت استعادة النسخة: ${backup.name}`,
                { duration: 3000 }
            );
            
            return true;
        } catch (error) {
            notificationManager.error(`❌ فشلت الاستعادة: ${error.message}`);
            throw error;
        } finally {
            this.isImporting = false;
        }
    }
    
    /**
     * حذف نسخة احتياطية
     */
    deleteBackup(backupId) {
        this.backups = this.backups.filter(b => b.id !== backupId);
        this.saveBackupsToStorage();
        notificationManager.success('✅ تم حذف النسخة الاحتياطية');
    }
    
    /**
     * تصدير نسخة احتياطية كملف JSON
     */
    exportBackupAsFile(backupId) {
        const backup = this.backups.find(b => b.id === backupId);
        if (!backup) {
            notificationManager.error('النسخة الاحتياطية غير موجودة');
            return;
        }
        
        const dataStr = JSON.stringify(backup, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `xmetal_backup_${backup.id}.json`;
        link.click();
        URL.revokeObjectURL(url);
        
        notificationManager.success('✅ تم تحميل النسخة الاحتياطية');
    }
    
    /**
     * استيراد نسخة احتياطية من ملف
     */
    async importBackupFromFile(file) {
        try {
            this.isImporting = true;
            
            const content = await this.readFile(file);
            const backup = JSON.parse(content);
            
            // Validate backup structure
            if (!backup.data || !backup.data.items) {
                throw new Error('صيغة الملف غير صحيحة');
            }
            
            // Add imported backup
            backup.id = Date.now();
            backup.name = `${backup.name} (مستوردة)`;
            backup.timestamp = Date.now();
            
            this.backups.push(backup);
            if (this.backups.length > this.maxBackupsStored) {
                this.backups = this.backups.slice(-this.maxBackupsStored);
            }
            
            this.saveBackupsToStorage();
            
            notificationManager.success('✅ تم استيراد النسخة الاحتياطية بنجاح');
            return backup;
        } catch (error) {
            notificationManager.error(`❌ فشل الاستيراد: ${error.message}`);
            throw error;
        } finally {
            this.isImporting = false;
        }
    }
    
    /**
     * الحصول على جميع النسخ الاحتياطية
     */
    getAll() {
        return [...this.backups];
    }
    
    /**
     * حساب حجم البيانات
     */
    calculateSize(data) {
        const str = JSON.stringify(data);
        const bytes = new Blob([str]).size;
        return (bytes / 1024).toFixed(2); // KB
    }
    
    /**
     * تحميل النسخ من التخزين المحلي
     */
    loadBackupsFromStorage() {
        try {
            const stored = localStorage.getItem('xmetal_backups');
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            console.warn('Failed to load backups from storage:', e);
            return [];
        }
    }
    
    /**
     * حفظ النسخ في التخزين المحلي
     */
    saveBackupsToStorage() {
        try {
            localStorage.setItem('xmetal_backups', JSON.stringify(this.backups));
        } catch (e) {
            console.warn('Failed to save backups to storage:', e);
        }
    }
    
    /**
     * قراءة ملف
     */
    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('فشل قراءة الملف'));
            reader.readAsText(file);
        });
    }
    
    /**
     * الحصول على إحصائيات النسخ
     */
    getStats() {
        const totalSize = this.backups.reduce((sum, b) => sum + parseFloat(b.dataSize), 0);
        return {
            count: this.backups.length,
            totalSize: totalSize.toFixed(2),
            oldest: this.backups[0]?.timestamp,
            newest: this.backups[this.backups.length - 1]?.timestamp
        };
    }
}

// Create singleton
const backupManager = new BackupManager();

// Export
window.BackupManager = BackupManager;
window.backupManager = backupManager;
