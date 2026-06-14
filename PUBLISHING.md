# PUBLISHING.md — collector-js'i npm'e Yayınlama

> `packages/collector-js`'i dış kullanıcıların `npm install` ile kurabileceği hale getirir.
> Mantık: kutuyu paketle → benzersiz etiket ver → ortak rafa koy.
> Acele etme: paket kendi agent'ınla sorunsuz çalışıp stabilleşmeden yayınlama. Her yayın **kalıcıdır**.

---

## 0. Yayına hazır mıyım? (önce bunlar)
- [ ] `collector-js` kendi/demo agent'la gerçekten çalışıyor (GO_LIVE Seviye A geçti).
- [ ] SDK içinde mock/stub yok; gerçek HTTP yapıyor.
- [ ] README/temel kullanım örneği var.
- [ ] Pakette gizli kalması gereken hiçbir şey yok (key, `.env`, test verisi).

Hepsi değilse: dur, önce bunları bitir. Workspace içinden kullanmaya devam et; npm beklesin.

---

## 1. npm hesabı + giriş
1. npmjs.com'da bir hesap aç (varsa atla). E-postanı doğrula, 2FA aç (önerilir).
2. Terminalde bir kez giriş yap:
   ```bash
   npm login
   ```
   Kim olduğunu doğrula:
   ```bash
   npm whoami
   ```
   ✅ Kullanıcı adın yazıyorsa giriş tamam.

---

## 2. İsmi (scope) sahiplen
Paket adı `@scope/collector-js` biçimindedir. `@scope` senin olmalı.

- **En kolayı:** kendi kullanıcı adın scope olur → `@KULLANICI_ADIN/collector-js`. Ekstra kurulum gerekmez.
- **Marka istersen:** npmjs.com'da bir **organization** oluşturup (`@agent-evidence` gibi) onu sahiplenirsin, sonra o scope'u kullanırsın.

Adın boş mu, kontrol et:
```bash
npm view @KULLANICI_ADIN/collector-js
```
✅ `404 / not found` görürsen ad boştur, kullanabilirsin. Bir paket bilgisi dönerse ad alınmıştır → başka ad seç.

> Daha önce baktık: `@agent-evidence/collector-js` npm'de yoktu, ama o scope senin değil. Sahiplenmezsen o adı kullanamazsın. Belgelerdeki `@agent-evidence` bir placeholder'dır.

---

## 3. Etiketi hazırla (package.json)
`packages/collector-js/package.json` kutunun üstündeki etikettir. Şunlar doğru olmalı:
- `name`: sahip olduğun scope ile (ör. `@KULLANICI_ADIN/collector-js`)
- `version`: ilk yayın için `0.1.0`
- `publishConfig`: `{ "access": "public" }` (scope'lu paketler varsayılan gizlidir; bu onu herkese açar)
- `main` / `types`: derlenmiş çıktıyı işaret etsin (TS paketi build edilmeli)
- `files`: pakete yalnızca gerekli klasör girsin (ör. sadece `dist`)

Claude Code'a verebileceğin prompt:
```
Prepare packages/collector-js for npm publishing without changing its behavior:
- set name to @<MY_SCOPE>/collector-js, version 0.1.0
- add "publishConfig": { "access": "public" }
- ensure build outputs dist/ and main/types point to it
- add a "files" allowlist so ONLY dist (and license/readme) are published
- add a .npmignore or files field so source, tests, .env, and fixtures are NEVER published
Show me the final package.json and the list of files that would be published. Do not publish yet.
```

---

## 4. Kutunun içine bak (güvenlik kapısı — atlamadan)
Yayından **önce** pakete neyin gireceğini gör:
```bash
cd packages/collector-js
npm run build        # varsa: TS -> dist
npm pack --dry-run   # yayınlanacak dosya listesini gösterir, gerçekten yayınlamaz
```
✅ Listede **sadece** `dist`, `package.json`, `README`, `LICENSE` olmalı.
❌ Listede `.env`, kaynak `src`, test, fixture, key görürsen **DUR** ve `files`/`.npmignore`'u düzelt. Sızan sırrı geri almak çok zordur.

---

## 5. Yayınla
```bash
npm publish --access public
```
✅ Birkaç saniye sonra herkes şunu diyebilir:
```bash
npm install @KULLANICI_ADIN/collector-js
```
Teyit:
```bash
npm view @KULLANICI_ADIN/collector-js version
```

INTEGRATION.md'deki kurulum satırını bu gerçek adla güncelle.

---

## 6. Güncelleme: sürümü artır, tekrar yayınla
Aynı sürüm iki kez yayınlanamaz (kural). Değişiklik yapınca:
```bash
npm version patch   # 0.1.0 -> 0.1.1 (küçük düzeltme)
# npm version minor # 0.1.0 -> 0.2.0 (yeni özellik, kırıcı değil)
# npm version major # 1.0.0 -> 2.0.0 (kırıcı değişiklik)
npm publish --access public
```
> Anlamlı sürümleme: düzeltme = patch, geriye uyumlu yeni özellik = minor, kırıcı = major. Entegratörler buna güvenir.

---

## 7. Yanlış giderse
- **Yanlış/bozuk sürüm yayınladım:** Hemen düzelt, sürümü artır, yeni sürümü yayınla. (`unpublish` ilk 72 saatte mümkün ama önerilmez; tercih: yeni sürüm.)
- **Sır sızdı:** Sızan key'i **derhal revoke et** ve yenisini üret — paketi geri çekmek yetmez, anahtarı değiştir.
- **`402` / access hatası:** scope'lu paketi `--access public` olmadan yayınlamaya çalışıyorsundur; bayrağı ekle veya `publishConfig`'i koy.

---

## Kısa özet
**giriş yap → ismi sahiplen → etiketi hazırla → `npm pack --dry-run` ile içine bak → `npm publish --access public` → (değişiklikte) sürümü artır, tekrar yayınla.**

Şimdilik gerek yoksa yayınlama; workspace içinden kullanmak fonksiyonel olmak için yeterli. npm'i, dışarıdan kullanıcı almaya hazır olduğunda aç.
