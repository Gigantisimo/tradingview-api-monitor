@echo off
echo TradingView Signals Monitor - Установка и запуск
echo =============================================
echo.

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

REM Запуск сервера
echo Запуск сервера...
echo.
echo Веб-интерфейс будет доступен по адресу http://localhost:3000
echo.
echo Нажмите Ctrl+C для остановки сервера.
echo.

call npm start 