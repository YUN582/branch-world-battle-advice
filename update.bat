@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   가지세계 도우미 업데이트
echo ========================================
echo.
echo 최신 버전을 GitHub에서 가져옵니다...
echo.
git pull origin master
echo.
if %ERRORLEVEL% == 0 (
    echo [완료] 업데이트가 완료되었습니다!
    echo.
    echo 크롬 주소창에 chrome://extensions 을 입력한 후
    echo 이 확장 프로그램의 새로고침 버튼을 눌러주세요.
) else (
    echo [실패] 업데이트에 실패했습니다.
    echo    인터넷 연결을 확인하거나, 폴더에 수정된 파일이 있는지 확인해주세요.
)
echo.
pause
