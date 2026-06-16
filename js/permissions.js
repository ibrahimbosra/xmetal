// Role-Based Access Control (RBAC) System
// نظام الصلاحيات والأدوار

const UserRoles = {
    ADMIN: 'admin',           // كل الصلاحيات
    MANAGER: 'manager',       // إدارة المخزون والتقارير
    CASHIER: 'cashier',       // فقط المبيعات
    VIEWER: 'viewer'          // عرض فقط
};

const Permissions = {
    // User Management
    'users.view': 'عرض المستخدمين',
    'users.create': 'إضافة مستخدمين',
    'users.edit': 'تعديل المستخدمين',
    'users.delete': 'حذف المستخدمين',
    
    // Inventory Management
    'inventory.view': 'عرض المخزون',
    'inventory.create': 'إضافة منتجات',
    'inventory.edit': 'تعديل المنتجات',
    'inventory.delete': 'حذف المنتجات',
    
    // Sales
    'sales.view': 'عرض المبيعات',
    'sales.create': 'تسجيل مبيعات',
    'sales.edit': 'تعديل المبيعات',
    'sales.delete': 'حذف المبيعات',
    'sales.cancel': 'إلغاء المبيعات',
    
    // Expenses
    'expenses.view': 'عرض المصاريف',
    'expenses.create': 'إضافة مصاريف',
    'expenses.edit': 'تعديل المصاريف',
    'expenses.delete': 'حذف المصاريف',
    
    // Analytics & Reports
    'reports.view': 'عرض التقارير',
    'reports.export': 'تصدير التقارير',
    'analytics.view': 'عرض التحليلات',
    
    // Settings
    'settings.view': 'عرض الإعدادات',
    'settings.edit': 'تعديل الإعدادات',
    'store.edit': 'تعديل معلومات المتجر',
    
    // Activity Log
    'logs.view': 'عرض سجل الأنشطة',
    'logs.export': 'تصدير السجلات',
    
    // Backup
    'backup.create': 'إنشاء نسخ احتياطية',
    'backup.restore': 'استعادة من نسخة احتياطية'
};

// Role-Permission Mapping
const RolePermissions = {
    [UserRoles.ADMIN]: [
        // الأدمن لديه كل الصلاحيات
        ...Object.keys(Permissions)
    ],
    
    [UserRoles.MANAGER]: [
        // مدير
        'inventory.view',
        'inventory.create',
        'inventory.edit',
        'sales.view',
        'sales.create',
        'sales.edit',
        'expenses.view',
        'expenses.create',
        'expenses.edit',
        'reports.view',
        'reports.export',
        'analytics.view',
        'settings.view',
        'store.edit',
        'logs.view'
    ],
    
    [UserRoles.CASHIER]: [
        // كاشير
        'inventory.view',
        'sales.view',
        'sales.create',
        'sales.edit',
        'sales.cancel',
        'reports.view'
    ],
    
    [UserRoles.VIEWER]: [
        // عارض فقط
        'inventory.view',
        'sales.view',
        'expenses.view',
        'reports.view',
        'analytics.view',
        'logs.view'
    ]
};

class PermissionManager {
    constructor() {
        this.userRole = null;
    }
    
    /**
     * تعيين دور المستخدم
     */
    setUserRole(role) {
        if (!Object.values(UserRoles).includes(role)) {
            console.warn('Invalid role:', role);
            return false;
        }
        this.userRole = role;
        return true;
    }
    
    /**
     * التحقق من وجود صلاحية معينة
     */
    hasPermission(permission) {
        if (!this.userRole) return false;
        
        const permissions = RolePermissions[this.userRole];
        return permissions && permissions.includes(permission);
    }
    
    /**
     * التحقق من وجود صلاحيات متعددة (AND)
     */
    hasAllPermissions(...permissions) {
        return permissions.every(p => this.hasPermission(p));
    }
    
    /**
     * التحقق من وجود أي صلاحية من المتعددة (OR)
     */
    hasAnyPermission(...permissions) {
        return permissions.some(p => this.hasPermission(p));
    }
    
    /**
     * الحصول على جميع صلاحيات الدور الحالي
     */
    getUserPermissions() {
        if (!this.userRole) return [];
        return RolePermissions[this.userRole] || [];
    }
    
    /**
     * الحصول على تسميات الصلاحيات
     */
    getPermissionLabel(permission) {
        return Permissions[permission] || permission;
    }
    
    /**
     * التحقق من صلاحية الوصول إلى قسم
     */
    canAccessSection(section) {
        const sectionPermissions = {
            'dashboard': ['reports.view'],
            'inventory': ['inventory.view'],
            'addItem': ['inventory.create'],
            'salesLog': ['sales.view'],
            'activityLog': ['logs.view'],
            'productAnalytics': ['reports.view'],
            'profitAnalysis': ['analytics.view'],
            'comparison': ['analytics.view'],
            'insights': ['analytics.view'],
            'expenses': ['expenses.view'],
            'categories': ['inventory.edit'],
            'storeInfo': ['store.edit'],
            'currencySettings': ['settings.edit'],
            'settings': ['settings.edit'],
            'sliderManager': ['settings.edit']
        };
        
        const requiredPerms = sectionPermissions[section];
        if (!requiredPerms) return true; // Allow if not restricted
        
        return this.hasAnyPermission(...requiredPerms);
    }
    
    /**
     * حماية العملية (يجب أن تفشل بأمان)
     */
    authorize(permission) {
        if (!this.hasPermission(permission)) {
            throw new Error(`لا تملك صلاحية: ${this.getPermissionLabel(permission)}`);
        }
        return true;
    }
}

// Create singleton instance
const permissionManager = new PermissionManager();

// Helper function to check permission and show error
function checkPermission(permission) {
    if (!permissionManager.hasPermission(permission)) {
        showErrorToast(`لا تملك صلاحية: ${permissionManager.getPermissionLabel(permission)}`);
        return false;
    }
    return true;
}

// Export
window.UserRoles = UserRoles;
window.Permissions = Permissions;
window.PermissionManager = PermissionManager;
window.permissionManager = permissionManager;
window.checkPermission = checkPermission;
