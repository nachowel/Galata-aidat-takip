# Access Matrix

Bu matris bağlayıcıdır. Firestore rules bu tabloya birebir uymalıdır.

| Resource | owner | admin | resident |
|---|---|---|---|
| Units | R/W | R/W | R (own unit only) |
| Residents | R/W | R/W | R (own unit only) |
| Ledger | R/W (delete yok) | R/W (delete yok) | R (own unit only) |
| UnitBalances | R | R | R (own unit only) |
| Alerts | R | R | - |
| Invites | R/W | R/W | - |
| Settings | R/W | R/W | R |

## Kural notları
- `owner`: `managements/{mgmtId}.ownerUid == request.auth.uid`
- `admin`: `users/{uid}.role == 'admin'` ve tenant üyesi
- `resident`: `users/{uid}.role == 'resident'` ve sadece `users/{uid}.unitId` ile eşleşen kayıtlara erişim
- Ledger kaydı silinemez (`delete: false`)
- UnitBalances client write kapalı; sadece Admin SDK (Cloud Function)
- Alerts client write kapalı; sadece Admin SDK (drift check function)

## Emulator testlerinde kırılacak yerler
- Eski path kullanan kodlar (`managements/{mgmtId}/transactions`, `boardMembers`, `files`) bu rules ile reddedilir.
- Client tarafında invite doğrudan okuma/yazma yapan akışlar reddedilir (`invites` sadece admin/owner veya function).
- Resident kullanıcılar artık tenant içindeki tüm `units/residents/ledger` verisini okuyamaz; sadece kendi `unitId` eşleşen kayıtları okur.
