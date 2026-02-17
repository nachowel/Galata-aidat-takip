# Data Lifecycle

## Amaç
Veri yaşam döngüsünü bağlayıcı hale getirmek: hangi entity arşivlenir, hangisi immutable kalır, hangi status değerleri kullanılır.

## Soft-delete vs Immutable vs Derived
- Soft-delete (fiziksel silme yok):
  - `managements/{mgmtId}`
  - `managements/{mgmtId}/units/{unitId}`
  - `managements/{mgmtId}/residents/{residentId}`
  - `managements/{mgmtId}/invites/{inviteId}`
  - `managements/{mgmtId}/files/{fileId}`
- Immutable (silme yok, sadece reversal/void):
  - `managements/{mgmtId}/ledger/{entryId}`
- Derived cache (ledger'dan türetilir, yeniden oluşturulabilir):
  - `managements/{mgmtId}/unitBalances/{unitId}`
  - Sadece Cloud Function (Admin SDK) yazar; client write kapalı

## Status değerleri
- Ortak soft-delete status:
  - `active`
  - `archived`
- Invite status:
  - `active`
  - `reserved`
  - `used`
  - `revoked`
- Ledger status:
  - `posted`
  - `voided`
  - `reversed`

## Arşivleme alanları
- Soft-delete entity’lerde zorunlu alanlar:
  - `status`
  - `archivedAt`
  - `archivedBy`
- Opsiyonel:
  - `archiveReason`
- Ledger için:
  - `status='voided'`
  - `voidedAt`
  - `voidedBy`
  - `voidReason`
  - `reversalOf` (varsa)

## Uygulama kuralı
- `deleteDoc` ile domain veri silinmez.
- “Temizle/sil” işlemleri `archive*`, `void*`, `reverse*` API’leri ile yapılır.
