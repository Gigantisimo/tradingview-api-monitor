#!/bin/bash

echo "TradingView Signals Monitor - Установка службы"
echo "============================================="
echo

# Проверка прав суперпользователя
if [ "$(id -u)" != "0" ]; then
   echo "ОШИБКА: Этот скрипт должен запускаться с правами суперпользователя!"
   echo "Пожалуйста, используйте: sudo $0"
   exit 1
fi

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

# Получаем текущий путь
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Установка зависимостей
echo "Установка зависимостей..."
cd "$SCRIPT_DIR"
npm install
if [ $? -ne 0 ]; then
    echo "ОШИБКА: Не удалось установить зависимости!"
    exit 1
fi

echo "Зависимости успешно установлены."
echo

# Создаем папку для логов
if [ ! -d "$SCRIPT_DIR/logs" ]; then
    mkdir -p "$SCRIPT_DIR/logs"
fi

# Установка прав на запуск
chmod +x "$SCRIPT_DIR/server.js"

# Создание systemd сервиса
echo "Создание systemd сервиса..."

# Определяем текущего пользователя
if [ -z "$SUDO_USER" ]; then
    CURRENT_USER="$USER"
else
    CURRENT_USER="$SUDO_USER"
fi

# Создаем файл сервиса
cat > /etc/systemd/system/tvmonitor.service << EOF
[Unit]
Description=TradingView Signals Monitor
After=network.target

[Service]
ExecStart=$(which node) $SCRIPT_DIR/server.js
WorkingDirectory=$SCRIPT_DIR
Restart=always
User=$CURRENT_USER
Group=$CURRENT_USER
Environment=NODE_ENV=production
StandardOutput=append:$SCRIPT_DIR/logs/service.log
StandardError=append:$SCRIPT_DIR/logs/error.log

[Install]
WantedBy=multi-user.target
EOF

# Перезагрузка systemd, активация и запуск сервиса
echo "Активация и запуск сервиса..."
systemctl daemon-reload
systemctl enable tvmonitor
systemctl start tvmonitor

# Проверка статуса
sleep 2
SERVICE_STATUS=$(systemctl is-active tvmonitor)
if [ "$SERVICE_STATUS" != "active" ]; then
    echo "ОШИБКА: Не удалось запустить службу!"
    echo "Проверьте статус: systemctl status tvmonitor"
    exit 1
fi

echo
echo "Служба tvmonitor успешно установлена и запущена!"
echo "Веб-интерфейс доступен по адресу http://localhost:3000"
echo
echo "Служба будет автоматически запускаться при загрузке системы."
echo "Логи сохраняются в директории: $SCRIPT_DIR/logs/"
echo
echo "Полезные команды:"
echo "  Просмотр статуса: sudo systemctl status tvmonitor"
echo "  Остановка службы: sudo systemctl stop tvmonitor"
echo "  Запуск службы: sudo systemctl start tvmonitor"
echo "  Просмотр логов: sudo journalctl -u tvmonitor"
echo "  Удаление службы: sudo systemctl disable tvmonitor && sudo rm /etc/systemd/system/tvmonitor.service"
echo 