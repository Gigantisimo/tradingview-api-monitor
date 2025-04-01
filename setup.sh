#!/bin/bash

echo "TradingView Signals Monitor - Установка и запуск"
echo "============================================="
echo

# Проверка Node.js
if ! command -v node &> /dev/null; then
    echo "ОШИБКА: Node.js не установлен!"
    echo "Пожалуйста, установите Node.js (версия 14+)"
    echo "Debian/Ubuntu: sudo apt install nodejs npm"
    echo "CentOS/RHEL: sudo yum install nodejs npm"
    echo "или используйте Node Version Manager (nvm)"
    exit 1
fi

echo "Node.js найден: $(node --version)"
echo

# Установка зависимостей
echo "Установка зависимостей..."
npm install
if [ $? -ne 0 ]; then
    echo "ОШИБКА: Не удалось установить зависимости!"
    exit 1
fi

echo "Зависимости успешно установлены."
echo

# Установка прав на запуск
chmod +x server.js

# Запуск сервера
echo "Запуск сервера..."
echo
echo "Веб-интерфейс будет доступен по адресу http://localhost:3000"
echo
echo "Нажмите Ctrl+C для остановки сервера."
echo

npm start 