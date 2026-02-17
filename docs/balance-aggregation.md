# Balance Aggregation

## Amaç
Ledger tek doğruluk kaynağıdır (canonical). `unitBalances` hızlı okuma için türetilmiş bir cache'tir.
Cache bozulabilir; canonical bozulamaz. Cache her zaman ledger'dan yeniden oluşturulabilir.

## Mimari

```
Canonical (truth)          Cache (derived)
─────────────────          ───────────────
managements/{mgmtId}       managements/{mgmtId}
  /ledger/{entryId}          /unitBalances/{unitId}
```

- **Canonical**: Ledger entry'leri. Immutable domain alanları; sadece status/processing alanları değişebilir.
- **Cache**: `unitBalances` dokumanları. Sadece Cloud Function (Admin SDK) tarafından yazılır.

## unitBalances Şeması

**Path:** `managements/{mgmtId}/unitBalances/{unitId}`

| Alan | Tip | Açıklama |
|---|---|---|
| `unitId` | string | Daire/birim kimliği (doc id ile aynı) |
| `balanceMinor` | signed int | Net bakiye (minor unit). **Pozitif = alacak (birim lehine), Negatif = borç (birim aleyhine).** |
| `postedDebitMinor` | int ≥ 0 | Toplam uygulanan debit tutarı |
| `postedCreditMinor` | int ≥ 0 | Toplam uygulanan credit tutarı |
| `lastLedgerEventAt` | server timestamp | Son uygulanmış ledger olayının zamanı |
| `lastAppliedEntryId` | string | Son uygulanmış entry'nin ID'si (bilgi amaçlı) |
| `updatedAt` | server timestamp | Son güncelleme zamanı |
| `version` | int | Rebuild sayısı (başlangıç: `1`). Bkz: `docs/cache-rebuild.md` Version Semantiği |

### İşaret kuralı (Sign Convention)
- `balanceMinor = postedCreditMinor - postedDebitMinor`
- Pozitif → birim alacaklıdır (fazla ödeme var)
- Negatif → birim borçludur
- Sıfır → dengeli

## Güncelleme Stratejisi: Ledger Write → Cloud Function Apply

### Neden Cloud Function?
- Client'ın balance'ı update etmesine izin vermek: race condition + offline + replay = kaos
- Security rules karmaşıklaşır
- Cloud Function: tek yetkili yazar, idempotent, audit temiz

### Trigger: `onLedgerCreated`

**Ateşlenir:** `managements/{mgmtId}/ledger/{entryId}` üzerinde `onCreate`

**Kurallar:**
1. Entry `status === 'posted'` ise → `unitBalances` cache'e delta uygula
2. Entry `unitId` null ise → no-op (genel hareket, birim bazlı cache etkilenmez)
3. Entry `status !== 'posted'` ise → no-op

**Delta uygulama:**
- `type === 'DEBIT'` → `postedDebitMinor += amountMinor`, `balanceMinor -= amountMinor`
- `type === 'CREDIT'` → `postedCreditMinor += amountMinor`, `balanceMinor += amountMinor`

### Trigger: `onLedgerUpdated`

**Ateşlenir:** `managements/{mgmtId}/ledger/{entryId}` üzerinde `onUpdate`

**Kurallar:**

| Önceki Status | Sonraki Status | Aksiyon |
|---|---|---|
| `posted` | `voided` | Delta geri al (ters işlem uygula) |
| `posted` | `reversed` | Delta geri al (ters işlem uygula) |
| Diğer | * | No-op |

**Not:** Reverse akışında iki şey olur:
1. Orijinal entry `posted → reversed` olur → `onLedgerUpdated` tetiklenir → delta geri alınır
2. Yeni reversal entry (karşı kayıt, ters type, aynı amount) `onCreate` ile oluşur → `onLedgerCreated` tetiklenir → karşı delta uygulanır

Sonuç: reversed original'in etkisi net sıfırlanır (original geri alınır, reversal uygulanır = aynı amount ters yönde, gerçekte net 0).

