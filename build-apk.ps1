# Galata Aidat Takip - APK Build Script

Write-Host "=== APK Build Başlatılıyor ===" -ForegroundColor Green

# 1. Vite build
Write-Host "`n[1/4] Vite build yapılıyor..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Vite build hatası!" -ForegroundColor Red
    exit 1
}

# 2. Dist klasörünü kontrol et
if (-not (Test-Path "dist")) {
    Write-Host "dist klasörü bulunamadı!" -ForegroundColor Red
    exit 1
}

# 3. Android assets klasörüne kopyala
Write-Host "`n[2/4] Dosyalar Android'e kopyalanıyor..." -ForegroundColor Yellow
$targetPath = "android\app\src\main\assets\public"
if (Test-Path $targetPath) {
    Remove-Item -Recurse -Force "$targetPath\*"
}
Copy-Item -Recurse -Force "dist\*" $targetPath
Write-Host "Kopyalama tamamlandı!" -ForegroundColor Green

# 4. Gradle build
Write-Host "`n[3/4] Gradle build yapılıyor..." -ForegroundColor Yellow
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
Set-Location android
.\gradlew.bat assembleDebug
$buildResult = $LASTEXITCODE
Set-Location ..

if ($buildResult -ne 0) {
    Write-Host "Gradle build hatası!" -ForegroundColor Red
    exit 1
}

# 5. APK konumunu göster
Write-Host "`n[4/4] Build tamamlandı!" -ForegroundColor Green
$apkPath = "android\app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apkPath) {
    Write-Host "`nAPK Konumu: $((Get-Item $apkPath).FullName)" -ForegroundColor Cyan
    $size = [math]::Round((Get-Item $apkPath).Length / 1MB, 2)
    Write-Host "APK Boyutu: $size MB" -ForegroundColor Cyan
} else {
    Write-Host "APK bulunamadı!" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== Build Başarılı ===" -ForegroundColor Green
