# SaaS-Grade Hardening

Bu döküman sistemde uygulanan dört kritik güvenlik ve güvenilirlik katmanını açıklar.

## 1. Audit Replay (Gerçek Güvenlik Seviyesi)

### Problem
Sistem aggregate convenience alanlarına güveniyor:
- `dueAllocatedMinor`, `dueOutstandingMinor`, `dueStatus`
- `appliedMinor`, `unappliedMinor`, `allocationStatus`

Bunlar hız için tutuluyor ama tek doğruluk kaynağı değiller.

### Çözüm: İki Seviye

#### A) Test: Full Replay (`test-audit-replay.mjs`)
Ledger + dueAllocations'tan tüm aggregate'leri yeniden hesaplar, stored değerlerle birebir karşılaştırır.

**Replay fonksiyonları:**
- `replayDueAggregates(mgmtId, dueId, total)` → dueAllocations'tan allocatedMinor hesaplar
- `replayPaymentAggregates(mgmtId, paymentEntryId, total)` → dueAllocations'tan appliedMinor hesaplar
- `replayCanonicalBalance(mgmtId, unitId)` → ledger'dan balance hesaplar

```
node functions/scripts/test-audit-replay.mjs
```

#### B) Prod: Windowed Audit (`auditReplayUnit` callable)
Production'da maliyet kontrolü için iki mod:

| Mod | Scope | Maliyet | Detay |
|-----|-------|---------|-------|
| `window` | Son N gün içinde **güncellenen** entry'ler | Düşük | `ledger.createdAt` ve `dueAllocations.createdAt` taranır. Allocations sayesinde eski ama yeni güncellenen kayıtlar (blind spot) yakalanır. |
| `full` | Tüm geçmiş + balance cache | Yüksek | Tüm ledger + allocations taranır. |

```typescript
// Günlük window audit (7 gün) — updates to old entries yakalanır
auditReplayUnit({ managementId, unitId, mode: "window", windowDays: 7 })
```

**Drift tespit edilirse:**
- `alerts` ve `auditLogs` kaydı oluşturulur.

---

## 2. Stress Fuzz Test v2 (Seeded Deterministic Chaos)

### Problem
Mevcut testler senaryo bazlı. Gerçek dünya deterministic değil.
Ayrıca **Double Counting** riski: `auto_settlement` entry'leri bakiyeyi şişirmemeli.

### Çözüm: Corrected Canonical Balance & Real-Time Cache
`test-stress-fuzz.mjs`, `index.ts` (canonical logic), ve **Real-Time Cache Triggers** (`onLedgerCreated/Updated`) güncellendi:
- `balanceMinor` hesaplanırken `source: "auto_settlement"` olan CREDIT entry'ler **HARİÇ TUTULUR**.
- Settlement sadece borç/alacak eşleştirmesidir, net varlığı değiştirmez.
- Bu fix sayesinde INV-6 (Balance Consistency) artık matematiksel olarak doğru çalışıyor ve **Drift Alarm** üretmiyor.

