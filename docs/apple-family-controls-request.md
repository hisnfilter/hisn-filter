# طلب موافقة آبل على Family Controls

أدوات وقت الشاشة (Family Controls) تعمل في نسخ التطوير على جهازك دون موافقة،
لكن نشر التطبيق في TestFlight أو متجر آبل يحتاج موافقة آبل. الانتظار قد يكون أيامًا أو أسابيع،
لذلك نقدّم الطلب مبكرًا.

## الخطوات

1. سجّل الدخول بحساب الشركة في https://developer.apple.com
2. أنشئ معرّفات التطبيق (Bundle IDs) التالية في قسم Identifiers.
   استبدل `COMPANY` باسم نطاق الشركة بالإنجليزية:

   | المعرّف | الاستخدام |
   | --- | --- |
   | `com.COMPANY.hisnfilter` | التطبيق الرئيسي |
   | `com.COMPANY.hisnfilter.ShieldConfiguration` | شكل شاشة الحجب |
   | `com.COMPANY.hisnfilter.ShieldAction` | أزرار شاشة الحجب |
   | `com.COMPANY.hisnfilter.DeviceActivityMonitor` | مراقبة الاستخدام |
   | `com.COMPANY.hisnfilter.Broadcast` | فحص الشاشة (يحجب التطبيقات المراقبة عند كشف مخالفة) |

   وأنشئ أيضًا (بلا طلب موافقة، لا تستخدم Family Controls): `com.COMPANY.hisnfilter.SafariExtension`،
   ومجموعة التطبيقات `group.com.COMPANY.hisnfilter` في قسم App Groups.

3. افتح نموذج الطلب: https://developer.apple.com/contact/request/family-controls-distribution
4. **قدّم الطلب مرة لكل معرّف من الخمسة**، لأن آبل تتطلب طلبًا منفصلًا لكل معرّف.
5. استخدم النص التالي في خانة الوصف، كما هو أو بتعديل بسيط.

## نص الطلب (بالإنجليزية)

> **App name:** Hisn Filter (فلتر حصن)
>
> **Description of use:**
> Hisn Filter is a free, open-source content-safety app for families, published by
> [COMPANY LEGAL NAME]. It helps parents and individuals protect themselves and their
> children from sexually explicit content, in line with the values of Muslim families.
>
> We use the Family Controls framework to:
> 1. Let a parent (or an adult protecting themselves) select apps and websites to restrict,
>    using FamilyActivityPicker, and apply restrictions with ManagedSettings.
> 2. Show a custom shield (ShieldConfiguration and ShieldAction extensions) explaining that
>    content was hidden, with a button to return to a safe screen.
> 3. Protect these restrictions with a user-chosen PIN, so they cannot be removed casually.
> 4. Schedule restrictions with DeviceActivity (for example, re-applying restrictions automatically
>    after a 15-minute PIN-protected allowance).
> 5. An optional, user-started on-device screen check (ReplayKit broadcast upload extension):
>    frames are analyzed on the device with Apple's SensitiveContentAnalysis and Vision, and if
>    explicit content is found, the user-selected apps are shielded with ManagedSettings.
>    Frames are never stored or transmitted.
>
> **Privacy:** All processing happens on the device. The app has no account, no server,
> no analytics, and does not collect, store or transmit any browsing data, app usage or
> personal information. Selected apps and websites remain opaque tokens on the device.
>
> **Distribution:** Free on the App Store, with no ads and no in-app purchases.
> Source code is public under the AGPL-3.0 license.

## بعد الموافقة

- تصل رسالة بريد من آبل لكل معرّف.
- في صفحة كل معرّف تظهر صلاحية **Family Controls (Distribution)**، فعّلها ثم أعد إنشاء ملفات التوقيع (Provisioning Profiles).
- ضع نفس البادئة في `apps/ios/project.yml` (`BUNDLE_PREFIX`) ثم ابنِ المشروع.
