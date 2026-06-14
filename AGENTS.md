# AGENTS.md — Agent Evidence Recorder (MVP)

> Bu projede **Claude Code lider geliştiricidir**. Tüm akışı Claude Code başlatır ve yürütür.
> **Codex** güvenlik/test, **Gemini** mimari/UI ikinci görüş için devreye girer.
> Tek kural her şeyin üstünde: **Kapsamı küçük tut. Çalışan demo çıkar.**

---

## 0. Bağlam
**Agent Evidence Recorder** = AI agent run'larını denetlenebilir kanıt paketine dönüştüren sistem.
Observability aracı değil; **audit-ready evidence layer**. İlk demo: *Customer Data Deletion Request Agent*.
Detay kurallar `CLAUDE.md`'dedir ve önceliklidir.

---

## 1. Altın Kurallar (her ajan için)
1. MVP kapsamını genişletme (billing/SSO/RBAC/microservice/blockchain/integrations yok).
2. Gereksiz bağımlılık ekleme; eklemeden önce gerekçe yaz.
3. Önce plan, onay, sonra kod.
4. Tek demo run'ını kusursuz yap; genel platform yapma.
5. Hassas veri asla açık saklanmaz/loglanmaz (bkz. \`CLAUDE.md\` Güvenlik).
6. Diff'leri açık göster.
7. Kendi şeridinde kal; başka ajanın alanını review etmeden değiştirme.

---

## 2. Roller — Hızlı Tablo

| Ajan | Rol | Ne zaman çalışır |
|------|-----|------------------|
| **Claude Code** | **Lider geliştirici**: docs, scaffold, Prisma, API, redaction, SDK, dashboard, demo agent, JSON export | Her şeyi başlatır ve yazar |
| **Codex** | Güvenlik review + test yazımı + edge-case | Backend/redaction/API yazıldıktan sonra |
| **Gemini** | Mimari ikinci görüş + UI/UX cila + browser test | Belirli aşamalarda doğrulama için |

> Akış: **Claude Code yazar → Codex güvenlik+test ile doğrular → Gemini mimari/UI gözüyle bakar → düzeltmeler Claude Code'a döner.**

---

## 3. Rol Detayları

### 3.1. Claude Code — Lider Geliştirici
**Yapar:** docs/*.md üretimi; monorepo + Next.js scaffold; Prisma schema (7 model); seed data;
API route'lar (\`/runs\`, \`/events\`, \`/complete\`, \`/exports\`); \`redactJson()\`; \`collector-js\` SDK;
\`demo-agent\`; dashboard sayfaları + timeline; JSON audit packet.
**Yapmaz:** kapsam büyütme; enterprise feature; gerekçesiz tam yeniden yazım; onaysız büyük mimari değişiklik.
**Sahiplik:** neredeyse tüm kod tabanı (lider rolünde).

### 3.2. Codex — Güvenlik & Test
**Yapar:** tenant isolation denetimi; unredacted veri sızıntısı kontrolü; API key exposure;
unsafe JSON/validation eksikleri; export'un raw hassas değer içermediğini doğrulama; unit/integration test.
**Yapmaz:** ürün kapsamını değiştirme; mimariyi yeniden yazma; gereksiz bağımlılık. **Sadece küçük yamalar önerir.**
**Çıktı:** \`docs/SECURITY_REVIEW.md\` + test dosyaları.

### 3.3. Gemini — Mimari & UI İkinci Görüş
**Yapar:** veri modeli/API yeterlilik review'u; dashboard görsel cila; shadcn/ui tutarlılığı; browser ile manuel demo testi.
**Yapmaz:** veri modelini/API'yi tek başına yeniden tasarlama (önce Claude Code onayı); redaction mantığını değiştirme (Codex onayı); enterprise feature.

---

## 4. Dosya Sahiplik Sınırları
| Alan | Yazar | Review |
|------|-------|--------|
| \`docs/**\` | Claude Code | Codex (güvenlik), Gemini (mimari) |
| \`apps/web\` (UI) | Claude Code | Gemini |
| \`apps/web/app/api/**\` | Claude Code | Codex |
| \`apps/web/prisma/**\` | Claude Code | Codex + Gemini |
| \`apps/web/lib/redaction/**\` | Claude Code | **Codex (zorunlu)** |
| \`packages/**\` | Claude Code | Codex |
| testler | Codex | — |

**Kural:** redaction / API key / tenant isolation'a dokunan değişiklik **Codex review'undan geçmeden** merge edilmez.

---

## 5. Branch / Worktree Kuralı
Aynı branch'te birden fazla ajan serbest çalışmaz.
\`\`\`
main
feature/initial-docs
feature/scaffold
feature/prisma-schema
feature/api-and-redaction
feature/collector-and-demo
feature/dashboard
review/security-codex
review/architecture-gemini
\`\`\`
Her ajan ayrı branch/worktree. Review'suz \`main\`'e merge yok.

---

## 6. Review Akışı
\`\`\`
1. Claude Code -> kısa plan üretir -> insan onayı
2. Claude Code -> branch'inde yazar
3. Codex -> güvenlik + test (redaction/tenant/API'ye dokunulduysa zorunlu)
4. Gemini -> mimari/UI + browser test
5. İnsan -> diff onay -> merge
\`\`\`
Her review çıktısı: 1) Major 2) Minor 3) Recommended changes 4) Defer after MVP.

---

## 7. MVP Kabul Kriterleri
1. Demo agent çalışıyor. 2. Run kaydediliyor. 3. Event'ler kronolojik. 4. Run listesi görünüyor.
5. Timeline görünüyor. 6. Redaction tespitleri görünüyor. 7. Redacted view çalışıyor.
8. JSON audit packet export ediliyor. 9. API key ile event gönderilebiliyor. 10. Tenant izolasyonu korunuyor.

---

### En önemli hatırlatma
> Yanlış: "Tüm framework'leri destekleyen dev platform."
> Doğru: "Tek demo run'ını kusursuz kaydet -> timeline -> redaction -> audit export."
