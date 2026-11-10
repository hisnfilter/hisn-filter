فحص صياغة ملفات Swift بلا ماك (لا يتحقق من الأنواع، فقط الصياغة):

    npm i web-tree-sitter@0.22.6 tree-sitter-wasms@0.1.12
    node check.cjs $(find .. -name "*.swift")

التحقق الكامل يكون في Xcode على الماك.
