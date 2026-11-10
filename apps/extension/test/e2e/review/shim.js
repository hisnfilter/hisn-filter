// واجهة إضافة وهمية: الرسائل لا ترد (لا محرك كشف في هذا الاختبار)
globalThis.chrome = { runtime: { id: "test", getURL: (p) => "/" + p, sendMessage: () => new Promise(() => {}), onMessage: { addListener() {} } }, storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } } };
