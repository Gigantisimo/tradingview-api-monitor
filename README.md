# TradingView API Монитор Сигналов

Веб-интерфейс для мониторинга и визуализации сигналов TradingView API.

![TradingView API Monitor](https://i.ibb.co/Sm76wZW/tradingview-monitor.png)

## Возможности

- Отслеживание сигналов от TradingView API в реальном времени
- Мониторинг открытых позиций и истории торговли
- Отправка уведомлений в Telegram
- Настройка параметров мониторинга через веб-интерфейс
- Фильтрация и поиск сигналов
- Визуализация статистики и метрик
- Поддержка разных типов сигналов (стратегии, графические элементы, метки)
- Автоматическое открытие и закрытие позиций
- Расчет P&L и статистики торговли

## Установка и запуск

### Windows

1. Установите Node.js с сайта [nodejs.org](https://nodejs.org/)
2. Распакуйте архив с приложением
3. Запустите скрипт **setup.bat** для установки зависимостей и запуска сервера
   - или **start.bat** если зависимости уже установлены
   - или **install-service.bat** для установки в качестве системной службы (требуются права администратора)

### Linux

1. Установите Node.js:
   ```bash
   sudo apt install nodejs npm   # Для Debian/Ubuntu
   sudo yum install nodejs npm   # Для CentOS/RHEL
   ```
2. Распакуйте архив с приложением
3. Запустите скрипт установки и запуска:
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```
   - или **start.sh** если зависимости уже установлены
   - или **install-service.sh** для установки в качестве системной службы (требуются права sudo)

После запуска откройте в браузере адрес **http://localhost:3000**

## Структура проекта

- **index.html** - Основной HTML-файл веб-интерфейса
- **styles.css** - CSS-стили для веб-интерфейса
- **script.js** - Клиентская логика на JavaScript
- **server.js** - Серверная часть на Node.js
- **package.json** - Описание проекта и зависимости
- **setup.bat/sh** - Скрипт установки зависимостей и запуска
- **start.bat/sh** - Скрипт быстрого запуска
- **install-service.bat/sh** - Скрипт установки в качестве системной службы
- **ИНСТРУКЦИЯ.md** - Подробная инструкция на русском языке
- **README.md** - Описание проекта (этот файл)

## Настройка

Для работы с TradingView API необходимо указать следующие параметры в настройках:

1. **Session ID** - идентификатор сессии TradingView
2. **Signature** - подпись для аутентификации
3. **ID стратегии** (опционально) - идентификатор стратегии для отслеживания сигналов

Для отправки уведомлений в Telegram:

1. **Bot Token** - токен Telegram-бота
2. **Chat ID** - идентификатор чата для отправки уведомлений

Дополнительные настройки:

- **Рынок** - символ рынка для мониторинга (например, BINANCE:BTCUSDT)
- **Таймфрейм** - период времени для анализа
- **Период охлаждения** - время между обработкой повторных сигналов
- **Свежесть сигнала** - максимальное время устаревания сигнала
- **Интервал проверки** - частота проверки новых сигналов

## Получение параметров TradingView

1. Войдите в свою учетную запись TradingView
2. Откройте DevTools в браузере (F12)
3. Перейдите на вкладку "Network"
4. Найдите запросы к домену tradingview.com
5. В заголовках запроса найдите:
   - `sessionid` - значение cookie для SESSION
   - `signature` - параметр в URL или заголовке

## Создание Telegram-бота

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram
2. Отправьте команду `/newbot`
3. Следуйте инструкциям для создания бота
4. Получите и сохраните токен бота
5. Добавьте бота в группу или начните с ним диалог
6. Для получения Chat ID используйте:
   ```
   https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
   ```

## Техническая информация

Приложение использует:
- Node.js для серверной части
- Express для веб-сервера
- Socket.IO для реального времени
- TradingView WebSocket API для получения данных
- Chart.js для визуализации

## Устранение неисправностей

1. **Ошибка инициализации TradingView API**:
   - Проверьте правильность SESSION и SIGNATURE
   - Возможно, срок действия сессии истек, войдите в TradingView снова

2. **Уведомления не приходят в Telegram**:
   - Проверьте правильность Bot Token и Chat ID
   - Убедитесь, что бот добавлен в чат

3. **Порт 3000 занят**:
   - Измените порт в файле server.js (строка `const PORT = process.env.PORT || 3000;`)

## Лицензия

ISC