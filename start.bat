@echo off
echo TradingView Signals Monitor - Запуск
echo ================================
echo.

echo Запуск сервера...
echo.
echo Веб-интерфейс будет доступен по адресу http://localhost:3000
echo Нажмите Ctrl+C для остановки сервера.
echo.

start http://localhost:3000
node server.js 