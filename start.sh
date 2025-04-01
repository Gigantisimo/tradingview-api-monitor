#!/bin/bash

echo "TradingView Signals Monitor - Запуск"
echo "================================"
echo

echo "Запуск сервера..."
echo
echo "Веб-интерфейс будет доступен по адресу http://localhost:3000"
echo "Нажмите Ctrl+C для остановки сервера."
echo

# Открыть браузер (если в графическом режиме)
if [ -n "$DISPLAY" ]; then
    xdg-open http://localhost:3000 &>/dev/null &
fi

# Запуск сервера
node server.js 