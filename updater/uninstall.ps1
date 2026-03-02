# ============================================================
# Ccofolia Extension — 자동 업데이트 제거
# Native Messaging Host 레지스트리 키 및 매니페스트를 삭제합니다.
# ============================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifestPath = Join-Path $scriptDir 'com.ccofolia.extension.updater.json'
$regKey       = 'HKCU:\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.ccofolia.extension.updater'

Write-Host ''
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host '  Ccofolia Extension 자동 업데이트 제거'    -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ''

if (Test-Path $regKey) {
    Remove-Item -Path $regKey -Force
    Write-Host '[OK] 레지스트리 키 제거됨' -ForegroundColor Green
} else {
    Write-Host '[SKIP] 레지스트리 키 없음' -ForegroundColor DarkGray
}

if (Test-Path $manifestPath) {
    Remove-Item -Path $manifestPath -Force
    Write-Host '[OK] 매니페스트 파일 제거됨' -ForegroundColor Green
} else {
    Write-Host '[SKIP] 매니페스트 파일 없음' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '[완료] 자동 업데이트 설정이 제거되었습니다.' -ForegroundColor Cyan
Write-Host ''
Read-Host '아무 키나 누르세요'