**Yenilikler:**
- **Seed determinism**: `FUZZ_SEED=184773 node test-stress-fuzz.mjs` → aynı run
- **Failing seed**: Hata mesajında `Failing seed: 184773` yazdırılır
- **8 fazlı chaos**:
  1. Random dues (timestamp tie'lar dahil)
  2. Random payments (direct + unallocated + varied methods)
  3. autoSettle round 1
  4. Random reversePayment (chaos)
  5. Post-reversal payments
  6. autoSettle round 2 (reversed dues reopen)
  7. Idempotency duplicate test
  8. 8 invariant check

**8 Invariant:**
1. INV-1: Due aggregate'lerde negatif değer yok
2. INV-2: Overallocation yok (`allocated <= total`)
3. INV-3: Payment'ta negatif unapplied yok
4. INV-4: Settlement allocation toplamı = entry amountMinor
5. INV-5: Canonical due allocationSum <= due total
6. INV-6: Canonical balance == cached balance
7. INV-7: Reversed entries excluded from posted
8. INV-8: Settlement cashIn === false

```bash
# Normal run
node functions/scripts/test-stress-fuzz.mjs

# Reproduce failure
FUZZ_SEED=184773 node functions/scripts/test-stress-fuzz.mjs
```

---

## 3. SaaS-Level Idempotency (clientRequestId + stillValid)

### Problem
`autoSettleFromCredit` ikinci çağrıda `NO_ELIGIBLE_DUES` dönüyor.
Frontend retry yapan kullanıcı "error" görüyor.

### Çözüm

#### A) clientRequestId
`autoSettleFromCredit` opsiyonel `clientRequestId` kabul ediyor:

```typescript
autoSettleFromCredit({
  managementId: "...",
  unitId: "...",
  clientRequestId: "unique-client-generated-uuid"
})
```

**Davranış:**
1. `clientRequestId` verilmezse → mevcut davranış (backward compatible)
2. İlk çağrı → normal işlem + `settleResults/{clientRequestId}` kaydı
3. Retry → önceki başarılı sonuç + `stillValid` doğrulama
4. Farklı boundary → `CLIENT_REQUEST_ID_CONFLICT`

#### B) stillValid Doğrulama
Replay'da eski sonuç dönmeden önce, settlement entry'lerin statüsü kontrol edilir:

```json
{
  "closedDueCount": 3,
  "totalSettledMinor": 120000,
  "remainingCreditMinor": 30000,
  "replay": true,
  "stillValid": true    // false → admin arada reverse yaptı
}
```

**Frontend davranışı:**
- `replay: true, stillValid: true` → "İşleminiz daha önce tamamlandı" göster
- `replay: true, stillValid: false` → "İşlem geçmişte yapıldı ancak durum değişti" → yeniden dene butonu

#### C) TTL Cleanup (`cleanupSettleResults`)
- Günlük 05:00'te çalışır
- 7 günden eski `settleResults` doc'larını siler
- Maliyet ve privacy kontrolü

#### D) Mevcut Callable'lar Zaten SaaS-Ready
- `createPayment`: aynı idempotencyKey → `created: false` + previous result
- `createExpense`: aynı idempotencyKey → `created: false` + previous result
- `reversePayment`: aynı çağrı → `noop: true` + previous result
- `reverseLedgerEntry`: aynı çağrı → `noop: true` + previous result

**Storage:** `managements/{mgmtId}/settleResults/{clientRequestId}`
**TTL:** 7 gün (configurable via `SETTLE_RESULT_TTL_DAYS`)
**Security:** Admin SDK only, client read allowed for admin/owner.

---

## 4. Reporting Formalization (cashIn Filtresi)

### Problem
Settlement entry'de `cashIn: false, paymentMethod: "credit_balance"` var.
Ama gerçek para girişini ayırmak için explicit filtre yok.

### Çözüm

#### 4a. Payment Entry'lere `cashIn: true` Eklendi
**Yeni:** `createPayment` artık her payment entry'nin `metadata`'sına:
```json
{ "cashIn": true, "paymentMethod": "cash" }
```

**Mevcut:** `autoSettleFromCredit` settlement entry'leri:
```json
{ "cashIn": false, "paymentMethod": "credit_balance" }
```

#### 4b. Formal Reporting Callable: `getFinancialReport`

```typescript
getFinancialReport({ managementId: "...", unitId: "..." })
```

**Dönüş:**
```json
{
  "totalCashInMinor": 250000,
  "totalSettlementMinor": 70000,
  "settlementLabel": "INTERNAL_TRANSFER",
  "totalDebitMinor": 300000,
  "totalCreditMinor": 320000,
  "netBalanceMinor": 20000,
  "entryCount": 15,
  "cashInByMethod": { "cash": 150000, "bank": 100000 }
}
```

#### 4c. Settlement = Internal Transfer (Not Income!)
`settlementLabel: "INTERNAL_TRANSFER"` döner. UI'da:
- Türkçe: **"Dahili Mahsup"**
- İngilizce: **"Internal Credit Transfer"**
- **Gelir raporlarına DAHİL EDİLMEZ**

Muhasebeci notu: Settlement = birim'in mevcut bakiyesinin borçlara mahsubu.
Yeni para girişi değildir. Gelir toplamında SADECE `cashIn === true` sayılır.

**Kritik kural:**
```typescript
// ✅ DOĞRU
if (meta?.cashIn === true) totalCashIn += amount;

// ❌ YANLIŞ
if (paymentMethod !== "credit_balance") totalCashIn += amount;
```

---

## Deployed Functions Summary

| Function | Type | Amaç |
|----------|------|------|
| `auditReplayUnit` | callable | Window/full audit replay |
| `getFinancialReport` | callable | cashIn-based financial report |
| `cleanupSettleResults` | scheduled | settleResults TTL (7d) |
| `cleanupInvites` | scheduled | Invite TTL (existing) |
| `driftCheckUnitBalances` | scheduled | Balance cache drift (existing) |
| `checkDueAggregateDrift` | scheduled | Due aggregate drift (existing) |
| `generateMonthlyDues` | scheduled | Monthly dues (existing) |

## Test Matrix

| Test | Dosya | Amaç |
|------|-------|------|
| Audit Replay | `test-audit-replay.mjs` | Full aggregate → canonical eşleşme |
| Stress Fuzz v2 | `test-stress-fuzz.mjs` | Seeded chaos + 8 invariant |
| Edge Cases | `test-auto-settle-from-credit.edge.mjs` | 10 senaryo bazlı test |
| Concurrency | `test-auto-settle-concurrency.mjs` | Paralel race condition |
| Balance | `test-balance-aggregation.mjs` | Cache tutarlılığı |
| Cache Rebuild | `test-cache-rebuild.mjs` | Rebuild + drift |
| Dues Engine | `test-dues-engine.mjs` | Monthly dues flow |

## Operasyonel Riskler (Test ile Yakalanmaz)

| Risk | Etki | Mitigation |
|------|------|------------|
| Index büyümesi → query cost | Fatura | Composite index monitoring |
| Hot partition (aynı unit'e çok yazma) | Throttle / 429 | Rate limiter + queue |
| Security rules yanlış kurgu | Data leak | Integration test + manual audit |
| Multi-tenant isolation | Cross-tenant data | Tenant boundary checks in every function |
