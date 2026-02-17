# Ledger Migration Plan

## Hedef
Mevcut finansal hareket modelini immutable, minor-unit (`amount` integer kuruş/pence) ledger modeline geçirmek. Veri kaybı kabul edilmez.

## Faz 1: Hazırlık ve Dual-Write
- Yeni koleksiyon şeması açılır: `managements/{mgmtId}/ledger/{entryId}`.
- Yeni yazılan hareketler hem eski modele hem yeni ledger’a yazılır (dual-write).
- Eski modelden yeni modele dönüştürme mapper’ı eklenir:
  - `amount` decimal -> integer minor-unit dönüşümü (`round` değil, kontrollü normalize).
  - `type/source/status` mapping.
- Gözlem metrikleri:
  - dual-write başarı oranı
  - mapper hata oranı
  - tenant bazında entry sayısı farkı

Çıkış kriteri:
- Yeni hareketlerin %100’ü ledger’da var.
- Mapping hatası kritik seviyede değil (hedef: %0).

## Faz 2: Backfill + Doğrulama
- Eski veriler tenant tenant ledger’a backfill edilir.
- Backfill idempotent çalışır:
  - deterministic `entryId` veya `legacyRef` ile tekrar koşumda duplikasyon olmaz.
- Doğrulama:
  - tenant bazında toplam credit/debit karşılaştırması
  - unit bazında net bakiye karşılaştırması
  - örneklem audit (manuel kontrol)
- Fark çıkan kayıtlar `migration_issues` listesine alınır; otomatik düzeltme/manuel karar uygulanır.

Çıkış kriteri:
- Backfill tamamlandı.
- Kritik fark yok; farklar açıklanmış ve kapatılmış.

## Faz 3: Read Switch + Legacy Freeze
- Okuma akışı tamamen yeni ledger’a alınır.
- Eski finansal koleksiyonlara yazma kapatılır (freeze).
- Raporlar ve dashboard sadece ledger’dan beslenir.
- Sonrasında legacy yalnızca arşiv olarak tutulur (silinmez).

Çıkış kriteri:
- Prod okuma/yazma akışında legacy bağımlılığı kalmaz.
- En az 1 kapanış dönemi boyunca finansal tutarlılık doğrulanır.

## Rollback stratejisi (data kaybı yok)
- Temel ilke: Geri dönüşte sadece trafik yönü değiştirilir, veri silinmez.
- Faz 1/2 rollback:
  - Dual-write açık kalır, read eski modele döndürülür.
  - Ledger verisi korunur; sorun çözülünce tekrar doğrulama ile devam edilir.
- Faz 3 rollback:
  - Read pointer eski modele alınır.
  - Ledger’da yazılan kayıtlar korunur; reconciliation ile fark raporu çıkarılır.
- Yasak:
  - Ledger truncate/silme
  - Geri dönüşte destructive script

## Operasyon notları
- Her faz önce staging, sonra production.
- Her fazda snapshot/backup alınır.
- Her faz için “go/no-go” checklist zorunlu.
