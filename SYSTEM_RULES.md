# SYSTEM_RULES.md

## Core Rules

- النظام الفعلي يعتمد على `js/app.js` كمصدر القواعد الرئيسية.
- البيانات الأساسية تُنقل عبر Firebase collections: `items`, `sales`, `categories`, `expenses`, `activityLog`, `sliderItems`, `stats`.`totals`.
- `js/appState.js` يحتوي على نموذج حالة موحد، لكن منطق البيع والمخزون في الكود يعتمد بشكل مباشر على المتغيرات العالمية:
  - `allItems`
  - `allSales`
  - `allCategories`
  - `allExpenses`
- `appState.data` ليس المصدر الوحيد للحقيقة في التنفيذ الحالي.
- لا يوجد كيان `purchase` مستقل في الكود الحالي.
- لا يوجد `payments` collection.
- لا يوجد كيان `invoice` مستقل.

## Data Flow

### مصادر البيانات الفعلية
- `items` collection: بيانات المنتجات.
- `sales` collection: بيانات عمليات البيع.
- `categories` collection: بيانات الفئات.
- `expenses` collection: بيانات المصاريف.
- `activityLog` collection: سجلات الأنشطة.
- `stats/totals` document: يحتوي على `allTimeProfit`.

### التدفق الفعلي للبيانات
- عند إنشاء/تعديل/حذف منتج: يتم تعديل المستند في `items` ومزامنة `allItems` محلياً.
- عند بيع منتج: يتم تحديث مستند `items` لخفض الكمية، ثم إضافة مستند جديد إلى `sales`.
- عند تعديل بيع: يتم تحديث مستند `items` و `sales`، ثم تعديل `stats/totals.allTimeProfit` بالفارق.
- عند إلغاء بيع: يتم ترجيع الكمية في `items`، حذف مستند `sales`، وتعديل `stats/totals.allTimeProfit`.
- عرض سجل المبيعات يعتمد على الاستعلامات من `sales` مع فلترة حسب `salesFilterParams`.

### البيانات المحفوظة في الذاكرة
- `allItems`: مصفوفة المنتجات الفعلية المستخدمة في العرض والمنطق.
- `allSales`: مصفوفة المبيعات الفعلية المستخدمة في الإحصاءات.
- `allCategories`, `allExpenses`: تستخدم لأغراض العرض والتصفية.

## Inventory System

### المنتج (`item`) الفعلي
يستخدم الكود الحقول التالية:
- `id`
- `name`
- `purchasePrice`
- `salePrice`
- `quantity`
- `categoryId`
- `categoryName`
- `hidden`
- `limitedQuantity`
- `discountEnabled`
- `discountValue`
- `showPrice`
- `description`
- `youtubeUrl`
- `specifications`
- `images`
- `createdAt`
- `updatedAt`

### إنشاء المنتج
- عند إضافة منتج جديد: `db.collection('items').doc(newId).set(newItem)`.
- معرف المنتج يُنشأ كـ `'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)`.

### تحديث المنتج
- عند تعديل منتج موجود: `db.collection('items').doc(item.id).set(updatedItem)`.
- يتم تعديل الكمية والحقل `updatedAt`.

### حذف المنتج
- `db.collection('items').doc(itemId).delete()`.
- ثم يُزال من `allItems` محلياً.

### حساب المخزون الفعلي
- المخزون يعتمد حصرياً على `item.quantity`.
- لا توجد طبقات دفعات (`batch`) للمخزون.
- لا توجد سياسة FIFO/ LIFO في الحساب.

### تعديل المخزون في المبيعات
#### تسجيل بيع
- `item.quantity -= qty`
- `db.collection('items').doc(item.id).update({ quantity: item.quantity, updatedAt: Date.now() })`

#### تعديل بيع
- `diff = newQty - oldQty`
- إذا كان `diff > 0`، يتحقق الكود من `prod.quantity >= diff`.
- ثم `prod.quantity -= diff`.
- يحفظ `prod.quantity` المحدث في `items`.

#### إلغاء بيع
- `prod.quantity += sale.quantity`
- تحديث `items` بالقيمة الجديدة.

## Sales Flow

### مداخل السير الفعلي
- المستخدم يضغط زر `بيع` في بطاقة المنتج داخل `renderInventory()`.
- يتم فتح `sellModal` مع قيمة افتراضية `sellQuantity = 1` و `sellPrice` من `item.salePrice`.
- عند إرسال النموذج يتم تنفيذ حدث `sellForm.submit`.

### تحقق المبيعات
- `qty` يجب أن يكون > 0 و `<= item.quantity`.
- `price` يتم قراءته من الحقل `sellPrice` وقد يكون بالعملة الثانوية.
- `price` يحول إلى العملة الأساسية إذا كان `tempSellCurrency`.