**Void akışı:** Sadece orijinal entry geri alınır; karşı kayıt oluşturulmaz.

## İdempotency Stratejisi

Cloud Function aynı event'i birden fazla kez tetikleyebilir. Apply-once garantisi şart.

### Yaklaşım: Ledger doc üzerinde processing alanları

Ledger entry'ye şu teknik alanlar eklenir:

| Alan | Tip | Açıklama |
|---|---|---|
| `balanceAppliedAt` | server timestamp \| null | Bu entry'nin balance cache'e uygulandığı zaman |
| `balanceAppliedVersion` | int \| null | Uygulama sırasında kullanılan cache version'ı |

**Bu alanlar domain immutable değildir; teknik processing alanlarıdır.** Domain alanları (`type`, `amountMinor`, `unitId`, `currency`, `source`, `createdAt`, `createdBy`, `reversalOf`) immutable olarak korunur.

### Apply işlemi (transaction):

```
Transaction {
  1. Ledger entry oku
  2. entry.balanceAppliedAt varsa → return (no-op, zaten uygulanmış)
  3. unitBalances/{unitId} oku (yoksa default: zeroed doc)
  4. Delta hesapla ve uygula
  5. unitBalances doc'u güncelle
  6. Ledger entry'de balanceAppliedAt ve balanceAppliedVersion set et
  7. Commit
}
```

**Void/reverse geri alma** için aynı mantık:
- `balanceRevertedAt` alanı ile void/reverse geri alma işlemi de idempotent yapılır.

## Firestore Security Rules

```
match /managements/{mgmtId}/unitBalances/{unitId} {
  // Admin/Owner: tenant içinde tüm unitBalances read
  // Resident: sadece kendi unitId doc'u read
  allow read: if isAdminOrOwner(mgmtId) || isResidentOfUnit(mgmtId, unitId);

  // Client write kapalı — sadece Admin SDK (Cloud Function)
  allow create, update, delete: if false;
}
```

## Performans

### Dashboard + Listeler
- Yönetim panelinde N daire: `unitBalances` collection tek query ile listelenir
- Daire detayında: `ledger where unitId == X orderBy createdAt desc limit 50` ile pagination

### Raporlar
- "Toplam borç / toplam tahsilat" → `unitBalances` aggregate ile hızlı
- Doğrulama gerektiğinde → ledger'dan yeniden hesaplama

## Cache Rebuild

Detaylı rebuild, drift detection ve scale considerations için bkz: `docs/cache-rebuild.md`

Özet:
- Rebuild her zaman canonical hesap → `set` (asla `increment`) kullanır.
- `rebuildUnitBalance` callable function (admin/owner only).
- `driftCheckUnitBalances` günlük scheduled function.
- Drift tespit edildiğinde `managements/{mgmtId}/alerts/{alertId}` oluşturulur.

## Invariants (Bağlayıcı Kurallar)

1. `unitBalances` her zaman ledger'dan türetilebilir olmalıdır.
2. `balanceMinor === postedCreditMinor - postedDebitMinor` her zaman doğru olmalıdır.
3. Cloud Function dışında hiçbir client `unitBalances`'a yazamaz.
4. Her delta uygulaması Firestore transaction içinde yapılır.
5. Her uygulama idempotent olmalıdır (`balanceAppliedAt` / `balanceRevertedAt`).
6. `unitId` null olan ledger entry'leri `unitBalances` cache'i etkilemez.
7. Void edilen entry'nin etkisi geri alınır; karşı kayıt oluşturulmaz.
8. Reverse edilen entry'nin etkisi geri alınır VE karşı reversal entry'nin etkisi uygulanır.
9. **Reverse işlemi mutlaka reversal entry oluşturur (MANDATORY).** Reversed entry var ama reversal entry yoksa canonical hesap yanlış olur. Bkz: `docs/ledger-model.md` mandatory reversal invariant.
