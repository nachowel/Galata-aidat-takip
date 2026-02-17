# Ledger Model

## Amaç
Bu model finansal hareketleri denetlenebilir, geri izlenebilir ve tenant-safe şekilde tutar. Ledger tek doğruluk kaynağıdır.

## Kapsam
- Path: `managements/{mgmtId}/ledger/{entryId}`
- Her hareket ayrı bir immutable entry olarak yazılır.
- Bakiye hesaplanır; kalıcı `balance` alanı tutulmaz.

## Ledger alanları
- `id` (doc id)
- `managementId` (string)
- `unitId` (string | null)  
  Not: Unit’e bağlı olmayan genel hareketlerde `null` olabilir.
- `type` (`DEBIT` | `CREDIT`)
- `amountMinor` (integer)  
  Minor unit zorunlu: `kuruş/pence` (ondalık yok).
- `currency` (string, ör. `TRY`)
- `source` (`manual` | `auto` | `invite` | `adjustment` | `reversal` | `void`)
- `description` (string)
- `status` (`posted` | `voided` | `reversed`)
- `voidReason` (string | null)
- `voidedAt` (timestamp | null)
- `voidedBy` (uid | null)
- `reversalOf` (entryId | null)
- `createdAt` (server timestamp, **MANDATORY**)
  **createdAt her zaman `serverTimestamp()` kullanılarak set edilmelidir. Null olamaz.**
  Bu invariant canonical balance hesabının deterministik olmasını garanti eder.
- `createdBy` (uid)
- `metadata` (map, opsiyonel, sınırlı anahtar seti)

## Audit Trail
Ledger entry'lerin kendisi immutable bir finansal kayıttır.
Ancak sistem operasyonları (rebuild, void, reverse, drift detection) ayrıca `auditLogs` koleksiyonunda loglanır.
Bkz: `docs/audit-trail.md`

## Invariants (bağlayıcı kurallar)
- `amountMinor` her zaman `> 0` integer olmalı.
- `type` yalnızca `DEBIT` veya `CREDIT`.
- Yön yalnızca `type` ile belirlenir; `amountMinor` negatif olamaz.
- `createdAt`, `createdBy`, `managementId`, `unitId`, `type`, `amountMinor`, `currency`, `source` immutable.
- `status=voided` olduktan sonra entry tekrar `posted` olamaz.
- `voided` entry için `reversalOf` boş olmalıdır.
- `reversed` statüsü yalnızca orijinal entry üzerinde kullanılır.
- `reversalOf` doluysa bu entry’nin `source='reversal'` olması zorunlu.
- Aynı entry fiziksel olarak silinemez.
- Cross-tenant referans yasak: `managementId` path tenant’ı ile aynı olmalı.

## Immutable alan listesi
- `managementId`
- `unitId`
- `type`
- `amountMinor`
- `currency`
- `source`
- `createdAt`
- `createdBy`
- `reversalOf`

## Reversal / Void senaryoları

**ÖNEMLİ:** Void ve reverse işlemleri artık **Cloud Function üzerinden** yapılır.
Client `voidLedgerEntry` ve `reverseLedgerEntry` callable function'larını çağırır.
Firestore rules, client tarafından ledger update'i engellemektedir (`allow update: if false`).
Bu mimari değişiklik **audit trail garantisi** ve **atomik reversal invariant**'ı sağlar.

- Yanlış tutar veya yanlış type girildiyse:
  - Orijinal kayıt silinmez.
  - `reverseLedgerEntry` çağrılır:
    - Function aynı transaction içinde:
      1. Orijinal entry `status='reversed'` olarak işaretler
      2. Yeni bir `reversal` entry oluşturur (`reversalOf = originalEntryId`, `type` terslenir, `amountMinor` aynı)
    - `LEDGER_REVERSE` audit log yazılır.
    - **İdempotent:** Already reversed ise graceful no-op (hata değil, `noop: true` döner).
- Operasyonel iptal (void):
  - `voidLedgerEntry` çağrılır:
    - Function transaction içinde `status='voided'`, `voidReason`, `voidedAt`, `voidedBy` set eder.
    - `LEDGER_VOID` audit log yazılır.
    - **İdempotent:** Already voided ise graceful no-op (hata değil, `noop: true` döner).
  - Void edilen kayıt raporda ayrı gösterilir.
- **Kural: `void` ve `reverse` aynı entry üzerinde birlikte kullanılmaz.**
  - Voided entry reverse edilemez → `ENTRY_VOIDED` hatası
  - Reversed entry void edilemez → `ENTRY_REVERSED` hatası
  - Bu politika hem kodu hem de audit trail'i basitleştirir: bir entry yalnızca bir final state'e sahip olabilir.
- Kural: Ledger için `archive` semantiği yoktur; sadece `void` veya `reverse` vardır.
- **Kural (MANDATORY): Reverse işlemi mutlaka karşı entry oluşturur.**
  - `reverseLedgerEntry` Cloud Function bu invariant'ı atomik olarak garanti eder.
  - Original entry `status='reversed'` yapılırken, aynı transaction'da `source='reversal'`, `reversalOf=originalEntryId`, ters type, aynı amount ile yeni bir posted entry yaratılır.
  - **Bu invariant bozulursa canonical balance hesabı yanlış olur.** Canonical hesap sadece `status='posted'` entry'leri sayar; reversed entry ignore edilir, etkisi reversal entry'de yakalanır.
  - İhlal: Reversed entry var ama reversal entry yok → **veri tutarsızlığı, drift alert tetiklenir.**

## Balance kuralı
- `balance` kalıcı alan olarak tutulmaz.
- Her zaman ledger toplamından hesaplanır:
  - `sum(CREDIT) - sum(DEBIT)`
- Resident bakiyesi `unitId` filtreli hesaplanır.
- Management toplam bakiyesi tenant düzeyinde hesaplanır.

## Cache: unitBalances (balance-aggregation.md)
- Cache katmanı artık opsiyonel değil; `docs/balance-aggregation.md` kontratı bağlayıcıdır.
- Path: `managements/{mgmtId}/unitBalances/{unitId}`
- Sadece Cloud Function (Admin SDK) yazar; client write kapalı.
- Cache her zaman ledger'dan yeniden üretilebilir; bozulması finansal kayıp değildir.
- Detaylar için bkz: `docs/balance-aggregation.md`

## Teknik processing alanları (domain-immutable DEĞİL)
Ledger entry üzerinde şu alanlar Cloud Function tarafından set edilir:
- `balanceAppliedAt` — entry cache'e uygulandığında set edilir
- `balanceAppliedVersion` — uygulama versiyonu
- `balanceRevertedAt` — void/reverse sonrası geri alındığında set edilir
- `balanceRevertedVersion` — geri alma versiyonu

Bu alanlar idempotency için kullanılır. Domain alanları (`type`, `amountMinor`, `unitId` vb.) değişmez.