### إنشاء سجل البيع
- يُبنى كائن `saleObj` بالحقول:
  - `itemId`
  - `itemName`
  - `quantity`
  - `unitPrice`
  - `totalAmount` = `price * qty`
  - `profit` = `(price - item.purchasePrice) * qty`
  - `purchasePriceAtTime` = `item.purchasePrice`
  - `timestamp` = `Date.now()`
  - `saleCurrency` = `primary` أو `secondary`
- يُضاف إلى Firestore عبر `db.collection('sales').add(saleObj)`.
- بعد الإضافة، يُحفظ `saleObj.saleId = ref.id` في الذاكرة المحلية.

### تحديث الإحصاءات بعد البيع
- `stats/totals` يتم تحديثه بزيادة `allTimeProfit` بـ `profit` باستخدام:
  - `firebase.firestore.FieldValue.increment(profit)`.
- `window._cachedStats.allTimeProfit` يُحدث محلياً بنفس القيمة.

### المتابعة بعد البيع
- يتم تحديث `allItems` لتعكس الكمية الجديدة.
- يتم إدراج `saleObj` في بداية `allSales`.
- يتم تسجيل النشاط بواسطة `logActivity('sell', 'sale', saleObj.saleId, ...)`.
- يتم إغلاق النافذة وعرض التحذير أو إعادة الرسم إذا كان القسم الحالي هو `inventory` أو `dashboard`.

### عرض سجل المبيعات
- `renderSalesLog()` يستدعي `fetchSalesPage()` ثم يعرض `salesQueryCache.currentPageItems`.
- السجل يعرض:
  - التاريخ
  - المنتج
  - الكمية
  - سعر الوحدة
  - الإجمالي
  - التكلفة المحسوبة
  - الربح
  - نسبة الربح
- التكلفة المعروضة تحسب ضمن العرض فقط: `cost = (s.purchasePriceAtTime || 0) * (s.quantity || 0)`.

## Sales Edit and Cancel

### تعديل بيع
- يفتح `editSale` النموذج مع بيانات `sale` الحالية.
- `editQuantity.max = prod.quantity + sale.quantity`.
- يُحسب الفرق:
  - `diff = newQty - oldQty`
- إذا كان `diff > 0` و `prod.quantity < diff` يتم رفض التعديل.
- يتم تعديل المخزون:
  - `prod.quantity -= diff`
- يتم إعادة حساب:
  - `newTotal = newQty * price`
  - `newProfit = (price - prod.purchasePrice) * newQty`
  - `profitDiff = newProfit - oldProfit`
- يتم كتابته إلى Firestore عبر `db.collection('sales').doc(saleId).set(upd)`.
- يتم تعديل `stats/totals.allTimeProfit` باستخدام `profitDiff`.
- يتم تحديث `allItems` و `allSales` محلياً.

### إلغاء بيع
- يتم التأكد من تأكيد المستخدم (`confirm('إلغاء البيع؟')`).
- يتم ترجيع الكمية:
  - `prod.quantity += sale.quantity`
- يتم تحديث `items`.
- يتم حذف السجل من `sales`:
  - `db.collection('sales').doc(saleId).delete()`.
- يتم تقليل `stats/totals.allTimeProfit` بـ `sale.profit`.
- يتم إزالة السجل من `allSales`.

## Pricing Logic

### أسعار المنتج
- `item.purchasePrice` و `item.salePrice` هما الحقول الأساسية.
- يُستخدم `purchasePrice` لحساب الربح.
- يُستخدم `salePrice` كافتراضي عند البيع، ولكن يمكن تجاوزه.

### الربحية الفورية
- الربح لكل بيع:
  - `profit = (unitPrice - item.purchasePrice) * quantity`
- تكلفة البيع في الواجهة:
  - `purchasePriceAtTime * quantity`
- نسبة الربح لكل بيع:
  - `profitPct = totalAmount > 0 ? ((profit || 0) / totalAmount * 100) : 0`

### تحويل العملة
- `convertToSecondary(a) = a * exchangeRate`
- `convertToPrimary(a) = a / exchangeRate`
- القيم المخزنة في Firestore تظل بالعملة الأساسية.

### عرض الربحية في المخزون
- الربحية الظاهرية لكل منتج:
  - `((item.salePrice - item.purchasePrice) / item.purchasePrice * 100).toFixed(2)`

## Invoice Lifecycle (actual)

- لا يوجد مفهوم دورة حياة فاتورة منفصلة في الكود.
- بيع واحد يمثل سجل البيع النهائي.
- `viewSaleDetail()` يعرض تفاصيل السجل كمستند فاتورة.
- لا يوجد `invoiceStatus`, `draft`, `confirmed`, `paid` أو `cancelled` بخلاف حذف السجل نفسه.

