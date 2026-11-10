#!/usr/bin/env python3
"""نسخة المتجر قبل موافقة أبل على صلاحية Family Controls: تُشتق project-store.yml من project.yml —
بلا امتدادات الحجب (ShieldConfiguration/ShieldAction/Monitor) وفحص الشاشة (Broadcast)، وبلا صلاحية family-controls،
ومع شرط HISN_NO_FC الذي يُخفي واجهاتها، وHISN_NO_CLEANUP (أداة تنظيف الحساب ليست في النسخة الأولى) ويُظهر شرح «قيود المحتوى» المجاني في الآيفون.
التشغيل: cd apps/ios && python3 tools/make-store-spec.py && xcodegen --spec project-store.yml
بعد الموافقة: نبني من project.yml كالمعتاد (لا حاجة لهذا الملف)."""
import re
s = open('project.yml').read()
s = s.replace('name: HisnFilter\n', 'name: HisnFilterStore\n', 1)
for t in ['HisnShieldConfiguration', 'HisnShieldAction', 'HisnMonitor', 'HisnBroadcast']:
    s = s.replace(f'      - target: {t}\n', '')
    s = re.sub(rf'\n(  # [^\n]*\n)?  {t}:\n(    [^\n]*\n|\n)*?(?=\n?  #|\n  [A-Za-z])', '\n', s)
s = s.replace('CODE_SIGN_ENTITLEMENTS: HisnFilter/HisnFilter.entitlements',
              'CODE_SIGN_ENTITLEMENTS: HisnFilter/HisnFilter-store.entitlements\n        SWIFT_ACTIVE_COMPILATION_CONDITIONS: "$(inherited) HISN_NO_FC HISN_NO_CLEANUP"')
open('project-store.yml', 'w').write('# مُولَّد من project.yml بـ tools/make-store-spec.py — لا تعدّله يدويًا\n' + s)
e = open('HisnFilter/HisnFilter.entitlements').read().replace('\t<key>com.apple.developer.family-controls</key><true/>\n', '')
open('HisnFilter/HisnFilter-store.entitlements', 'w').write(e)
print('project-store.yml ✓')
