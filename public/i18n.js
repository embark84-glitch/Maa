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

    // demo guide
    'Try it in 6 steps': 'جرّب التطبيق في 6 خطوات', 'Show steps': 'إظهار الخطوات', 'Hide steps': 'إخفاء الخطوات',
    'Pharmacy: add products to the cart and place the order': 'الصيدلية: أضف منتجات إلى السلة ثم اضغط «تأكيد الطلب»',
    'Supplier: accept the order': 'الشركة: اضغط «قبول الطلب»',
    'Supplier: mark it packed and ready for pickup': 'الشركة: اضغط «تم التجهيز · جاهز للاستلام»',
    'Driver: take the delivery job': 'السائق: اضغط «استلم هذه المهمة»',
    'Driver: confirm collection from the supplier': 'السائق: اضغط «تم الاستلام من المورّد»',
    'Driver: enter the delivery code {code} from the pharmacy': 'السائق: أدخل رمز التسليم {code} الذي تعطيه الصيدلية، ثم اضغط «تأكيد التسليم»',
    'Go to this step': 'انتقل لهذه الخطوة', 'Switch role:': 'بدّل الدور:',
    'Done! The order was delivered. Try another order, or open the admin page.': 'اكتملت التجربة! تم تسليم الطلب. جرّب طلباً جديداً أو افتح صفحة الإدارة.',
    'Start a new order': 'ابدأ طلباً جديداً', 'Al Wadi (supplier)': 'شركة الوادي', 'Sahara (supplier)': 'شركة الصحراء',

    // ordering flow (v3)
    'New order': 'طلب جديد', 'Products': 'المنتجات', 'Update products': 'تحديث المنتجات', 'Payment & API': 'الدفع والربط',
    'Full payment upfront': 'دفع كامل القيمة مقدماً', 'Deposit {pct}%, rest on delivery': 'دفعة مقدمة {pct}% والباقي عند الاستلام',
    'Credit, {days} days': 'آجل (دين) لمدة {days} يوماً', 'Paid in full': 'مدفوع بالكامل', 'Credit due {date}': 'آجل، يستحق في {date}',
    'On credit': 'آجل', 'Upfront payment received': 'تم استلام المقدّم', 'Awaiting payment': 'بانتظار الدفع',
    'The minimum order with this company is {amount}': 'الحد الأدنى للطلب من هذه الشركة {amount}',
    'This order is above your remaining credit with this company ({amount})': 'قيمة الطلب أكبر من رصيدك الآجل المتبقي لدى هذه الشركة ({amount})',
    'Record the upfront payment first: {paid} of {required} received': 'سجّل الدفعة المقدمة أولاً: استُلم {paid} من {required}',
    'That is more than the amount still owed ({amount})': 'المبلغ أكبر من المتبقي على الطلب ({amount})',
    'No connection. Check the internet and try again.': 'لا يوجد اتصال. تحقّق من الإنترنت وحاول مجدداً.',
    'Full payment': 'دفع كامل', 'Deposit {pct}%': 'مقدّم {pct}%', 'Credit {days} days': 'آجل {days} يوماً',
    'Choose the company': 'اختر الشركة', 'Choose products': 'اختر الأصناف', 'Payment and confirm': 'الدفع والتأكيد',
    'Which company do you want to order from?': 'من أي شركة تريد الطلب؟', 'Search companies': 'ابحث عن شركة',
    'Draft: {n} items': 'مسودة: {n} أصناف', 'Prices updated {date}': 'الأسعار محدّثة في {date}', 'Minimum order {amount}': 'الحد الأدنى للطلب {amount}',
    'No minimum order': 'لا يوجد حد أدنى للطلب', 'Your available credit: {amount}': 'رصيدك الآجل المتاح: {amount}', 'Open products': 'عرض المنتجات',
    'No companies are available yet.': 'لا توجد شركات متاحة بعد.', 'Change company': 'تغيير الشركة',
    'This company has no products listed yet.': 'لا توجد منتجات معروضة لدى هذه الشركة بعد.',
    'Add': 'إضافة', 'Less': 'إنقاص', 'More': 'زيادة', '{n} items': 'الأصناف: {n}', 'Fix the highlighted quantities': 'صحّح الكميات المظللة',
    'Add {amount} more to reach the minimum order': 'أضف {amount} للوصول إلى الحد الأدنى للطلب',
    'Delivery fee {amount} is added at checkout': 'تُضاف رسوم التوصيل {amount} عند الدفع', 'Continue to payment': 'متابعة إلى الدفع',
    'Enter a whole number': 'أدخل رقماً صحيحاً', 'Pay the full amount now': 'دفع كامل القيمة الآن', 'Pay now: {amount}': 'تدفع الآن: {amount}',
    'Deposit {pct}% now, the rest on delivery': 'دفعة مقدمة {pct}% الآن، والباقي عند الاستلام', 'Now: {now} · On delivery: {later}': 'الآن: {now} · عند الاستلام: {later}',
    'Credit: pay within {days} days of delivery': 'آجل (دين): الدفع خلال {days} يوماً من الاستلام',
    'Nothing to pay now · Your available credit: {amount}': 'لا تدفع شيئاً الآن · رصيدك الآجل المتاح: {amount}',
    'Not available: this order is above your available credit ({amount})': 'غير متاح: قيمة الطلب أكبر من رصيدك الآجل المتاح ({amount})',
    'Review and pay': 'المراجعة والدفع', 'Edit items': 'تعديل الأصناف', 'How will you pay?': 'كيف ستدفع؟',
    'These are the payment options {company} offers.': 'هذه طرق الدفع التي تقدّمها {company}.', 'Notes for the company (optional)': 'ملاحظات للشركة (اختياري)',
    'Send order to the company': 'إرسال الطلب إلى الشركة',
    'The company reviews the order and confirms your payment. Then it is packed and sent with a driver, and you can follow it under My orders.': 'تراجع الشركة الطلب وتؤكد استلام دفعتك، ثم يُجهَّز ويُرسل مع سائق، ويمكنك متابعته من «طلباتي».',
    'Transfer {amount} to the company': 'حوّل {amount} إلى الشركة', 'The company will send you its bank details.': 'سترسل لك الشركة بيانات حسابها المصرفي.',
    'Transfer receipt number (optional, you can add it later)': 'رقم إيصال التحويل (اختياري، يمكنك إضافته لاحقاً)',
    'Your order was sent to the company': 'تم إرسال طلبك إلى الشركة',
    'Payment terms': 'طريقة الدفع', 'Payment details': 'الدفع', 'Order total': 'قيمة الطلب', 'Due before dispatch': 'المطلوب قبل الشحن', 'Received by the company': 'المستلم من الشركة',
    'Remaining': 'المتبقي', 'Paid to the driver on delivery': 'يُدفع للسائق عند الاستلام', 'Credit due date': 'تاريخ استحقاق الدين',
    'Transfer receipt no.': 'رقم إيصال التحويل', 'Transfer {amount} so the company can send your order': 'حوّل {amount} لتتمكن الشركة من إرسال طلبك',
    'Transfer receipt number': 'رقم إيصال التحويل', 'Add receipt number': 'إضافة رقم الإيصال', 'Update receipt number': 'تحديث رقم الإيصال',
    'Record a payment you received': 'تسجيل دفعة مستلمة', '{amount} must be received before you can dispatch this order.': 'يجب استلام {amount} قبل شحن هذا الطلب.',
    'Amount ({currency})': 'المبلغ ({currency})', 'Method': 'الطريقة', 'Reference (optional)': 'المرجع (اختياري)', 'Record payment': 'تسجيل الدفعة',
    'Payments received': 'الدفعات المستلمة', 'Accept order and payment terms': 'قبول الطلب وطريقة الدفع',
    'Record the upfront payment below first': 'سجّل الدفعة المقدمة في الأسفل أولاً', 'Collect {amount} in cash from the pharmacy': 'حصّل {amount} نقداً من الصيدلية',
    'Enter the amount received': 'أدخل المبلغ المستلم', 'Payment recorded': 'تم تسجيل الدفعة', 'Receipt number sent to the company': 'تم إرسال رقم الإيصال إلى الشركة',
    'Awaiting company approval': 'بانتظار موافقة الشركة', 'Accepted by the company': 'وافقت الشركة', 'Payment received': 'تم استلام دفعة',
    'Transfer receipt added': 'أُضيف رقم إيصال التحويل', 'Bank transfer': 'تحويل مصرفي', 'Cash': 'نقداً', 'Cheque': 'صك', 'Card': 'بطاقة', 'Other': 'أخرى',
    'Sent': 'أُرسل', 'Accepted': 'قُبل', 'Packed': 'جُهّز',
    'The company is reviewing your order.': 'الشركة تراجع طلبك.', 'Waiting for the company to confirm your payment.': 'بانتظار تأكيد الشركة لاستلام دفعتك.',
    'The company is packing your order.': 'الشركة تجهّز طلبك.', 'Waiting for a driver to collect it.': 'بانتظار سائق لاستلامه.',
    'Check the items and payment terms, then accept or reject.': 'راجع الأصناف وطريقة الدفع، ثم اقبل الطلب أو ارفضه.',

    // supplier products & import
    'Last updated {date}': 'آخر تحديث {date}', 'Update from Excel': 'تحديث من ملف Excel', 'Add one product': 'إضافة منتج واحد',
    'Product code (SKU)': 'رمز المنتج (SKU)', 'No products yet.': 'لا توجد منتجات بعد.', 'Upload your product list from Excel': 'ارفع قائمة منتجاتك من ملف Excel',
    'Upload your price and stock list whenever it changes. Products are matched by product code: existing codes are updated, new codes are added. You see every change before anything is saved.': 'ارفع قائمة الأسعار والكميات كلما تغيّرت. تُطابَق المنتجات برمز المنتج: الرموز الموجودة تُحدَّث، والرموز الجديدة تُضاف. وترى كل تغيير قبل حفظ أي شيء.',
    'Prepare the file': 'جهّز الملف', 'An Excel (.xlsx) or CSV file with one product per row. The first row holds the column names, in Arabic or English:': 'ملف Excel ‏(.xlsx) أو CSV، كل منتج في صف. الصف الأول لأسماء الأعمدة، بالعربية أو الإنجليزية:',
    'Column': 'العمود', 'Required': 'إلزامي', 'Example': 'مثال', 'Yes': 'نعم', 'No': 'لا',
    'Download empty template': 'تنزيل قالب فارغ', 'Download my current list': 'تنزيل قائمتي الحالية', 'Upload it': 'ارفع الملف',
    'Choose a file': 'اختر ملفاً', 'or drag it here · .xlsx, .xls or .csv': 'أو اسحبه إلى هنا · ‎.xlsx أو ‎.xls أو ‎.csv',
    'No file to hand? Try a sample file': 'لا يوجد ملف لديك؟ جرّب ملفاً تجريبياً', 'Choose a file to see what will change.': 'اختر ملفاً لترى ما الذي سيتغيّر.',
    'Connect your system (API)': 'اربط نظامك (API)',
    'If your company uses a stock or accounting system, it can send the product list automatically. Create a key under Payment & API.': 'إذا كانت شركتك تستخدم نظام مخزون أو محاسبة، يمكنه إرسال قائمة المنتجات تلقائياً. أنشئ مفتاحاً من صفحة «الدفع والربط».',
    'Set up API access': 'إعداد الربط عبر API', 'Recent updates': 'آخر التحديثات', 'Date': 'التاريخ', 'Source': 'المصدر', 'By': 'بواسطة',
    'Checking the file…': 'جارٍ فحص الملف…', 'Check and confirm': 'راجع وأكّد', 'Changed': 'تتغيّر', 'No change': 'بدون تغيير', 'Will be hidden': 'ستُخفى', 'Errors': 'أخطاء',
    'Rows with errors': 'صفوف فيها أخطاء', 'Row': 'الصف', 'Problem': 'المشكلة', 'Changes to existing products': 'تغييرات على منتجات موجودة', 'Change': 'التغيير',
    'New products': 'منتجات جديدة', 'Products that will be hidden': 'منتجات ستُخفى',
    'Hide my products that are not in this file (they stop being sold, nothing is deleted)': 'إخفاء منتجاتي غير الموجودة في هذا الملف (يتوقف بيعها، ولا يُحذف شيء)',
    'Skip the rows with errors and save the rest': 'تجاهل الصفوف التي فيها أخطاء وحفظ الباقي', 'Save these changes': 'حفظ هذه التغييرات',
    'Your products already match this file. Nothing to save.': 'منتجاتك مطابقة لهذا الملف. لا يوجد ما يُحفظ.',
    'Saved: {created} new, {updated} updated, {hidden} hidden': 'تم الحفظ: {created} جديد، {updated} محدَّث، {hidden} مخفي',
    'The Excel reader did not load. Check the internet connection and reload the page.': 'لم يُحمَّل قارئ ملفات Excel. تحقّق من الاتصال بالإنترنت وأعد تحميل الصفحة.',
    'This file could not be read. Save it as .xlsx or .csv and try again.': 'تعذّرت قراءة الملف. احفظه بصيغة ‎.xlsx أو ‎.csv وحاول مجدداً.',
    'sample-file.xlsx': 'ملف-تجريبي.xlsx',
    'This file cannot be used. Check the column names and upload it again.': 'لا يمكن استخدام هذا الملف. تحقّق من أسماء الأعمدة وارفعه مجدداً.',
    'Fix the rows with errors in your file and upload it again, or choose to skip them.': 'صحّح الصفوف التي فيها أخطاء في ملفك وارفعه مجدداً، أو اختر تجاهلها.',
    'Required columns are missing: {value}': 'أعمدة إلزامية غير موجودة: {value}', 'Product code is empty': 'رمز المنتج فارغ',
    'Product code {value} appears more than once': 'رمز المنتج {value} مكرر في الملف', 'Brand name is empty': 'الاسم التجاري فارغ',
    'Price is not a valid amount: {value}': 'السعر غير صالح: {value}', 'Quantity must be a whole number, 0 or more': 'الكمية يجب أن تكون رقماً صحيحاً (0 أو أكثر)',
    'Minimum order must be a whole number, 1 or more': 'الحد الأدنى يجب أن يكون رقماً صحيحاً (1 أو أكثر)', 'Must be yes or no': 'القيمة يجب أن تكون «نعم» أو «لا»',
    'The file has no product rows': 'الملف لا يحتوي على منتجات', 'At most {value} rows per file': 'الحد الأقصى {value} صف في الملف الواحد',
    'The data is not in the expected format': 'صيغة البيانات غير صحيحة',

    // supplier settings
    'How pharmacies can pay you': 'كيف يمكن للصيدليات الدفع لك', 'Pharmacies see only the options you allow here when they place an order.': 'تظهر للصيدليات عند الطلب الطرقُ التي تسمح بها هنا فقط.',
    'The pharmacy pays everything before you dispatch.': 'تدفع الصيدلية كامل القيمة قبل الشحن.', 'Deposit, rest on delivery': 'دفعة مقدمة والباقي عند الاستلام',
    'Deposit': 'المقدّم', 'Credit (pay later)': 'آجل (دين)', 'Pay within': 'الدفع خلال', 'days': 'يوماً', 'Credit limit per pharmacy': 'سقف الدين لكل صيدلية',
    'Minimum order value ({currency})': 'الحد الأدنى لقيمة الطلب ({currency})', 'Bank details shown to pharmacies for transfers': 'بيانات الحساب المصرفي التي تظهر للصيدليات للتحويل',
    'Save payment settings': 'حفظ إعدادات الدفع', 'API access': 'الربط عبر API',
    'Your stock or accounting system can send the full product list automatically, for example every night. Each call works exactly like an Excel upload.': 'يمكن لنظام المخزون أو المحاسبة لديك إرسال قائمة المنتجات كاملة تلقائياً، مثلاً كل ليلة. كل إرسال يعمل تماماً مثل رفع ملف Excel.',
    'Copy this key now. It will not be shown again.': 'انسخ هذا المفتاح الآن. لن يظهر مرة أخرى.', 'Copy': 'نسخ', 'Name, e.g. our ERP': 'اسم، مثل: نظام المخزون',
    'Create API key': 'إنشاء مفتاح API', 'Key': 'المفتاح', 'Created': 'أُنشئ', 'Last used': 'آخر استخدام', 'Never': 'لم يُستخدم', 'Revoke': 'إلغاء',
    'How to call the API': 'طريقة الاستخدام',
    'Use dry_run: true to see the changes without saving. The answer lists new, updated and hidden products and any row errors. Column names can be the same Arabic or English names as in Excel.': 'استخدم dry_run: true لمعاينة التغييرات دون حفظ. يعرض الرد المنتجات الجديدة والمحدَّثة والمخفية وأي أخطاء. يمكن استخدام أسماء الأعمدة نفسها المستخدمة في Excel، بالعربية أو الإنجليزية.',
    'In this demo the API cannot be reached from outside your browser.': 'في النسخة التجريبية لا يمكن الوصول إلى الـ API من خارج متصفحك.',
    'Payment settings saved': 'تم حفظ إعدادات الدفع', 'Copied': 'تم النسخ', 'Selected. Copy it with your keyboard or long-press.': 'تم التحديد. انسخه من لوحة المفاتيح أو بالضغط المطوّل.',
    'Key revoked': 'تم إلغاء المفتاح',

    // demo guide (v3)
    'Try it step by step': 'جرّب التطبيق خطوة بخطوة', 'not needed for credit': 'لا تلزم في الدفع الآجل', 'Also try:': 'جرّب أيضاً:',
    'Company: update products from Excel': 'الشركة: تحديث المنتجات من Excel', 'Company: payment options': 'الشركة: طرق الدفع',
    'Pharmacy: New order → choose a company → add products → choose how to pay → send': 'الصيدلية: «طلب جديد» ← اختر الشركة ← أضف الأصناف ← اختر طريقة الدفع ← أرسل الطلب',
    'Company: check the order and accept it': 'الشركة: راجع الطلب واضغط «قبول الطلب وطريقة الدفع»',
    'Company: record the upfront payment received': 'الشركة: سجّل الدفعة المقدمة المستلمة',
    'Company: mark the order packed and ready': 'الشركة: اضغط «تم التجهيز · جاهز للاستلام»',
    'Driver: confirm collection from the company': 'السائق: اضغط «تم الاستلام من المورّد»',

    // photos, order by photo, barcodes (v4)
    'Pharmacy: order by photo or barcode': 'الصيدلية: الطلب بالتصوير أو الباركود',
    'Order by photo': 'اطلب بالتصوير', 'Scan barcode': 'مسح الباركود', 'Search by name, or scan a barcode': 'ابحث بالاسم، أو امسح الباركود',
    'Added {name} · quantity {n}': 'أُضيف {name} · الكمية {n}', 'No product with barcode {code}': 'لا يوجد منتج بالباركود {code}',
    '{name} is not sold by this company. Available from: {companies}': '{name} غير متوفر لدى هذه الشركة. متوفر لدى: {companies}',
    'Your photo': 'صورتك', 'Reading the photo… this can take up to a minute.': 'جارٍ قراءة الصورة… قد يستغرق ذلك حتى دقيقة.',
    'Order by photo is not set up yet. Ask the Maa team to turn it on.': 'الطلب بالتصوير غير مفعّل بعد. اطلب من فريق Maa تفعيله.',
    'Photo reading needs your permission to use Claude. Allow it and try again.': 'قراءة الصور تحتاج إذنك باستخدام Claude. اسمح بذلك ثم حاول مجدداً.',
    'Close': 'إغلاق', 'Done': 'تم',
    'Found {n} products from {company}. Check the quantities, then add them.': 'وجدنا {n} من أصناف {company}. راجع الكميات ثم أضفها.',
    'Check this: read as “{seen}”': 'تحقّق منه: قُرئ «{seen}»',
    'No products from {company} were recognised in this photo.': 'لم نتعرّف في هذه الصورة على أصناف من {company}.',
    'Not sold by this company:': 'غير متوفرة لدى هذه الشركة:', 'Add selected to the order': 'أضف المحدد إلى الطلب',
    'Added {n} products to the order': 'أُضيفت {n} أصناف إلى الطلب',
    'Starting the camera…': 'جارٍ تشغيل الكاميرا…', 'Photograph the barcode': 'صوّر الباركود', 'Reading the barcode…': 'جارٍ قراءة الباركود…',
    'Barcode read: {code}': 'تمت قراءة الباركود: {code}',
    'No barcode found. Hold the phone closer, in good light, and try again.': 'لم يُعثر على باركود. قرّب الهاتف في إضاءة جيدة وحاول مجدداً.',
    'The barcode reader did not load. Check the internet connection.': 'لم يُحمَّل قارئ الباركود. تحقّق من الاتصال بالإنترنت.',
    'Point the camera at the barcode on the pack.': 'وجّه الكاميرا نحو الباركود على العلبة.',
    'The camera is not available here. Photograph the barcode instead, or use a handheld scanner in the search box.': 'الكاميرا غير متاحة هنا. صوّر الباركود بدلاً من ذلك، أو استخدم قارئ باركود يدوي في خانة البحث.',
    'Barcode': 'الباركود', 'Change photo': 'تغيير الصورة', 'Add photo': 'إضافة صورة', 'Remove photo': 'حذف الصورة',
    'You can add a photo after saving the product.': 'يمكنك إضافة صورة بعد حفظ المنتج.', 'Photo saved': 'تم حفظ الصورة', 'Photo removed': 'تم حذف الصورة',
    'Photo link': 'رابط الصورة', 'Barcode must be 8 to 14 digits: {value}': 'الباركود يجب أن يكون من 8 إلى 14 رقماً: {value}',
    'Barcode {value} appears more than once': 'الباركود {value} مكرر في الملف', 'Photo link must start with https://': 'رابط الصورة يجب أن يبدأ بـ https://',
    'New photo': 'صورة جديدة', 'No photo': 'بلا صورة',

    // shared pilot
    'Welcome to Maa': 'مرحباً بك في Maa',
    'Create your account once. It is linked to the Claude account you are signed in with, so there is no password to remember.': 'أنشئ حسابك مرة واحدة. يرتبط بحساب Claude الذي سجّلت الدخول به، فلا تحتاج كلمة مرور.',
    'The owner has not set up the shared data yet. Ask them to open this link once, then reload this page.': 'لم يجهّز صاحب الرابط البيانات المشتركة بعد. اطلب منه فتح الرابط مرة واحدة، ثم أعد تحميل هذه الصفحة.',
    'You cannot reach the shared data. Make sure you are signed in to Claude and that the owner added you to this link as an Editor.': 'لا يمكنك الوصول إلى البيانات المشتركة. تأكد أنك مسجّل الدخول إلى Claude وأن صاحب الرابط أضافك إليه بصلاحية «محرر» (Editor).',
    'The shared data could not be loaded. Check the internet connection and reload the page.': 'تعذّر تحميل البيانات المشتركة. تحقّق من الاتصال بالإنترنت وأعد تحميل الصفحة.',
    'Try again': 'حاول مجدداً', 'Maa': 'Maa',
    'In this version the API cannot be reached from outside the browser.': 'في هذه النسخة لا يمكن الوصول إلى الـ API من خارج المتصفح.',

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
    [/^This company is not available$/, 'هذه الشركة غير متاحة حالياً'],
    [/^This company does not offer that payment option$/, 'هذه الشركة لا تقدّم طريقة الدفع هذه'],
    [/^Choose at least one way pharmacies can pay$/, 'اختر طريقة دفع واحدة على الأقل'],
    [/^Another product already uses this product code$/, 'يوجد منتج آخر بنفس رمز المنتج'],
    [/^The file has errors/, 'في الملف أخطاء. صحّحها أو اختر تجاهل الصفوف التي فيها أخطاء.'],
    [/^This order is closed$/, 'هذا الطلب مغلق'],
    [/^amount must be more than zero$/, 'المبلغ يجب أن يكون أكبر من صفر'],
    [/^Upload is too large$/, 'الملف كبير جداً'],
    [/^The order changed/, 'تغيّر الطلب. حدّث الصفحة وحاول مجدداً.'],
    [/^Missing or invalid API key$/, 'مفتاح API غير صحيح'],
    [/^payment_terms must be/, 'اختر طريقة الدفع'],
    [/^(Supplier|Key) not found$/, 'غير موجود'],
    [/^Upload a JPEG, PNG or WebP photo$/, 'ارفع صورة بصيغة JPEG أو PNG أو WebP'],
    [/^Photo ordering is not set up on this server$/, 'الطلب بالتصوير غير مفعّل بعد'],
    [/^Photo reading is busy/, 'قراءة الصور مشغولة الآن. حاول بعد دقيقة.'],
    [/^This photo could not be read/, 'تعذّرت قراءة هذه الصورة. جرّب صورة أوضح.'],
    [/^Photo reading failed/, 'فشلت قراءة الصورة. حاول مجدداً.'],
    [/^Photo reading needs permission/, 'قراءة الصور تحتاج إذنك باستخدام Claude.'],
    [/^Barcode must be 8 to 14 digits$/, 'الباركود يجب أن يكون من 8 إلى 14 رقماً'],
    [/^Image not found$/, 'غير موجود'],
    [/^You already have an account/, 'لديك حساب بالفعل. أعد تحميل الصفحة.'],
    [/^You are signed in with your Claude account$/, 'أنت مسجّل الدخول بحساب Claude الخاص بك'],
    [/^Someone else is saving right now/, 'شخص آخر يحفظ تغييراً الآن. حاول بعد لحظة.'],
    [/^Saving failed/, 'فشل الحفظ. تحقّق من الاتصال وحاول مجدداً.'],
    [/^Could not load the shared data/, 'تعذّر تحميل البيانات المشتركة. تحقّق من الاتصال وأعد تحميل الصفحة.'],
    [/^The shared data is not available$/, 'البيانات المشتركة غير متاحة'],
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
