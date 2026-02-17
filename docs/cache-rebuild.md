# Cache Rebuild & Drift Guard

## Amaç
Cache (`unitBalances`) bozulabilir: bug, kısmi uygulama, out-of-order event, manuel müdahale vb.
Bu doküman cache rebuild ve drift detection mekanizmalarını bağlayıcı şekilde tanımlar.
Cache kaybı/bozulması finansal kayıp değildir; ledger canonical olarak korunur.

## Canonical vs Derived Ayrımı

| Özellik | Canonical (Ledger) | Derived (unitBalances) |
|---|---|---|
| Path | `managements/{mgmtId}/ledger/{entryId}` | `managements/{mgmtId}/unitBalances/{unitId}` |
| Yazar | Admin/Owner (client) | Cloud Function (Admin SDK) |
| Silinebilir mi? | Hayır (immutable) | Evet (rebuild ile yeniden oluşturulabilir) |
| Bozulma etkisi | **Finansal kayıp** | Geçici yanlış gösterim |
| Doğruluk kaynağı | ✅ Evet | ❌ Hayır, türetilmiş |
| Düzeltme | Manuel audit + reversal/void | Otomatik rebuild |

**Kural:** Herhangi bir tutarsızlıkta canonical (ledger) kazanır. Cache her zaman ledger'dan yeniden hesaplanır.

## Rebuild Stratejisi

### Fonksiyon: `rebuildUnitBalance` (Callable, Admin Only)

**Input:** `{ mgmtId, unitId, force? }`

**Adımlar:**

1. Tüm ledger entry'leri oku:
   - Path: `managements/{mgmtId}/ledger`
   - Filter: `unitId == input.unitId`

2. Canonical hesap (sadece `status === 'posted'` entry'ler):
   ```
   postedDebitMinor = 0
   postedCreditMinor = 0
   entryCount = 0

   for each entry where status === 'posted':
     if type === 'DEBIT':  postedDebitMinor += amountMinor
     if type === 'CREDIT': postedCreditMinor += amountMinor
     entryCount++

   balanceMinor = postedCreditMinor - postedDebitMinor
   ```

   - `voided` entry'ler → ignore (etkisiz, zaten iptal edilmiş)
   - `reversed` entry'ler → ignore (etkisi reversal entry'de; reversal entry `posted` olarak sayılır)

3. Transaction ile `unitBalances/{unitId}` doc'u **set** et (**increment KULLANMA**):
   ```
   {
     unitId,
     balanceMinor,
     postedDebitMinor,
     postedCreditMinor,
     lastLedgerEventAt: serverTimestamp(),
     rebuiltAt: serverTimestamp(),
     rebuiltBy: callerUid,
     rebuiltFromEntryCount: entryCount,
     updatedAt: serverTimestamp(),
     version: (mevcut version + 1) || 1
   }
   ```

