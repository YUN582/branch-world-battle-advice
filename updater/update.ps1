# ============================================================
# Ccofolia Extension — 수동 업데이트 (git pull)
# ============================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Extension root = one level above updater/ folder
$extensionRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host ''
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host '  Ccofolia Extension 업데이트'              -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '최신 버전을 GitHub에서 가져옵니다...'
Write-Host ''

Push-Location $extensionRoot
try {
    & git pull origin master 2>&1 | ForEach-Object { Write-Host $_ }
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

Write-Host ''

if ($exitCode -eq 0) {
    Write-Host '[완료] 업데이트가 완료되었습니다!' -ForegroundColor Green
    Write-Host ''
    Write-Host '크롬 주소창에 chrome://extensions 을 입력한 후'
    Write-Host '이 확장 프로그램의 새로고침 버튼을 눌러주세요.'
} else {
    Write-Host '[오류] 업데이트에 실패했습니다.' -ForegroundColor Red
    Write-Host '  인터넷 연결을 확인하거나, 로컬에 변경된 파일이 있는지 확인해주세요.'
}

Write-Host ''
Read-Host '아무 키나 누르세요'
