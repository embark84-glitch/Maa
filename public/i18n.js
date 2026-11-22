'use strict';
/*
 * Interface language. Arabic (right-to-left) is the default; English is available
 * from the toggle in the top bar. Strings are written in English in app.js and
 * looked up here; anything missing falls back to the English text.
 */
const I18N = (() => {
  const AR = {
    // navigation & shell
    'Catalog': 'المنتجات', 'Cart': 'السلة', 'My orders': 'طلباتي', 'Orders': 'الطلبات', 'My products': 'منتجاتي',
    'Available jobs': 'المهام المتاحة', 'My deliveries': 'توصيلاتي', 'Verification': 'التوثيق', 'All orders': 'كل الطلبات',
    'Log out': 'تسجيل الخروج', 'Loading…': 'جارٍ التحميل…', 'English': 'English',
    'Demo version: runs entirely in your browser, data stays on this device.': 'نسخة تجريبية: تعمل بالكامل داخل متصفحك، والبيانات تبقى على هذا الجهاز.',
    'Reset demo data': 'إعادة ضبط البيانات التجريبية',

    // sign in / register
    'Sign in': 'تسجيل الدخول', 'Email': 'البريد الإلكتروني', 'Password': 'كلمة المرور',
    'New pharmacy, supplier company or driver?': 'صيدلية أو شركة أو سائق جديد؟', 'Create an account': 'إنشاء حساب',
    'Demo accounts': 'حسابات تجريبية', 'Password for all demo accounts:': 'كلمة المرور لكل الحسابات التجريبية:',
    'Pharmacy': 'صيدلية', 'Supplier': 'شركة مورّدة', 'Driver': 'سائق', 'Admin': 'الإدارة',
    'I am a': 'نوع الحساب', 'Pharmacy (buyer)': 'صيدلية (مشترٍ)',
    'Pharmaceutical company / distributor (seller)': 'شركة أدوية / موزّع (بائع)', 'Delivery driver': 'سائق توصيل',
    'Your name': 'الاسم', 'Phone': 'رقم الهاتف', 'Password (min 8 characters)': 'كلمة المرور (8 أحرف على الأقل)',
    'Business name': 'اسم المنشأة', 'License number': 'رقم الترخيص', 'Address': 'العنوان', 'City': 'المدينة',
    'Vehicle': 'المركبة', 'e.g. Motorbike, Van': 'مثال: دراجة نارية، سيارة فان',
    'Licenses are checked by Maa before you can buy or sell.': 'تراجع منصة Maa التراخيص قبل السماح بالبيع أو الشراء.',
    'Back to sign in': 'العودة إلى تسجيل الدخول',

    // pending approval
    'Almost there': 'خطوة أخيرة',
    'Your driver account is waiting for approval by the Maa team.': 'حساب السائق بانتظار موافقة فريق Maa.',
    '{name} is waiting for license verification (license {license}).': '{name} بانتظار التحقق من الترخيص (رقم الترخيص {license}).',
    "We'll unlock ordering and deliveries as soon as it's approved.": 'سنفعّل الطلبات والتوصيل فور الموافقة.',
    'Check again': 'تحقّق مجدداً',

    // catalog
    'Order from suppliers': 'اطلب من المورّدين', 'Search by brand, generic name or SKU': 'ابحث بالاسم التجاري أو العلمي أو رمز المنتج',
    'All categories': 'كل الفئات', 'All suppliers': 'كل المورّدين', 'Search': 'بحث', 'No products match.': 'لا توجد منتجات مطابقة.',
    'Minimum order is {n}': 'الحد الأدنى للطلب {n}', 'Only {n} in stock': 'المتوفر {n} فقط', 'Added {qty} × {name}': 'أُضيف {qty} × {name}',
    'Cold chain': 'سلسلة تبريد', 'Sold by': 'المورّد:', '{n} in stock': 'متوفر: {n}', 'Out of stock': 'غير متوفر',
    'min {n}': 'الحد الأدنى {n}', 'Quantity': 'الكمية', 'Add to cart': 'أضف إلى السلة', '{n} in cart': 'في السلة: {n}',

    // cart
    'Your cart is empty.': 'سلتك فارغة.', 'Browse the catalog': 'تصفّح المنتجات', 'Product': 'المنتج', 'Price': 'السعر',
    'Qty': 'الكمية', 'Total': 'الإجمالي', 'Remove': 'إزالة',
    'Delivered as a separate shipment · delivery {fee}': 'تُسلَّم كشحنة مستقلة · التوصيل {fee}',
    'Products': 'المنتجات', 'Delivery ({n} shipments)': 'التوصيل (عدد الشحنات: {n})', 'Delivery (1 shipment)': 'التوصيل (شحنة واحدة)',
    'Payment': 'طريقة الدفع', 'Cash on delivery': 'الدفع عند الاستلام', 'Supplier credit / invoice': 'آجل لدى المورّد / فاتورة',
    'Notes for suppliers (optional)': 'ملاحظات للمورّدين (اختياري)', 'Place order': 'تأكيد الطلب',
    'Order placed': 'تم إرسال الطلب', '{n} orders placed, one per supplier': 'تم إرسال الطلبات (العدد: {n})، طلب لكل مورّد',

    // order lists
    'Active': 'الجارية', 'Delivered': 'المُسلَّمة', 'Closed': 'المغلقة', 'All': 'الكل', 'New': 'جديدة', 'To pack': 'قيد التجهيز',
    'Awaiting driver': 'بانتظار سائق', 'In transit': 'في الطريق', 'Done': 'المنتهية', 'Current': 'الحالية', 'Completed': 'المكتملة',
    'Incoming orders': 'الطلبات الواردة', 'Route': 'المسار', 'Items': 'الأصناف', 'Status': 'الحالة', 'Updated': 'آخر تحديث',
    'Nothing here yet.': 'لا يوجد شيء هنا بعد.',

    // statuses
    'Awaiting supplier': 'بانتظار المورّد', 'Being prepared': 'قيد التجهيز', 'Rejected': 'مرفوض', 'Cancelled': 'ملغى',
    'Ready for pickup': 'جاهز للاستلام', 'Driver assigned': 'تم تعيين سائق', 'On the way': 'في الطريق',

    // order detail
    'Accept order': 'قبول الطلب', 'Reject': 'رفض', 'Packed · ready for pickup': 'تم التجهيز · جاهز للاستلام',
    'Cancel order': 'إلغاء الطلب', 'Take this delivery': 'استلم هذه المهمة', 'Collected from supplier': 'تم الاستلام من المورّد',
    'Give up job': 'التخلي عن المهمة', '6-digit code from pharmacy': 'رمز الصيدلية (6 أرقام)', 'Confirm delivery': 'تأكيد التسليم',
    'Back': 'رجوع', 'Order #{id}': 'طلب رقم {id}', 'Your delivery code': 'رمز التسليم الخاص بك',
    'give this to the driver when the goods arrive': 'أعطه للسائق عند وصول البضاعة',
    'Pickup': 'الاستلام من', 'Deliver to': 'التسليم إلى', 'Not assigned yet': 'لم يُعيَّن بعد', 'Payment:': 'الدفع:',
    'Supplier credit': 'آجل لدى المورّد', 'Cash on delivery · collect {amount}': 'الدفع عند الاستلام · يُحصَّل {amount}',
    'Unit': 'سعر الوحدة', 'Delivery': 'التوصيل', 'Notes:': 'ملاحظات:', 'Tracking': 'تتبّع الطلب',
    'Status updated': 'تم تحديث الحالة',
    'Reason for rejecting (shown to the pharmacy)': 'سبب الرفض (يظهر للصيدلية)', 'Reason for cancelling (optional)': 'سبب الإلغاء (اختياري)',
    'Reject order': 'رفض الطلب', 'Go back': 'تراجع', 'Delivery confirmed': 'تم تأكيد التسليم',

    // timeline notes written by the server
    'Packed and waiting for a driver': 'تم التجهيز وبانتظار سائق', 'Driver released the job': 'تخلّى السائق عن المهمة',
    'Collected from supplier, on the way': 'تم الاستلام من المورّد، في الطريق', 'Handed over to pharmacy': 'تم التسليم للصيدلية',
    'Driver {name} assigned': 'تم تعيين السائق {name}',

    // supplier products
    'Edit {name}': 'تعديل {name}', 'Add a product': 'إضافة منتج', 'Brand name': 'الاسم التجاري', 'Generic name': 'الاسم العلمي',
    'Category': 'الفئة', 'e.g. Antibiotics': 'مثال: مضادات حيوية', 'Form': 'الشكل الدوائي', 'Tablet, Syrup…': 'أقراص، شراب…',
    'Strength': 'التركيز', 'Pack size': 'حجم العبوة', 'Box of 20': 'علبة 20', 'SKU': 'رمز المنتج',
    'Price per pack ({currency})': 'سعر العبوة ({currency})', 'Stock (packs)': 'المخزون (عبوات)', 'Minimum order': 'الحد الأدنى للطلب',
    'Needs cold chain': 'يحتاج سلسلة تبريد', 'Listed for sale': 'معروض للبيع', 'Save changes': 'حفظ التعديلات',
    'Add product': 'إضافة المنتج', 'Cancel': 'إلغاء', 'Stock': 'المخزون', 'Min': 'الحد الأدنى', 'Cold': 'تبريد', 'low': 'منخفض',
    'Listed': 'معروض', 'Hidden': 'مخفي', 'Edit': 'تعديل', 'No products yet. Add your first one above.': 'لا توجد منتجات بعد. أضف أول منتج من النموذج أعلاه.',
    'Product updated': 'تم تحديث المنتج', 'Product added': 'تمت إضافة المنتج',

    // driver
    'Pick up': 'الاستلام من', 'Drop off': 'التسليم إلى', '{n} products': 'عدد الأصناف: {n}', '1 product': 'صنف واحد',
    'Collect {amount}': 'يُحصَّل {amount}', 'Take job': 'استلم المهمة', 'Details': 'التفاصيل',
    'No deliveries waiting right now. This page refreshes automatically.': 'لا توجد توصيلات بانتظارك الآن. تتحدّث الصفحة تلقائياً.',
    'Job is yours. Head to the supplier.': 'المهمة لك. توجّه إلى المورّد.',

    // admin
    'In progress': 'قيد التنفيذ', 'Delivered value': 'قيمة الطلبات المُسلَّمة', 'Pharmacies & suppliers': 'الصيدليات والمورّدون',
    'Name': 'الاسم', 'Type': 'النوع', 'License': 'الترخيص', 'Verified': 'موثّق', 'Pending': 'قيد المراجعة', 'Suspend': 'إيقاف',
    'Verify': 'توثيق', 'Drivers': 'السائقون', 'Approved': 'معتمد', 'Approve': 'اعتماد', 'pharmacy': 'صيدلية', 'supplier': 'مورّد',

    'Request failed ({status})': 'تعذّر تنفيذ العملية ({status})',
  };

  // Error messages sent by the server (English) → Arabic. First match wins.
  const AR_ERRORS = [
    [/^Login required$/, 'يجب تسجيل الدخول أولاً'],
    [/^Not allowed for your role$/, 'هذا الإجراء غير متاح لنوع حسابك'],
    [/^Your account is awaiting approval$/, 'حسابك بانتظار الموافقة'],
    [/^Your organization is awaiting license verification$/, 'منشأتك بانتظار التحقق من الترخيص'],
    [/^Wrong email or password$/, 'البريد الإلكتروني أو كلمة المرور غير صحيحة'],
    [/^An account with this email already exists$/, 'يوجد حساب مسجّل بهذا البريد الإلكتروني'],
    [/^password must be at least 8 characters$/, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل'],
    [/^email is invalid$/, 'البريد الإلكتروني غير صالح'],
    [/^Minimum order for (.+) is (\d+)$/, 'الحد الأدنى لطلب $1 هو $2'],
    [/^Not enough stock for (.+) \(available: (\d+)\)$/, 'الكمية غير كافية من $1 (المتوفر: $2)'],
    [/^Product \d+ is not available$/, 'أحد المنتجات لم يعد متوفراً'],
    [/^Order cannot move to/, 'لا يمكن تنفيذ هذا الإجراء في حالة الطلب الحالية. حدّث الصفحة.'],
    [/^Order has not been picked up yet$/, 'لم يُستلَم الطلب من المورّد بعد'],
    [/^Delivery code is incorrect$/, 'رمز التسليم غير صحيح. اطلبه من الصيدلية مرة أخرى.'],
    [/^(Order|Delivery|Product|Organization|Driver) not found$|^Not found$/, 'غير موجود'],
    [/^price must be a positive amount$/, 'السعر يجب أن يكون رقماً موجباً'],
    [/^(.+) must be a whole number/, 'قيمة غير صحيحة في الحقل: $1'],
    [/^(.+) is required$/, 'حقل مطلوب: $1'],
    [/^(.+) is too long$/, 'النص طويل جداً في الحقل: $1'],
    [/^items must be a non-empty list$/, 'السلة فارغة'],
    [/^Internal (server )?error$/, 'حدث خطأ في الخادم. حاول مرة أخرى.'],
  ];

  let lang = 'ar';
  try { lang = localStorage.getItem('maa.lang') || 'ar'; } catch { /* default */ }

  const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? vars[k] : `{${k}}`));

  function t(en, vars) { return fill(lang === 'ar' ? AR[en] ?? en : en, vars); }

  function tError(msg) {
    if (lang !== 'ar') return msg;
    for (const [re, ar] of AR_ERRORS) if (re.test(msg)) return msg.replace(re, ar);
    return msg;
  }

  /** Translate a timeline note the server wrote in English; user-written notes pass through. */
  function tNote(note) {
    const m = /^Driver (.+) assigned$/.exec(note);
    return m ? t('Driver {name} assigned', { name: m[1] }) : t(note);
  }

  function apply() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  }

  function setLang(next) {
    lang = next;
    try { localStorage.setItem('maa.lang', next); } catch { /* not saved */ }
    apply();
  }

  return {
    t, tError, tNote, apply, setLang,
    get lang() { return lang; },
    get locale() { return lang === 'ar' ? 'ar-LY' : 'en-GB'; },
  };
})();
const t = I18N.t;