4. `lastAppliedEntryId` rebuild sonrası set edilmez (rebuild tüm entry'leri kapsar).

5. Alert auto-resolve: rebuild başarılı olursa ilgili open `BALANCE_DRIFT` alert'leri otomatik `status: "resolved"` yapılır.
   - **Cutoff guard:** Sadece `detectedAt <= rebuiltAt` olan alert'ler resolve edilir.
   - Bu, rebuild sırasında eş zamanlı çalışan `driftCheck`'in oluşturduğu yeni alert'lerin yanlışlıkla resolve edilmesini önler.
   - `resolvedAt`, `resolvedBy`, `resolvedReason: "REBUILD_AUTO_RESOLVE"` set edilir.
   - Her resolve edilen alert için `ALERT_AUTO_RESOLVED` audit log yazılır.

6. Audit log: `REBUILD_BALANCE` action'ı ile audit log yazılır. Bkz: `docs/audit-trail.md`.

**Kritik Kural:** Rebuild fonksiyonu hiçbir durumda `FieldValue.increment` kullanmaz. Her zaman canonical hesap → `set`.

### Rebuild Throttle Guard

- Son rebuild'den bu yana **5 dakikadan az** zaman geçmişse, fonksiyon `REBUILD_THROTTLED` hatası döner.
- Admin `force: true` parametresi ile throttle'ı bypass edebilir.
- Bu guard yanlışlıkla tekrarlanan rebuild'lerin maliyet patlamasını önler.

**Senaryo:** Admin rebuild butonuna 3 kez basıyor → ilk çağrı çalışır, sonraki 2'si 5 dakika içinde reddedilir (force kullanılmadıkça).

| Durum | Davranış |
|---|---|
| İlk rebuild (rebuiltAt yok) | Çalışır |
| Son rebuild 5dk'dan eski | Çalışır |
| Son rebuild 5dk'dan yeni, `force: false` | ❌ `REBUILD_THROTTLED` |
| Son rebuild 5dk'dan yeni, `force: true` | ✅ Çalışır |

### İdempotency
- Aynı input ile tekrar çağrılırsa ledger yeniden okunur ve aynı sonuç hesaplanır.
- `version` artar ama sonuç değişmez (canonical doğru olduğu sürece).
- Cache doc yoksa oluşturulur; varsa üzerine yazılır.

### Güvenlik Modeli
- Sadece `admin` veya `owner` çağırabilir (`request.auth.uid` ile doğrulanır).
- `enforceAppCheck: true` zorunlu.
- Input validasyonu: `mgmtId` ve `unitId` valid ID formatında olmalı.
- Tenant boundary: caller'ın management erişimi server-side doğrulanır.
- **Cross-tenant rebuild imkansız:** Callable function management ownership + tenant membership'i server tarafında doğrular. Rules yetmez; function içinde explicit kontrol şart.

## Drift Detection Mantığı

### Fonksiyon: `driftCheckUnitBalances` (Scheduled, Günlük)

**Zamanlama:** Her gün 04:00 (invite cleanup'tan sonra)

**Adımlar:**

1. Tüm management'ları listele (aktif olanlar).
2. Her management için `unitBalances` collection'ından **en son güncellenen 5 unit** seç:
   - `orderBy("updatedAt", "desc").limit(5)` → O(5) read per management.
   - En son mutasyon gören cache'ler drift'e en açık olanlardır.
   - Unit sayısı 5'ten azsa tümünü kontrol et.
3. Her seçilen unit için:
   - Canonical hesap yap (rebuild ile aynı mantık, ama yazma yapmadan).
   - Cache'deki mevcut `balanceMinor` ile karşılaştır.
4. Fark varsa:
   - `managements/{mgmtId}/alerts/{alertId}` oluştur:
     ```
     {
       type: "BALANCE_DRIFT",
       unitId,
       canonicalBalance: <hesaplanan>,
       cachedBalance: <mevcut cache>,
       diff: canonicalBalance - cachedBalance,
       detectedAt: serverTimestamp(),
       status: "open"
     }
     ```
   - Console log: `⚠️ DRIFT DETECTED: mgmt=${mgmtId} unit=${unitId} canonical=${X} cached=${Y} diff=${Z}`
   - Audit log: `DRIFT_DETECTED` yazılır.
5. Fark yoksa: `✅ No drift: mgmt=${mgmtId} unit=${unitId}` log'la.

### Sampling Stratejisi
- `orderBy("updatedAt", "desc").limit(5)` ile en son değişen cache'ler öncelikli kontrol edilir.
- Drift genellikle son mutasyonlarda oluşur; bu strateji en riskli unit'leri hedefler.
- Full-scan + Fisher–Yates shuffle **kaldırıldı** — O(n) yerine O(5) read.
- Kritik durumda admin `rebuildUnitBalance` ile manuel rebuild yapabilir.
- Gelecek optimizasyon: round-robin cursor ile tüm unit'ler sırayla kontrol edilebilir.

## Rebuild Invariants (Bağlayıcı Kurallar)

1. Rebuild her zaman ledger'dan hesaplar; mevcut cache'e bakmaz.
2. Rebuild sonucu `balanceMinor === postedCreditMinor - postedDebitMinor` olmalıdır.
3. Rebuild `FieldValue.increment` kullanmaz; her zaman `set` kullanır.
4. Rebuild idempotent'tir: aynı input → aynı sonuç.
5. Rebuild sadece admin/owner tarafından çağrılabilir.
6. Rebuild tenant sınırını aşamaz (caller yetki kontrolü).
7. Drift alert yazma yetkisi sadece Admin SDK'dadır; client yazamaz.
8. **Reversed entry için reversal entry zorunludur.** Canonical hesap sadece `posted` entry'leri sayar. Reversed entry'nin etkisi reversal entry'de yakalanır (bkz: `docs/ledger-model.md` mandatory reversal invariant).

## Version Semantiği

`unitBalances.version` alanı **rebuild sayısını** temsil eder.

| Operasyon | Version değişir mi? | Açıklama |
|---|---|---|
| `onLedgerCreated` (delta apply) | **Hayır** | İlk oluşturma `version: 1` set eder; sonraki delta'lar version'ı değiştirmez |
| `onLedgerUpdated` (void/reverse revert) | **Hayır** | Delta geri alımı version'ı değiştirmez |
| `rebuildUnitBalance` | **Evet, +1** | Her rebuild `currentVersion + 1` set eder |

**Neden rebuild count?**
- Rebuild öncesi/sonrası farkı görmek için.
- İleride migration sırasında schema versiyonu ile birlikte kullanılabilir.
- Delta apply'ler version artırırsa, gereksiz noise oluşur.

**Not:** `version` cache mutation count değildir. Cache mutation tracking gerekirse ayrı bir `mutationCount` alanı eklenebilir.

## Alert Mekanizması

### Path: `managements/{mgmtId}/alerts/{alertId}`

**Alanlar:**

| Alan | Tip | Açıklama |
|---|---|---|
| `type` | string | `"BALANCE_DRIFT"` |
| `unitId` | string | Drift tespit edilen birim |
| `canonicalBalance` | number | Ledger'dan hesaplanan doğru bakiye |
| `cachedBalance` | number | Cache'deki mevcut bakiye |
| `diff` | number | `canonicalBalance - cachedBalance` |
| `detectedAt` | server timestamp | Tespit zamanı |
| `status` | string | `"open"` (başlangıç) |

**Rules:**
- Read: admin/owner
- Write: client kapalı (sadece Admin SDK)

**Aksiyon:** Alert oluştuğunda admin dashboard'da gösterilebilir. Admin `rebuildUnitBalance` çağırarak cache'i düzeltir.

### Alert Dedup Guard
- Alert yazmadan önce aynı `unitId` için açık (`status: "open"`) BALANCE_DRIFT alert'i var mı kontrol edilir.
- Varsa yeni alert **yazılmaz** → alert spam önlenir.
- Admin drift'i düzeltip rebuild yapınca alert otomatik resolve olur; eğer drift tekrar olursa yeni alert yazılır.
- Bu guard `driftCheckUnitBalances` function'ında implementedir.

### Alert Lifecycle

```
driftCheck detects drift → status: "open" → admin calls rebuild → auto-resolve → status: "resolved"
```

| Durum | Tetikleyen | Sonraki Durum |
|---|---|---|
| Alert oluşturuldu | `driftCheckUnitBalances` | `open` |
| Rebuild başarılı | `rebuildUnitBalance` | `resolved` (otomatik) |
| Drift tekrar oluştu | `driftCheckUnitBalances` | Yeni `open` alert |

**Resolve Alanları (rebuild sonrası set edilir):**

| Alan | Tip | Açıklama |
|---|---|---|
| `resolvedAt` | server timestamp | Resolve zamanı |
| `resolvedBy` | string | Rebuild yapan admin UID |
| `resolvedReason` | string | `"REBUILD_AUTO_RESOLVE"` |

**Kural:** Alert koleksiyonu birikimini önlemek için rebuild sonrası otomatik resolve zorunludur. Manual resolve şu an desteklenmez.

### Audit Trail Entegrasyonu

- Drift tespit edildiğinde: `DRIFT_DETECTED` audit log yazılır.
- Alert resolve edildiğinde: `ALERT_AUTO_RESOLVED` audit log yazılır.
- Rebuild yapıldığında: `REBUILD_BALANCE` audit log yazılır.
- Detaylar: `docs/audit-trail.md`

## Performans Sınırları

- Rebuild tek bir unit için çalışır → ledger query boyutu unit başına entry sayısı ile sınırlı.
- Drift check günlük 5 unit × management sayısı → düşük maliyet.
- Çok fazla ledger entry'si olan unit'ler için query pagination gerekebilir (>10K entry → batch read).
- Rebuild transaction'ı sadece 1 doc yazma içerir (unitBalances doc).

## Edge Case'ler

### Void/Reverse/Out-of-Order Events

| Senaryo | Rebuild Davranışı |
|---|---|
| Entry voided ama trigger çalışmadı | Rebuild canonical'dan hesaplar → doğru sonuç |
| Entry reversed ama reversal entry henüz yok | Reversed entry ignore edilir → bakiye eksik olabilir; reversal entry create edilince trigger düzeltir veya sonraki rebuild düzeltir |
| Out-of-order trigger | Rebuild canonical'dan hesaplar → sıra fark etmez |
| Cache doc silindi | Rebuild yeni doc oluşturur |
| Cache doc hiç yoktu | Rebuild yeni doc oluşturur |
| Ledger entry yok (birim boş) | Rebuild sıfır bakiye doc oluşturur |
| Concurrent rebuild çağrıları | İkisi de canonical hesaplar → aynı sonuç (idempotent) |
| Rebuild sırasında yeni entry yazılır | Rebuild transaction sırasında entry eklenirse Firestore transaction retry eder |

### Mandatory Reversal Entry
- Reversed entry var ama reversal entry yok → canonical hesap eksik olur.
- DriftCheck bu durumu yakalar ve alert oluşturur.
- Bkz: `docs/ledger-model.md` mandatory reversal invariant.

## Scale Considerations (Bilinen Sınırlar)

### Mevcut Model (Optimize edilmiş)
- DriftCheck: `orderBy("updatedAt", "desc").limit(5)` → O(5) read per management.
- Canonical hesap: tüm ledger entry'lerini full scan (unit başına).
- 24 daireli tek yönetim için sorunsuz.

### Kırılma Noktaları (SaaS ölçeğinde)

| Metrik | Mevcut Maliyet | 1.000 mgmt × 200 unit | Risk |
|---|---|---|---|
| DriftCheck unitBalances read | 5 doc/mgmt | 5.000 doc/gün | ✅ İyi |
| Canonical hesap per unit | ~50 entry | ~10.000 entry | ❌ 10K read per rebuild |
| Alert query | 1 query/unit | 5.000 query/gün | ⚠️ Orta |

### Gelecek Optimizasyonları
1. **✅ UYGULANDİ: DriftCheck sampling** — `orderBy("updatedAt", "desc").limit(5)` per management.
2. **Incremental rebuild:** `ledger where unitId == X and createdAt >= lastRebuildAt` ile sadece yeni entry'lerden delta hesapla.
3. **Round-robin cursor:** `unitBalances` üzerinde `driftCheckCursor` alanı tutup sıralı kontrol.
4. **Per-management scheduling:** Her management kendi drift schedule'ını belirler.

**Kural:** Mevcut sampling optimize edilmiştir (O(5) per management). Canonical hesap full-scan MVP için kabul edilir.

## Dashboard Read Stratejisi

Resident ve admin dashboard'unda bakiye verisi nereden okunur:

| UI Bölümü | Veri Kaynağı | Gerekçe |
|---|---|---|
| Dashboard daire listesi | `unitBalances` collection query | Hızlı, tek sorgu, N daire |
| Daire detay — bakiye | `unitBalances/{unitId}` single doc | Realtime listener ile anlık güncelleme |
| Daire detay — hareket listesi | `ledger where unitId == X orderBy createdAt desc limit 50` | Pagination ile tarihsel detay |
| Toplam borç/tahsilat raporu | `unitBalances` aggregate | Hızlı özet; doğrulama gerekirse ledger'dan rebuild |
| Resident kendi bakiyesi | `unitBalances/{kendi unitId}` | Realtime listener; rules sadece kendi doc'u okutturur |

**Kural:** Balance "truth" her zaman `unitBalances`'dan okunur (hızlı). Şüphe varsa `rebuildUnitBalance` çağrılır.
