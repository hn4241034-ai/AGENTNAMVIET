@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set GIT_CMD="%~dp0.tools\git\cmd\git.exe"

if not exist %GIT_CMD% (
    echo [LỖI] Không tìm thấy Git trong thư mục .tools\git.
    pause
    exit /b 1
)

echo =====================================================================
echo   CÔNG CỤ ĐẨY DỰ ÁN NAM VIỆT AI AGENT LÊN GITHUB & GITHUB PAGES
echo =====================================================================
echo.

if "%~1"=="" (
    set /p REPO_URL="Nhập URL repository GitHub của bạn (ví dụ: https://github.com/user/repo.git): "
) else (
    set REPO_URL=%~1
)

if "%REPO_URL%"=="" (
    echo Không có URL nào được nhập. Đã hủy.
    pause
    exit /b 1
)

echo.
echo [*] Đang cấu hình remote origin: %REPO_URL% ...
%GIT_CMD% remote remove origin 2>nul
%GIT_CMD% remote add origin %REPO_URL%
%GIT_CMD% branch -M main

echo [*] Đang chuẩn bị và đẩy mã nguồn lên branch 'main'...
%GIT_CMD% push -u origin main

if %ERRORLEVEL% equ 0 (
    echo.
    echo =====================================================================
    echo [THÀNH CÔNG] Đã đẩy toàn bộ dự án lên GitHub!
    echo.
    echo Hướng dẫn kích hoạt GitHub Pages:
    echo 1. Truy cập repo trên GitHub: Settings -^> Pages
    echo 2. Ở mục "Build and deployment", chọn Source là "GitHub Actions" 
    echo    (Dự án đã có sẵn file .github/workflows/pages.yml tự động build và deploy).
    echo 3. Hoặc chọn "Deploy from a branch" -^> Branch: main, Folder: / (root).
    echo =====================================================================
) else (
    echo.
    echo [CẢNH BÁO] Nếu GitHub yêu cầu đăng nhập, hãy đăng nhập qua trình duyệt hoặc nhập Personal Access Token.
    echo Nếu repo trên GitHub đã có sẵn README hoặc commit trước đó, bạn có thể chạy:
    echo   %GIT_CMD% push -u origin main --force
)

echo.
pause

