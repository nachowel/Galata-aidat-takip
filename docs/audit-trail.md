# Audit Trail

## Amaç
Finansal bir sistemde "kim, ne zaman, ne yaptı?" sorusu kritiktir. Ledger immutable ama
sistem operasyonları (rebuild, drift detect, alert resolve, void, reverse) ayrıca loglanmalıdır.
Audit trail tüm kritik operasyonları bağımsız, immutable bir koleksiyonda kaydeder.

## Path

```
managements/{mgmtId}/auditLogs/{logId}
```

## Şema

| Alan | Tip | Açıklama |
|---|---|---|
| `action` | string | Operasyon tipi (bkz: Action Tipleri) |
| `actorUid` | string | İşlemi yapan kullanıcının UID'si. Scheduled job'lar için `"system"` |
| `targetId` | string | Hedef entity ID (unitId, entryId, alertId vb.) |
| `targetType` | string | Entity tipi: `"unit"`, `"ledgerEntry"`, `"alert"` |
| `managementId` | string | Yönetim ID (denormalize — query kolaylığı) |
| `at` | server timestamp | Log oluşturulma zamanı |
| `metadata` | map (opsiyonel) | Action'a özgü ek bilgi |

## Action Tipleri

| Action | Tetikleyen | targetType | Açıklama |
|---|---|---|---|
| `REBUILD_BALANCE` | `rebuildUnitBalance` callable | `unit` | Balance cache rebuild yapıldı |
| `LEDGER_REVERSE` | `reverseLedgerEntry` callable | `ledgerEntry` | Ledger entry reversed (Cloud Function) |
| `LEDGER_VOID` | `voidLedgerEntry` callable | `ledgerEntry` | Ledger entry voided (Cloud Function) |
| `DRIFT_DETECTED` | `driftCheckUnitBalances` scheduled | `unit` | Balance drift tespit edildi |
| `ALERT_AUTO_RESOLVED` | `rebuildUnitBalance` callable | `alert` | Rebuild sonrası alert otomatik kapatıldı |
| `AUDIT_WRITE_FAILED` | Herhangi bir audit log yazma hatası | `alert` | Audit log yazma başarısız — alert olarak iz bırakıldı |

## Metadata Örnekleri

### REBUILD_BALANCE
```json
{
  "balanceMinor": -7000,
  "postedDebitMinor": 15000,
  "postedCreditMinor": 8000,
  "entryCount": 2,
  "version": 3,
  "force": false,
  "alertsResolved": 1
}
```

### DRIFT_DETECTED
```json
{
  "canonicalBalance": -7000,
  "cachedBalance": 99999,
  "diff": -106999,
  "alertId": "abc123"
}
```

### ALERT_AUTO_RESOLVED
```json
{
  "unitId": "unit-101",
  "originalAlertType": "BALANCE_DRIFT",
  "resolvedReason": "REBUILD_AUTO_RESOLVE"
}
```

### LEDGER_VOID
```json
{
  "reason": "Yanlış birime kaydedilmiş"
}
```

### LEDGER_REVERSE
```json
{
  "reversalEntryId": "rev-abc123",
  "reversalType": "CREDIT",
  "reason": "İade işlemi"
}
```

## Güvenlik Modeli

### Firestore Rules
```
match /managements/{mgmtId}/auditLogs/{logId} {
  allow read: if isAdminOrOwner(mgmtId);
  allow create, update, delete: if false;
}
```

- **Read:** Sadece admin/owner.
- **Write:** Kapalı — sadece Cloud Function (Admin SDK) yazabilir.
- **Delete:** Kapalı — audit log'lar immutable.

## Immutability Kuralı

Audit log entry'leri oluşturulduktan sonra **değiştirilemez ve silinemez**.

- Client tarafından yazma: **rules ile yasak**.
- Cloud Function tarafından update: **kod convention olarak yasak** (writeAuditLog fonksiyonu her zaman yeni doc oluşturur).
- Fiziksel silme: Sadece Firebase Console'dan; normal operasyonlarda yapılmaz.

## Fire-and-Forget Prensibi

Audit log yazma işlemi **asenkron ve hata toleranslı** olarak yapılır:

```typescript
async function writeAuditLog(...) {
  try {
    await logRef.set({...});
  } catch (err) {
    console.error("Audit log write failed:", err);
    // Ana operasyonu BLOKlama — audit hatası finansal işlemi engellemez

    // Dedup guard: son 1 saat içinde aynı action için open AUDIT_WRITE_FAILED varsa skip
    const existing = await alerts
      .where("type", "==", "AUDIT_WRITE_FAILED")
      .where("action", "==", action)
      .where("status", "==", "open")
      .where("detectedAt", ">=", oneHourAgo)
      .limit(1).get();

    if (existing.empty) {
      // Breadcrumb: AUDIT_WRITE_FAILED alert oluştur
      await alertsRef.set({
        type: "AUDIT_WRITE_FAILED",
        action, actorUid, targetId,
        errorMessage: err.message,
        status: "open"
      });
    }
  }
}
```

**Dedup Kuralı:** Aynı `action` için son 1 saat içinde open `AUDIT_WRITE_FAILED` alert varsa yeni alert yazılmaz.
Bu, persistent bir Firestore hatası durumunda alert spam'ini önler.

**Kural:** Audit log yazma başarısız olsa bile ana operasyon (rebuild, void, reverse, drift check vb.) devam eder.
Ancak başarısızlık durumunda `AUDIT_WRITE_FAILED` alert'i ile iz bırakılır. Audit kaybı, finansal bütünlükten daha az kritiktir.

## Entegrasyonlar

### Rebuild → Audit Log
`rebuildUnitBalance` başarılı olduğunda:
1. `REBUILD_BALANCE` audit log yazılır
2. Eğer open alert'ler resolve edildiyse, her biri için `ALERT_AUTO_RESOLVED` yazılır
3. **Cutoff guard:** Sadece `detectedAt <= rebuiltAt` olan alert'ler resolve edilir

### Drift Check → Audit Log
`driftCheckUnitBalances` drift tespit ettiğinde:
1. Alert oluşturulur
2. `DRIFT_DETECTED` audit log yazılır

### Ledger Void → Audit Log
`voidLedgerEntry` başarılı olduğunda:
1. Ledger entry `status: "voided"` yapılır (transaction içinde)
2. `LEDGER_VOID` audit log yazılır

### Ledger Reverse → Audit Log
`reverseLedgerEntry` başarılı olduğunda:
1. Original entry `status: "reversed"` yapılır
2. Reversal entry oluşturulur (aynı transaction içinde, mandatory reversal invariant)
3. `LEDGER_REVERSE` audit log yazılır

## Sorgulama Örnekleri

### Son 50 rebuild
```
auditLogs where action == "REBUILD_BALANCE" orderBy at desc limit 50
```

### Belirli bir unit'in tüm operasyonları
```
auditLogs where targetId == unitId orderBy at desc
```

### Tüm drift detection'lar
```
auditLogs where action == "DRIFT_DETECTED" orderBy at desc
```

## Scale Considerations

- Audit log'lar append-only: boyut zaman içinde büyür.
- MVP'de cleanup veya archival uygulanmaz.
- SaaS ölçeğinde:
  - TTL policy (örn: 365 gün sonra BigQuery'e export + Firestore'dan sil)
  - Composite index: `action + at` ve `targetId + at`