## Purchase Flow (actual)

- لا توجد أي وظائف عملية للمشتريات.
- لا توجد واجهات أو مجموعات بيانات خاصة بالموردين أو أوامر الشراء.
- الحقل `purchasePrice` هو سعر الشراء للمنتج فقط وليس سجل عملية شراء.

## Known Issues

### 1. غياب FIFO و Batch Inventory
- لا توجد تسجيلات مخزون على مستوى `batch`.
- لا توجد خوارزمية FIFO أو أي نظام يحفظ ترتيب الواردات.
- المخزون يُدار فقط بالعدد الإجمالي في `item.quantity`.

### 2. تضارب تكلفة البيع عند تعديل البيع
- عند إنشاء بيع، `purchasePriceAtTime` يُسجل.
- عند تعديل بيع، الربح يُعاد حسابه باستخدام `prod.purchasePrice` الحالي وليس `sale.purchasePriceAtTime`.
- هذا ينتج تناقضاً بين تكلفة البيع الأصلية وتكلفة البيع بعد التعديل.

### 3. غياب دفعات فعلية
- لا يوجد سجل دفعات أو حالة مدفوعات.
- أي تمثيل للفاتورة يفترض أنها مسددة بالكامل بأثر فوري.

### 4. `saleId` ليس حقلاً مخزناً دائماً
- `saleId` يُستخدم كـ doc ID في Firestore.
- الكود يضيف `saleObj.saleId = ref.id` بعد إنشاء المستند.
- عند استرجاع السجل من Firestore يتم استخدام `doc.id` لإنشاء `saleId` إذا لم يكن موجوداً في البيانات.

### 5. `appState` غير متزامن بالكامل مع المتغيرات العالمية
- هناك نسخة موحدة في `js/appState.js`.
- لكن المبيعات والمخزون يُعالجان في `js/app.js` عبر `allItems`, `allSales`.
- هذا يعني وجود مصدرين محتملين للحقيقة إذا تم تطوير المنطق دون توحيد.

## Strict Rules for AI

- اعتبر أن الكود الحالي هو نظام بيع ومخزون بسيط، وليس ERP مشتريات كامل.
- اتبع التنفيذ الفعلي في `js/app.js` فقط.
- لا تضف أي منطق دفعات أو مشتريات دون إنشاء كائنات بيانات جديدة واضحة.
- `item.quantity` هو المصدر الوحيد لصافي المخزون.
- `sales` collection هو المصدر الوحيد لسجل الفواتير/المبيعات.
- `purchasePriceAtTime` يجب أن يبقى حقلاً محفوظاً عند إنشاء البيع.
- تعديل البيع يجب أن يعيد تحديث المخزون وفقاً للفارق `diff`.
- إلغاء البيع يجب أن يعيد الكمية ويحذف السجل ويعدل `allTimeProfit`.
- أي تحسين لقواعد FIFO أو Batch يجب أن يضيف بنية بيانات جديدة، وليس تعديل `item.quantity` وحده.
- إذا رأيت `batch` في الكود، فهو يعني `Firebase batch` للتحديثات المجمعات وليس نظام دفعات مخزون.

## Summary

- النظام الفعلي لا يحتوي على Purchase Flow أو Payment Flow.
- Inventory يعتمد على حقل واحد: `item.quantity`.
- Sales تعتمد على `sales` collection و `item.quantity`.
- Pricing يعتمد على الفرق بين `unitPrice` و `item.purchasePrice`.
- لا يوجد `invoice` مستقل، فقط سجل بيع يعرض كفاتورة.
- أي AI لاحق يجب أن يعتبر هذا الكود نظام بيع بسيط قائم على Firestore.

## 🧠 AI DEVELOPMENT BOUNDARY RULES

- ممنوع إعادة تصميم النظام إلى ERP كامل (batch / fifo) إلا بطلب صريح.
- أي إضافة يجب أن تكون COMPATIBLE مع:
  - item.quantity
  - sales collection
- لا يتم استبدال النظام الحالي بل يتم البناء فوقه تدريجياً.
- أي تحسين للمخزون يجب أن يحافظ على:
  - sales logic الحالي
  - profit calculation الحالي
- لا تقم بإعادة حساب الأرباح التاريخية.
- لا تقم بتغيير معنى purchasePrice أو salePrice.

## ⚠️ SAFE EXTENSION RULES

إذا أردت إضافة:
- FIFO
- Batches
- Invoices

يجب:
- إنشاء نظام جديد منفصل (v2 layer)
- وعدم لمس النظام الحالي