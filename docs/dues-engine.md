# Dues Engine (Otomatik Aidat Motoru)

## Amaç
Sistemin her ay belirlenen günde (varsayılan: ayın 1'i), tüm aktif daireler için otomatik aidat tahakkuku (debit entry) oluşturmasıdır.

Bu işlem **finansal kritikliğe** sahip olduğu için:
1. **Idempotent** olmalıdır (Aynı ay için mükerrer borç yazılamaz).
2. **Denetlenebilir** olmalıdır (Audit trail).
3. **Atomik** olmalıdır (Registry kaydı ve Ledger kaydı aynı anda oluşur).

## Veri Modeli

### 1. Ayarlar (`settings/dues`)
Her yönetim (management) için aidat kurallarını belirler.
- Path: `managements/{mgmtId}/settings/dues`
- Alanlar:
  - `enabled`: boolean (Motor çalışsın mı?)
  - `monthlyFeeMinor`: number (Aidat tutarı, kuruş cinsinden. Ör: 10000 = 100 TL)
  - `currency`: string (Varsayılan "TRY")
  - `dueDay`: number (Ayın kaçında çalışacağı. Varsayılan: 1)
  - `timezone`: string (Ör: "Europe/Istanbul")
  - `exemptUnitIds`: string[] (Aidat işletilmeyecek daireler - ör: kapıcı dairesi, yönetim ofisi)

### 2. Idempotency Registry (`duesRuns`)
Ledger üzerinde pahalı sorgular yapmamak ve race-condition yaşamamak için, aidatın işlendiğini takip eden hafif kayıtlar.
- Path: `managements/{mgmtId}/duesRuns/{yearMonth}/units/{unitId}`
- Örnek `yearMonth`: "2026-02"
- Alanlar:
  - `status`: "created"
  - `ledgerEntryId`: string (Oluşan ledger kaydının ID'si)
  - `createdAt`: serverTimestamp
  - `feeMinor`: number (O günkü aidat tutarı)

### 3. Ledger Entry Şeması
Motor tarafından oluşturulan kayıtlar.
- `type`: "DEBIT"
- `amountMinor`: `settings.monthlyFeeMinor`
- `source`: "dues"
- `status`: "posted"
- `description`: "Şubat 2026 Aidat Tahakkuku"
- `metadata`:
  - `kind`: "DUES"
  - `yearMonth`: "2026-02"

## Operasyonel Akış

### A. Scheduled (Otomatik)
- **Zamanlama:** Her ayın 1'i, 00:10 (Europe/London).
- **Mantık:**
  1. Tüm management'ları tara.
  2. `settings/dues` enabled olanları al.
  3. İlgili ayın (örn "2026-02") aidatını her daire çin işle.

### B. Manual / Backfill (Callable)
- Admin panelden tetiklenir: `runMonthlyDues({ mgmtId, yearMonth, dryRun })`.
- `dryRun: true` ise sadece simülasyon yapar ("10 daire borçlandırılacak, 1 muaf" gibi).
- Geçmiş aylar için veya otomatik çalışmanın başarısız olduğu durumlar için kullanılır.

## Idempotency ve Transaction Mantığı
Her bir daire (unit) için işlem **ayrı bir transaction** içinde yapılır (veya batch loop):

1. **Read:** `duesRuns/{yearMonth}/units/{unitId}` var mı?
   - Varsa: `SKIP` (Zaten işlenmiş).
   - Yoksa: `CONTINUE`.
2. **Read:** Unit `exemptUnitIds` listesinde mi?
   - Evetse: `SKIP`.
3. **Write (Transaction):**
   - Ledger Entry Create (`posted`, `source=dues`)
   - DuesRun Registry Create (`status=created`)
4. **Log:** İşlem başarılıysa `auditLog` yaz (`DUES_GENERATED`).

## Hata Yönetimi ve Alert
- Eğer bir dairenin işlemi başarısız olursa, motor durmaz; diğer dairelere geçer.
- Başarısızlık durumunda `DUES_RUN_FAILED` tipinde alert oluşturulur.

## Security (Firestore Rules)
- `settings/dues`: Admin/Owner read/write. Resident read (opsiyonel, şeffaflık için).
- `duesRuns`: Client erişimine (read/write) **tamamen kapalı**. Sadece Admin SDK (Functions) okuyup yazabilir.
