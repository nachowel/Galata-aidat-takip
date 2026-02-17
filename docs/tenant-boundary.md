# Tenant Boundary

## Amaç ve kapsam
Bu doküman tenant izolasyonu için bağlayıcı kural setidir. Tenant verisi yalnızca `managements/{mgmtId}` altında tutulur. Bu kuralların ihlali güvenlik açığıdır ve PR reddedilir.

## Allowed paths
- `users/{uid}`
- `managements/{mgmtId}`
- `managements/{mgmtId}/units/{unitId}`
- `managements/{mgmtId}/residents/{residentId}`
- `managements/{mgmtId}/ledger/{entryId}`
- `managements/{mgmtId}/unitBalances/{unitId}`
- `managements/{mgmtId}/alerts/{alertId}`
- `managements/{mgmtId}/invites/{inviteId}`

## Forbidden patterns
- Tenant verisini root koleksiyonda tutmak.
  - Örnek: `units/{unitId}`, `ledger/{entryId}`, `invites/{inviteId}`
- `managementId` filtresi olmadan tenant verisi sorgulamak.
  - Örnek: `collectionGroup("units")` ve tenant sınırı olmayan query
- `users/{uid}` altında domain/business veri tutmak.
  - Örnek: bakiye, aidat geçmişi, ledger hareketleri
- Tenant verisini UID bazlı global path ile modellemek.
  - Örnek: `users/{uid}/ledger/{entryId}`

## Global koleksiyonlar: sadece users/{uid}
Global koleksiyon olarak yalnızca `users/{uid}` kullanılabilir. `users` bir kimlik kartıdır; sadece kimlik ve yetki referansı içerir (`role`, `managementId`, `unitId`, `status`). Tenant domain verisi `users` altında tutulamaz.

## Kod review checklist
- Bu PR yeni veri path’i ekliyorsa path `managements/{mgmtId}/...` altında mı?
- Root seviyede yeni koleksiyon açılmış mı?
- Query’ler tenant sınırını açıkça koruyor mu?
- `users/{uid}` içine domain veri yazılıyor mu?
- Rules değişikliği tenant izolasyonunu zayıflatıyor mu?
- Service katmanında tenant parametresi zorunlu mu?
- Test/örnek kodda forbidden pattern kullanımı var mı?
