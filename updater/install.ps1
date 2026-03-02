# ============================================================
# Ccofolia Extension — 자동 업데이트 설정 (최초 1회)
# Native Messaging Host를 Windows 레지스트리에 등록합니다.
# ============================================================

param([string]$ExtensionId)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostBat     = Join-Path $scriptDir 'ce-update-host.bat'
$manifestPath = Join-Path $scriptDir 'com.ccofolia.extension.updater.json'
$regKey      = 'HKCU:\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.ccofolia.extension.updater'

Write-Host ''
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host '  Ccofolia Extension 자동 업데이트 설정'    -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ''

# ── Extension ID 입력 ───────────────────────────────────────

if (-not $ExtensionId) {
    Write-Host 'Chrome 확장 프로그램 ID를 입력하세요.'
    Write-Host '팝업의 업데이트 모달에서 확인할 수 있습니다.' -ForegroundColor DarkGray
    Write-Host ''
    $ExtensionId = Read-Host 'Extension ID'
}

if (-not $ExtensionId) {
    Write-Host ''
    Write-Host '[오류] ID가 입력되지 않았습니다.' -ForegroundColor Red
    Write-Host ''
    Read-Host '아무 키나 누르세요'
    exit 1
}

# ── NM 매니페스트 생성 ──────────────────────────────────────

$manifest = @{
    name            = 'com.ccofolia.extension.updater'
    description     = 'Ccofolia Extension Auto-Updater'
    path            = $hostBat
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding UTF8
Write-Host "[OK] 매니페스트 생성: $manifestPath" -ForegroundColor Green

# ── 레지스트리 등록 ─────────────────────────────────────────

New-Item -Path $regKey -Force | Out-Null
Set-ItemProperty -Path $regKey -Name '(Default)' -Value $manifestPath
Write-Host '[OK] 레지스트리 등록 완료' -ForegroundColor Green

# ── 완료 ────────────────────────────────────────────────────

Write-Host ''
Write-Host '[완료] 자동 업데이트가 설정되었습니다!' -ForegroundColor Cyan
Write-Host ''
Write-Host "  Extension ID : $ExtensionId"
Write-Host "  Host         : $hostBat"
Write-Host "  Manifest     : $manifestPath"
Write-Host ''
Write-Host '이제 팝업에서 자동 업데이트 버튼을 사용할 수 있습니다.' -ForegroundColor Yellow
Write-Host ''
Read-Host '아무 키나 누르세요'
