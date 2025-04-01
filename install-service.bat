@echo off
echo TradingView Signals Monitor - Установка службы
echo =============================================
echo.

REM Проверка прав администратора
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ОШИБКА: Этот скрипт должен запускаться с правами администратора!
    echo Пожалуйста, нажмите правой кнопкой мыши на этот файл и выберите
    echo "Запустить от имени администратора".
    pause
    exit /b 1
)

REM Проверка Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ОШИБКА: Node.js не установлен!
    echo Пожалуйста, установите Node.js с сайта https://nodejs.org/
    echo и перезапустите этот скрипт.
    pause
    exit /b 1
)

echo Node.js найден.
echo.

REM Установка зависимостей
echo Установка зависимостей...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ОШИБКА: Не удалось установить зависимости!
    pause
    exit /b 1
)

echo Зависимости успешно установлены.
echo.

REM Установка nssm (Non-Sucking Service Manager)
if not exist "%~dp0nssm.exe" (
    echo Загрузка nssm (Non-Sucking Service Manager)...
    powershell -Command "Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile '%TEMP%\nssm.zip'"
    powershell -Command "Expand-Archive -Path '%TEMP%\nssm.zip' -DestinationPath '%TEMP%\nssm'"
    copy "%TEMP%\nssm\nssm-2.24\win64\nssm.exe" "%~dp0nssm.exe"
    rd /s /q "%TEMP%\nssm"
    del "%TEMP%\nssm.zip"
)

REM Проверка установки nssm
if not exist "%~dp0nssm.exe" (
    echo ОШИБКА: Не удалось установить nssm!
    pause
    exit /b 1
)

echo nssm успешно установлен.
echo.

REM Установка службы
echo Установка службы TradingViewMonitor...
"%~dp0nssm.exe" install TradingViewMonitor "%~dp0node.exe" "%~dp0server.js"
"%~dp0nssm.exe" set TradingViewMonitor Description "TradingView Signals Monitor - веб-интерфейс для мониторинга сигналов TradingView API"
"%~dp0nssm.exe" set TradingViewMonitor DisplayName "TradingView Signals Monitor"
"%~dp0nssm.exe" set TradingViewMonitor AppDirectory "%~dp0"
"%~dp0nssm.exe" set TradingViewMonitor AppStdout "%~dp0logs\service.log"
"%~dp0nssm.exe" set TradingViewMonitor AppStderr "%~dp0logs\error.log"
"%~dp0nssm.exe" set TradingViewMonitor Start SERVICE_AUTO_START

REM Создаем папку для логов
if not exist "%~dp0logs" mkdir "%~dp0logs"

REM Запуск службы
echo Запуск службы TradingViewMonitor...
net start TradingViewMonitor

if %ERRORLEVEL% neq 0 (
    echo ОШИБКА: Не удалось запустить службу!
    pause
    exit /b 1
)

echo.
echo Служба TradingViewMonitor успешно установлена и запущена!
echo Веб-интерфейс доступен по адресу http://localhost:3000
echo.
echo Служба будет автоматически запускаться при загрузке Windows.
echo Для управления службой используйте стандартную утилиту "Службы" Windows.
echo.
echo Для остановки: net stop TradingViewMonitor
echo Для запуска: net start TradingViewMonitor
echo Для удаления: sc delete TradingViewMonitor
echo.

pause 