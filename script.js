// Конфигурация и состояние приложения
const config = {
    tradingViewApi: {
        session: localStorage.getItem('tv_session') || '',
        signature: localStorage.getItem('tv_signature') || '',
        strategyId: localStorage.getItem('tv_strategy_id') || '',
    },
    telegram: {
        botToken: localStorage.getItem('telegram_token') || '',
        chatId: localStorage.getItem('telegram_chat_id') || '',
        sendNotifications: localStorage.getItem('send_notifications') !== 'false',
    },
    monitoring: {
        market: localStorage.getItem('market') || 'BINANCE:BTCUSDT',
        timeframe: localStorage.getItem('timeframe') || '15',
        cooldownPeriod: parseInt(localStorage.getItem('cooldown_period') || '0'),
        signalFreshness: parseInt(localStorage.getItem('signal_freshness') || '60000'),
        checkInterval: parseInt(localStorage.getItem('check_interval') || '15000'),
    }
};

const state = {
    signals: [],
    positions: {
        current: {},
        history: []
    },
    trades: [],  // Добавляем массив для хранения всех сделок
    statistics: {
        signalsToday: 0,
        activePositions: 0,
        notificationsSent: 0,
        startTime: new Date(),
        cumulativeProfitLoss: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        maxDrawdown: 0,
        maxGrowth: 0
    },
    pagination: {
        currentPage: 1,
        itemsPerPage: 10,
        totalPages: 1
    },
    filters: {
        symbol: 'all',
        signalType: 'all',
        date: ''
    },
    socket: null,
    connectionStatus: 'disconnected',
};

// Вспомогательные функции
function getTimeInPosition(startTime, endTime) {
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date();
    
    const timeDiff = end - start;
    
    const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) {
        return `${days}д ${hours}ч ${minutes}м`;
    } else if (hours > 0) {
        return `${hours}ч ${minutes}м`;
    } else {
        return `${minutes}м`;
    }
}

function getSignalTypeText(type) {
    switch (type) {
        case 'BUY': return 'ПОКУПКА';
        case 'SELL': return 'ПРОДАЖА';
        case 'CLOSE': return 'ЗАКРЫТИЕ';
        default: return type;
    }
}

function getSignalStatusText(status) {
    switch (status) {
        case 'success': return 'УСПЕХ';
        case 'pending': return 'ОЖИДАНИЕ';
        case 'ignored': return 'ИГНОРИРОВАН';
        default: return status;
    }
}

// Функции обновления интерфейса
function updateDashboard() {
    document.getElementById('signals-count').textContent = state.statistics.signalsToday;
    document.getElementById('positions-count').textContent = state.statistics.activePositions;
    document.getElementById('notifications-count').textContent = state.statistics.notificationsSent;
    
    updateRecentSignalsTable();
    updateActivePositionsPanel();
    updateStatisticsChart();
}

function updateSignalsTable() {
    const tbody = document.getElementById('signals-table-body');
    
    // Получаем отфильтрованные сигналы
    const filteredSignals = filterSignals();
    
    // Обновляем пагинацию
    updatePagination(filteredSignals.length);
    
    // Получаем сигналы для текущей страницы
    const startIndex = (state.pagination.currentPage - 1) * state.pagination.itemsPerPage;
    const endIndex = startIndex + state.pagination.itemsPerPage;
    const signalsToShow = filteredSignals.slice(startIndex, endIndex);
    
    tbody.innerHTML = '';
    
    if (signalsToShow.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="8" class="no-data-message">Нет сигналов</td>`;
        tbody.appendChild(tr);
        return;
    }
    
    signalsToShow.forEach((signal, index) => {
        const tr = document.createElement('tr');
        
        // Форматируем время
        const time = new Date(signal.time).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        // Определяем класс для типа сигнала
        let typeClass = '';
        if (signal.type === 'BUY') typeClass = 'type-buy';
        else if (signal.type === 'SELL') typeClass = 'type-sell';
        else if (signal.type === 'CLOSE') typeClass = 'type-close';
        
        // Определяем класс для статуса
        let statusClass = '';
        if (signal.status === 'success') statusClass = 'status-success';
        else if (signal.status === 'pending') statusClass = 'status-pending';
        else if (signal.status === 'ignored') statusClass = 'status-ignored';
        
        tr.innerHTML = `
            <td>${signal.id || startIndex + index + 1}</td>
            <td>${time}</td>
            <td>${signal.symbol}</td>
            <td><span class="signal-type ${typeClass}">${getSignalTypeText(signal.type)}</span></td>
            <td>${signal.price}</td>
            <td>${signal.source || 'Стратегия'}</td>
            <td><span class="signal-status ${statusClass}">${getSignalStatusText(signal.status)}</span></td>
            <td>
                <button class="action-btn view-btn" data-signal-id="${signal.id || index}" title="Просмотреть детали">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="action-btn delete-btn" data-signal-id="${signal.id || index}" title="Удалить">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
}

function updatePositionsTable() {
    updateCurrentPositionsTable();
    updatePositionsHistoryTable();
    loadFormattedTrades();
}

function updateCurrentPositionsTable() {
    const tbody = document.getElementById('current-positions-body');
    const positions = Object.values(state.positions.current);
    
    tbody.innerHTML = '';
    
    if (positions.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="8" class="no-data-message">Нет активных позиций</td>`;
        tbody.appendChild(tr);
        return;
    }
    
    positions.forEach(position => {
        const tr = document.createElement('tr');
        
        // Используем форматированное время или форматируем вручную
        const openTime = position.openTimeFormatted || (position.openTime ? new Date(position.openTime).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }) : 'N/A');
        
        // Рассчитываем время в позиции
        const timeInPosition = position.openTime ? getTimeInPosition(position.openTime) : 'N/A';
        
        // Определяем класс для типа позиции
        const typeClass = position.type === 'LONG' ? 'type-buy' : 'type-sell';
        
        // Рассчитываем P&L (если есть текущая цена)
        let pnl = 'N/A';
        if (position.currentPrice && position.openPrice && !isNaN(position.currentPrice) && !isNaN(position.openPrice) && position.openPrice > 0) {
            if (position.type === 'LONG') {
                pnl = ((position.currentPrice - position.openPrice) / position.openPrice * 100).toFixed(2) + '%';
            } else {
                pnl = ((position.openPrice - position.currentPrice) / position.openPrice * 100).toFixed(2) + '%';
            }
        }
        
        tr.innerHTML = `
            <td>${position.symbol || 'N/A'}</td>
            <td><span class="signal-type ${typeClass}">${position.type === 'LONG' ? 'ЛОНГ' : 'ШОРТ'}</span></td>
            <td>${openTime}</td>
            <td>${position.openPrice || 'N/A'}</td>
            <td>${position.currentPrice || 'N/A'}</td>
            <td>${pnl}</td>
            <td>${timeInPosition}</td>
            <td>
                <button class="action-btn view-btn" data-position-symbol="${position.symbol}" title="Просмотреть детали">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="action-btn delete-btn" data-position-symbol="${position.symbol}" title="Закрыть позицию">
                    <i class="fas fa-times-circle"></i>
                </button>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
}

function updatePositionsHistoryTable() {
    const tbody = document.getElementById('positions-history-body');
    
    tbody.innerHTML = '';
    
    if (state.positions.history.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="8" class="no-data-message">Нет истории позиций</td>`;
        tbody.appendChild(tr);
        return;
    }
    
    state.positions.history.forEach(position => {
        const tr = document.createElement('tr');
        
        // Используем форматированное время или форматируем вручную, если его нет
        const openTime = position.openTimeFormatted || (position.openTime ? new Date(position.openTime).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }) : 'N/A');
        
        const closeTime = position.closeTimeFormatted || (position.closeTime ? new Date(position.closeTime).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }) : 'N/A');
        
        // Определяем класс для типа позиции
        const typeClass = position.type === 'LONG' ? 'type-buy' : 'type-sell';
        
        // Используем готовый pnlDisplay или вычисляем, если его нет
        const pnl = position.pnlDisplay || (position.pnlPercent !== undefined ? position.pnlPercent.toFixed(2) + '%' : 'N/A');
        
        // Используем форматированное время в позиции или значение по умолчанию
        const timeInPosition = position.timeInPositionDisplay || 'N/A';
        
        tr.innerHTML = `
            <td>${position.symbol || 'N/A'}</td>
            <td><span class="signal-type ${typeClass}">${position.type === 'LONG' ? 'ЛОНГ' : 'ШОРТ'}</span></td>
            <td>${openTime}</td>
            <td>${closeTime}</td>
            <td>${position.openPrice || 'N/A'}</td>
            <td>${position.closePrice || 'N/A'}</td>
            <td>${pnl}</td>
            <td>${timeInPosition}</td>
        `;
        
        tbody.appendChild(tr);
    });
}

function updateStatisticsChart() {
    // Получаем контекст для графика
    const ctx = document.getElementById('signals-chart');
    
    // Если график уже существует, уничтожаем его
    if (window.signalsChart) {
        window.signalsChart.destroy();
    }
    
    // Создаем данные для графика
    const today = new Date().toDateString();
    const buySignals = state.signals.filter(signal => 
        signal.type === 'BUY' && new Date(signal.time).toDateString() === today
    ).length;
    
    const sellSignals = state.signals.filter(signal => 
        signal.type === 'SELL' && new Date(signal.time).toDateString() === today
    ).length;
    
    const closeSignals = state.signals.filter(signal => 
        signal.type === 'CLOSE' && new Date(signal.time).toDateString() === today
    ).length;
    
    // Создаем график
    window.signalsChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['Покупка', 'Продажа', 'Закрытие'],
            datasets: [{
                label: 'Сигналы сегодня',
                data: [buySignals, sellSignals, closeSignals],
                backgroundColor: [
                    'rgba(38, 166, 154, 0.7)',
                    'rgba(239, 83, 80, 0.7)',
                    'rgba(126, 126, 126, 0.7)'
                ],
                borderColor: [
                    'rgba(38, 166, 154, 1)',
                    'rgba(239, 83, 80, 1)',
                    'rgba(126, 126, 126, 1)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

// Инициализация веб-приложения
(function() {
    // При загрузке страницы
    document.addEventListener('DOMContentLoaded', function() {
        // Инициализация навигации
        initNavigation();
        
        // Инициализация сокет-соединения
        initSocketConnection();
        
        // Инициализация обработчиков событий на странице настроек
        initSettingsForm();
        
        // Инициализация обработчиков событий на странице сигналов
        initFilters();
        
        // Инициализация обработчиков событий модальных окон
        initModalHandlers();
        
        // Инициализация вкладок на странице анализа сделок
        setupTradesTabs();
        
        // Загружаем демо-данные для тестирования
        loadDemoTrades();
        
        // Инициализация пагинации
        initPagination();
        
        // Обновляем интерфейс
        updateDashboard();
        updateSignalsTable();
        updatePositionsTable();
        
        // Обновление времени работы
        updateUptime();
        
        // Обновление времени работы каждую минуту
        setInterval(updateUptime, 60000);
    });

    // ... existing code ...
})();

// Функции навигации
function initNavigation() {
    const navLinks = document.querySelectorAll('.nav-links a');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Удаляем активный класс со всех ссылок
            navLinks.forEach(l => l.classList.remove('active'));
            
            // Добавляем активный класс на текущую ссылку
            link.classList.add('active');
            
            // Скрываем все страницы
            document.querySelectorAll('.page').forEach(page => {
                page.classList.remove('active');
            });
            
            // Показываем нужную страницу
            const targetPage = link.getAttribute('data-page');
            document.getElementById(targetPage).classList.add('active');
        });
    });
}

// Функции для работы с сокетом
function initSocketConnection() {
    // Проверяем, есть ли необходимые параметры для соединения
    if (!config.tradingViewApi.session || !config.tradingViewApi.signature) {
        updateConnectionStatus('disconnected');
        document.getElementById('connection-text').textContent = 'Не настроено';
        return;
    }
    
    try {
        // Закрываем предыдущее соединение, если оно существует
        if (state.socket) {
            state.socket.disconnect();
            state.socket = null;
        }

        // Подключаемся к серверу с новыми настройками
        state.socket = io('http://localhost:3000', {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
            timeout: 20000,
            query: {
                session: config.tradingViewApi.session,
                signature: config.tradingViewApi.signature,
                strategyId: config.tradingViewApi.strategyId,
                market: config.monitoring.market,
                timeframe: config.monitoring.timeframe,
                cooldownPeriod: config.monitoring.cooldownPeriod,
                signalFreshness: config.monitoring.signalFreshness,
                checkInterval: config.monitoring.checkInterval,
                telegramToken: config.telegram.botToken,
                telegramChatId: config.telegram.chatId,
                sendNotifications: config.telegram.sendNotifications
            }
        });
        
        // Обработка событий сокета
        state.socket.on('connect', () => {
            console.log('Соединение установлено');
            updateConnectionStatus('connected');
        });
        
        state.socket.on('disconnect', (reason) => {
            console.log('Соединение разорвано:', reason);
            updateConnectionStatus('disconnected');
        });
        
        state.socket.on('connect_error', (error) => {
            console.error('Ошибка подключения:', error);
            updateConnectionStatus('disconnected');
            showError('Ошибка подключения: ' + error.message);
        });
        
        state.socket.on('error', (error) => {
            console.error('Ошибка сокета:', error);
            showError(error.message || 'Произошла ошибка при работе с сервером');
        });

        // Получение сигналов
        state.socket.on('signal', (signal) => {
            console.log('Получен сигнал:', signal);
            addSignal(signal);
            updateDashboard();
        });
        
        // Получение позиций
        state.socket.on('position', (position) => {
            console.log('Обновление позиции:', position);
            updatePosition(position);
            updateDashboard();
        });
        
        // Получение статистики
        state.socket.on('statistics', (stats) => {
            console.log('Обновление статистики:', stats);
            updateStatistics(stats);
        });
        
        // Начальная загрузка данных
        state.socket.on('initialData', (data) => {
            console.log('Получены начальные данные:', data);
            state.signals = data.signals || [];
            state.positions.current = data.currentPositions || {};
            state.positions.history = data.positionHistory || [];
            state.statistics = data.statistics || state.statistics;
            
            updateDashboard();
            updateSignalsTable();
            updatePositionsTable();
            updateStatisticsChart();
        });

        // Получение истории позиций
        state.socket.on('positionHistory', (history) => {
            console.log('Обновление истории позиций:', history);
            state.positions.history = history;
            updatePositionsHistoryTable();
        });

        // Добавляем обработчик для получения данных о сделках
        state.socket.on('tradesUpdate', trades => {
            state.trades = trades;
            updateTradesAnalysisTable();
        });

        // Обработчик для получения форматированных сделок
        state.socket.on('formattedTrades', (trades) => {
            console.log('Получены форматированные данные о сделках:', trades.length);
            updateFormattedTradesTable(trades);
        });

    } catch (error) {
        console.error('Ошибка инициализации сокета:', error);
        updateConnectionStatus('disconnected');
        showError('Ошибка инициализации подключения: ' + error.message);
    }
}

// Обновление статуса подключения
function updateConnectionStatus(status) {
    state.connectionStatus = status;
    
    const statusIndicator = document.querySelector('.status-indicator');
    const connectionText = document.getElementById('connection-text');
    
    statusIndicator.className = 'status-indicator';
    statusIndicator.classList.add(status);
    
    if (status === 'connected') {
        connectionText.textContent = 'Подключено';
    } else {
        connectionText.textContent = 'Отключено';
    }
}

// Функции для работы с сигналами
function addSignal(signal) {
    // Добавляем новый сигнал в начало массива
    state.signals.unshift(signal);
    
    // Обновляем таблицу сигналов
    updateSignalsTable();
    
    // Обновляем счетчик сигналов за сегодня
    const today = new Date().toDateString();
    const signalDate = new Date(signal.time).toDateString();
    
    if (signalDate === today) {
        state.statistics.signalsToday++;
    }
    
    // Обновляем таблицу последних сигналов на дашборде
    updateRecentSignalsTable();
}

// Функции для работы с позициями
function updatePosition(position) {
    if (position.status === 'open') {
        // Добавляем или обновляем текущую позицию
        state.positions.current[position.symbol] = position;
    } else if (position.status === 'close') {
        // Удаляем из текущих позиций и добавляем в историю
        if (state.positions.current[position.symbol]) {
            const closedPosition = {
                ...state.positions.current[position.symbol],
                closeTime: position.time,
                closePrice: position.price,
                pnl: position.pnl || calculatePnL(state.positions.current[position.symbol], position)
            };
            
            state.positions.history.unshift(closedPosition);
            delete state.positions.current[position.symbol];
        }
    }
    
    // Обновляем таблицы позиций
    updateCurrentPositionsTable();
    updatePositionsHistoryTable();
    
    // Обновляем счетчик активных позиций
    state.statistics.activePositions = Object.keys(state.positions.current).length;
}

function updateRecentSignalsTable() {
    const tbody = document.getElementById('recent-signals-body');
    const recentSignals = state.signals.slice(0, 5);
    
    tbody.innerHTML = '';
    
    if (recentSignals.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="5" class="no-data-message">Нет сигналов</td>`;
        tbody.appendChild(tr);
        return;
    }
    
    recentSignals.forEach(signal => {
        const tr = document.createElement('tr');
        
        // Форматируем время
        const time = new Date(signal.time).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        // Определяем класс для типа сигнала
        let typeClass = '';
        if (signal.type === 'BUY') typeClass = 'type-buy';
        else if (signal.type === 'SELL') typeClass = 'type-sell';
        else if (signal.type === 'CLOSE') typeClass = 'type-close';
        
        // Определяем класс для статуса
        let statusClass = '';
        if (signal.status === 'success') statusClass = 'status-success';
        else if (signal.status === 'pending') statusClass = 'status-pending';
        else if (signal.status === 'ignored') statusClass = 'status-ignored';
        
        tr.innerHTML = `
            <td>${time}</td>
            <td>${signal.symbol}</td>
            <td><span class="signal-type ${typeClass}">${getSignalTypeText(signal.type)}</span></td>
            <td>${signal.price}</td>
            <td><span class="signal-status ${statusClass}">${getSignalStatusText(signal.status)}</span></td>
        `;
        
        tbody.appendChild(tr);
    });
}

function updateActivePositionsPanel() {
    const container = document.getElementById('active-positions');
    container.innerHTML = '';
    
    const positions = Object.values(state.positions.current);
    
    if (positions.length === 0) {
        container.innerHTML = '<div class="no-data-message">Нет активных позиций</div>';
        return;
    }
    
    positions.forEach(position => {
        const card = document.createElement('div');
        card.className = `position-card ${position.type.toLowerCase()}`;
        
        // Рассчитываем время в позиции
        const timeInPosition = getTimeInPosition(position.time);
        
        // Рассчитываем P&L
        let pnl = 'N/A';
        if (position.currentPrice) {
            if (position.type === 'LONG') {
                pnl = ((position.currentPrice - position.price) / position.price * 100).toFixed(2) + '%';
            } else {
                pnl = ((position.price - position.currentPrice) / position.price * 100).toFixed(2) + '%';
            }
        }
        
        card.innerHTML = `
            <div class="position-type ${position.type.toLowerCase()}">${position.type === 'LONG' ? 'ЛОНГ' : 'ШОРТ'}</div>
            <div class="position-symbol">${position.symbol}</div>
            <div class="position-price">
                <span>Открытие: ${position.price}</span>
                <span>Текущая: ${position.currentPrice || 'N/A'}</span>
            </div>
            <div class="position-pnl">${pnl}</div>
            <div class="position-time">${timeInPosition}</div>
        `;
        
        container.appendChild(card);
    });
}

// Функция для обновления времени работы
function updateUptime() {
    const now = new Date();
    const uptime = now - state.statistics.startTime;
    
    const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
    const hours = Math.floor((uptime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    
    document.getElementById('uptime').textContent = `${days}д ${hours}ч ${minutes}м`;
}

function filterSignals() {
    return state.signals.filter(signal => {
        // Фильтрация по символу
        if (state.filters.symbol !== 'all' && signal.symbol !== state.filters.symbol) {
            return false;
        }
        
        // Фильтрация по типу сигнала
        if (state.filters.signalType !== 'all' && signal.type !== state.filters.signalType) {
            return false;
        }
        
        // Фильтрация по дате
        if (state.filters.date) {
            const signalDate = new Date(signal.time).toISOString().split('T')[0];
            if (signalDate !== state.filters.date) {
                return false;
            }
        }
        
        return true;
    });
}

function updatePagination(totalItems) {
    state.pagination.totalPages = Math.ceil(totalItems / state.pagination.itemsPerPage) || 1;
    
    // Обновляем информацию о страницах
    document.getElementById('page-info').textContent = `Страница ${state.pagination.currentPage} из ${state.pagination.totalPages}`;
    
    // Обновляем состояние кнопок
    document.getElementById('prev-page').disabled = state.pagination.currentPage <= 1;
    document.getElementById('next-page').disabled = state.pagination.currentPage >= state.pagination.totalPages;
}

// Функции для обработки ошибок
function showError(message) {
    // Временно используем alert, можно заменить на более красивое уведомление
    alert(`Ошибка: ${message}`);
}

// Обновление статистики
function updateStatistics(stats) {
    if (!stats) return;
    
    if (stats.signalsToday !== undefined) {
        state.statistics.signalsToday = stats.signalsToday;
    }
    
    if (stats.activePositions !== undefined) {
        state.statistics.activePositions = stats.activePositions;
    }
    
    if (stats.notificationsSent !== undefined) {
        state.statistics.notificationsSent = stats.notificationsSent;
    }
    
    updateDashboard();
}

function deleteSignal(signalId) {
    if (!confirm('Вы уверены, что хотите удалить этот сигнал?')) {
        return;
    }
    
    // Находим индекс сигнала в массиве
    const signalIndex = state.signals.findIndex((s, index) => s.id === signalId || index === parseInt(signalId));
    
    if (signalIndex === -1) {
        showError('Сигнал не найден');
        return;
    }
    
    // Удаляем сигнал из массива
    state.signals.splice(signalIndex, 1);
    
    // Отправляем запрос на сервер, если есть соединение
    if (state.socket && state.connectionStatus === 'connected') {
        state.socket.emit('deleteSignal', { id: signalId });
    }
    
    // Обновляем таблицу
    updateSignalsTable();
}

// Функции для инициализации формы настроек
function initSettingsForm() {
    // Заполняем поля формы значениями из localStorage
    document.getElementById('session-input').value = config.tradingViewApi.session;
    document.getElementById('signature-input').value = config.tradingViewApi.signature;
    document.getElementById('strategy-id-input').value = config.tradingViewApi.strategyId;
    
    document.getElementById('telegram-token-input').value = config.telegram.botToken;
    document.getElementById('telegram-chat-input').value = config.telegram.chatId;
    document.getElementById('send-notifications-checkbox').checked = config.telegram.sendNotifications;
    
    document.getElementById('market-input').value = config.monitoring.market;
    document.getElementById('timeframe-input').value = config.monitoring.timeframe;
    document.getElementById('cooldown-input').value = config.monitoring.cooldownPeriod;
    document.getElementById('freshness-input').value = config.monitoring.signalFreshness;
    document.getElementById('check-interval-input').value = config.monitoring.checkInterval;
    
    // Обработчик сохранения настроек
    document.getElementById('save-settings').addEventListener('click', saveSettings);
    
    // Обработчик для проверки подключения
    document.getElementById('test-connection').addEventListener('click', testConnection);
    
    // Обработчик для перезапуска монитора
    document.getElementById('restart-monitor').addEventListener('click', restartMonitor);
}

function saveSettings() {
    // Сохраняем настройки TradingView API
    config.tradingViewApi.session = document.getElementById('session-input').value;
    config.tradingViewApi.signature = document.getElementById('signature-input').value;
    config.tradingViewApi.strategyId = document.getElementById('strategy-id-input').value;
    
    localStorage.setItem('tv_session', config.tradingViewApi.session);
    localStorage.setItem('tv_signature', config.tradingViewApi.signature);
    localStorage.setItem('tv_strategy_id', config.tradingViewApi.strategyId);
    
    // Сохраняем настройки Telegram
    config.telegram.botToken = document.getElementById('telegram-token-input').value;
    config.telegram.chatId = document.getElementById('telegram-chat-input').value;
    config.telegram.sendNotifications = document.getElementById('send-notifications-checkbox').checked;
    
    localStorage.setItem('telegram_token', config.telegram.botToken);
    localStorage.setItem('telegram_chat_id', config.telegram.chatId);
    localStorage.setItem('send_notifications', config.telegram.sendNotifications);
    
    // Сохраняем настройки мониторинга
    config.monitoring.market = document.getElementById('market-input').value;
    config.monitoring.timeframe = document.getElementById('timeframe-input').value;
    config.monitoring.cooldownPeriod = parseInt(document.getElementById('cooldown-input').value);
    config.monitoring.signalFreshness = parseInt(document.getElementById('freshness-input').value);
    config.monitoring.checkInterval = parseInt(document.getElementById('check-interval-input').value);
    
    localStorage.setItem('market', config.monitoring.market);
    localStorage.setItem('timeframe', config.monitoring.timeframe);
    localStorage.setItem('cooldown_period', config.monitoring.cooldownPeriod);
    localStorage.setItem('signal_freshness', config.monitoring.signalFreshness);
    localStorage.setItem('check_interval', config.monitoring.checkInterval);
    
    alert('Настройки успешно сохранены!');
    
    // Если подключение активно, отправляем новые настройки на сервер
    if (state.socket && state.connectionStatus === 'connected') {
        state.socket.emit('updateSettings', {
            tradingViewApi: config.tradingViewApi,
            telegram: config.telegram,
            monitoring: config.monitoring
        });
    }
}

function testConnection() {
    // Если уже есть активное соединение, отключаемся
    if (state.socket) {
        state.socket.disconnect();
    }
    
    // Инициализируем новое соединение с актуальными настройками
    initSocketConnection();
    
    // Если после инициализации статус не изменился на 'connecting', значит, что-то пошло не так
    if (state.connectionStatus !== 'connected') {
        showError('Не удалось установить соединение. Проверьте настройки и попробуйте снова.');
    }
}

function restartMonitor() {
    if (!confirm('Вы уверены, что хотите перезапустить монитор?')) {
        return;
    }
    
    // Если есть активное соединение, отправляем запрос на перезапуск
    if (state.socket && state.connectionStatus === 'connected') {
        state.socket.emit('restart');
        alert('Запрос на перезапуск отправлен!');
    } else {
        showError('Нет активного соединения с сервером.');
    }
}

// Инициализация фильтров
function initFilters() {
    const symbolFilter = document.getElementById('symbol-filter');
    const signalTypeFilter = document.getElementById('signal-type-filter');
    const dateFilter = document.getElementById('date-filter');
    const resetFiltersButton = document.getElementById('reset-filters');
    
    // Заполняем фильтр символов уникальными значениями из сигналов
    function updateSymbolFilter() {
        const symbols = [...new Set(state.signals.map(signal => signal.symbol))];
        
        // Очищаем фильтр
        const currentValue = symbolFilter.value;
        symbolFilter.innerHTML = '<option value="all">Все</option>';
        
        // Добавляем уникальные символы
        symbols.forEach(symbol => {
            const option = document.createElement('option');
            option.value = symbol;
            option.textContent = symbol;
            symbolFilter.appendChild(option);
        });
        
        // Восстанавливаем выбранное значение, если оно всё ещё в списке
        if (symbols.includes(currentValue)) {
            symbolFilter.value = currentValue;
        }
    }
    
    // Обработчики изменения фильтров
    symbolFilter.addEventListener('change', () => {
        state.filters.symbol = symbolFilter.value;
        updateSignalsTable();
    });
    
    signalTypeFilter.addEventListener('change', () => {
        state.filters.signalType = signalTypeFilter.value;
        updateSignalsTable();
    });
    
    dateFilter.addEventListener('change', () => {
        state.filters.date = dateFilter.value;
        updateSignalsTable();
    });
    
    // Обработчик сброса фильтров
    resetFiltersButton.addEventListener('click', () => {
        symbolFilter.value = 'all';
        signalTypeFilter.value = 'all';
        dateFilter.value = '';
        
        state.filters.symbol = 'all';
        state.filters.signalType = 'all';
        state.filters.date = '';
        
        updateSignalsTable();
    });
    
    // Обновляем фильтр символов при получении новых сигналов
    state.socket.on('signal', () => {
        updateSymbolFilter();
    });
    
    // Обновляем фильтр при инициализации
    updateSymbolFilter();
}

// Инициализация пагинации
function initPagination() {
    const prevButton = document.getElementById('prev-page');
    const nextButton = document.getElementById('next-page');
    
    prevButton.addEventListener('click', () => {
        if (state.pagination.currentPage > 1) {
            state.pagination.currentPage--;
            updateSignalsTable();
        }
    });
    
    nextButton.addEventListener('click', () => {
        if (state.pagination.currentPage < state.pagination.totalPages) {
            state.pagination.currentPage++;
            updateSignalsTable();
        }
    });
}

// Инициализация обработчиков модальных окон
function initModalHandlers() {
    const modal = document.getElementById('signal-details-modal');
    const closeButton = document.querySelector('.close-modal');
    
    // Закрытие по кнопке
    closeButton.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    
    // Закрытие по клику вне модального окна
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
    
    // Закрытие по Escape
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.style.display === 'flex') {
            modal.style.display = 'none';
        }
    });
}

// CSS стили для деталей сигнала
const signalDetailStyles = `
    .signal-details {
        padding: 10px 0;
    }
    
    .detail-row {
        display: flex;
        margin-bottom: 10px;
        border-bottom: 1px solid #eee;
        padding-bottom: 5px;
    }
    
    .detail-label {
        font-weight: 600;
        width: 30%;
        color: var(--text-muted);
    }
    
    .detail-value {
        flex: 1;
        word-break: break-all;
    }
`;

// Добавляем стили в документ
(function() {
    const style = document.createElement('style');
    style.textContent = signalDetailStyles;
    document.head.appendChild(style);
})();

// Функции для страницы анализа сделок
function updateTradesAnalysisTable() {
    const tbody = document.getElementById('trades-analysis-body');
    
    tbody.innerHTML = '';
    
    if (state.trades.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="10" class="no-data-message">Нет сделок</td>`;
        tbody.appendChild(tr);
        return;
    }
    
    state.trades.forEach((trade) => {
        const tr = document.createElement('tr');
        
        // Получаем данные о сделке с учетом возможных undefined значений
        const profit = parseFloat(trade.profit || 0);
        
        // Определяем класс для прибыли
        const profitClass = profit >= 0 ? 'profit-positive' : 'profit-negative';
        
        // Определяем тип сделки и соответствующий класс
        let typeClass = '';
        let typeText = '';
        
        // Новая логика определения типа сделки
        if (trade.type === 'LONG') {
            typeClass = 'type-buy';
            typeText = 'ЛОНГ';
        } else if (trade.type === 'SHORT') {
            typeClass = 'type-sell';
            typeText = 'ШОРТ';
        } else if (trade.type === 'exit_long' || trade.type === 'exit_short' || 
                  trade.type === 'Выход из длинной позиции' || trade.type === 'Выход из короткой позиции') {
            typeClass = 'type-close';
            typeText = 'ВЫХОД';
        } else {
            // Если тип не определен, пытаемся определить по содержимому
            if (typeof trade.type === 'string') {
                const typeStr = trade.type.toUpperCase();
                if (typeStr.includes('LONG') || typeStr.includes('BUY')) {
                    typeClass = 'type-buy';
                    typeText = 'ЛОНГ';
                } else if (typeStr.includes('SHORT') || typeStr.includes('SELL')) {
                    typeClass = 'type-sell';
                    typeText = 'ШОРТ';
                } else {
                    typeClass = 'type-close';
                    typeText = 'ВЫХОД';
                }
            } else {
                typeClass = 'type-close';
                typeText = 'НЕИЗВЕСТНО';
            }
        }
        
        // Получаем отформатированные данные времени, если они доступны
        const openTimeFormatted = trade.openTimeFormatted || (trade.openTime ? 
            new Date(trade.openTime).toLocaleString('ru-RU', {
                day: '2-digit', month: '2-digit', year: '2-digit', 
                hour: '2-digit', minute: '2-digit'
            }) : 'N/A');
        
        const closeTimeFormatted = trade.closeTimeFormatted || (trade.closeTime ? 
            new Date(trade.closeTime).toLocaleString('ru-RU', {
                day: '2-digit', month: '2-digit', year: '2-digit', 
                hour: '2-digit', minute: '2-digit'
            }) : 'N/A');
        
        // Создаем содержимое строки таблицы
        tr.innerHTML = `
            <td>${trade.number || '—'}</td>
            <td><span class="signal-type ${typeClass}">${typeText}</span></td>
            <td>${trade.signal || '—'}</td>
            <td>${openTimeFormatted} → ${closeTimeFormatted}</td>
            <td>${(trade.openPrice || 'NaN')} USDT</td>
            <td>${trade.contracts || 1}</td>
            <td>
                <span class="${profitClass}">${trade.display?.profit || 'N/A'}</span><br>
                <span class="${profitClass}">${trade.display?.profitPercent || 'N/A'}</span>
            </td>
            <td>${trade.display?.cumulativeProfit || 'N/A'}</td>
            <td>${trade.display?.peakProfit || 'N/A'}</td>
            <td>${trade.display?.maxDrawdown || 'N/A'}</td>
        `;
        
        tbody.appendChild(tr);
    });
}

function updateTradesStatistics() {
    // Расчет статистики по сделкам
    const totalTrades = state.trades.length;
    let winningTrades = 0;
    let losingTrades = 0;
    let totalProfit = 0;
    let totalLoss = 0;
    
    state.trades.forEach(trade => {
        const profit = parseFloat(trade.profit || 0);
        
        if (profit > 0) {
            winningTrades++;
            totalProfit += profit;
        } else if (profit < 0) {
            losingTrades++;
            totalLoss += Math.abs(profit);
        }
    });
    
    // Рассчитываем средние показатели
    const avgProfit = winningTrades > 0 ? (totalProfit / winningTrades).toFixed(2) : 0;
    const avgLoss = losingTrades > 0 ? (totalLoss / losingTrades).toFixed(2) : 0;
    const profitRiskRatio = avgLoss > 0 ? (avgProfit / avgLoss).toFixed(2) : 0;
    
    // Процент выигрышных/проигрышных сделок
    const winPercent = totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(2) : 0;
    const lossPercent = totalTrades > 0 ? ((losingTrades / totalTrades) * 100).toFixed(2) : 0;
    
    // Обновляем DOM элементы
    document.getElementById('winning-trades-count').textContent = winningTrades;
    document.getElementById('winning-trades-percent').textContent = `${winPercent}%`;
    document.getElementById('losing-trades-count').textContent = losingTrades;
    document.getElementById('losing-trades-percent').textContent = `${lossPercent}%`;
    document.getElementById('avg-profit').textContent = `${avgProfit} USDT`;
    document.getElementById('avg-loss').textContent = `${avgLoss} USDT`;
    document.getElementById('profit-risk-ratio').textContent = profitRiskRatio;
    
    // Рисуем график динамики торговли
    updateTradesChart();
}

function updateTradesChart() {
    // Проверяем наличие элемента canvas
    const chartCanvas = document.getElementById('trades-chart');
    if (!chartCanvas) return;
    
    // Получаем данные для графика
    const labels = state.trades.map((_, index) => `Сделка ${index + 1}`);
    const cumulativeData = [];
    let cumulative = 0;
    
    state.trades.forEach(trade => {
        const profit = parseFloat(trade.profit || 0);
        cumulative += profit;
        cumulativeData.push(cumulative);
    });
    
    // Если есть существующий график, уничтожаем его
    if (window.tradesChart) {
        window.tradesChart.destroy();
    }
    
    // Создаем новый график
    window.tradesChart = new Chart(chartCanvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Общая прибыль (USDT)',
                data: cumulativeData,
                backgroundColor: 'rgba(41, 98, 255, 0.1)',
                borderColor: 'rgba(41, 98, 255, 1)',
                borderWidth: 2,
                fill: true,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false,
                    grid: {
                        display: true,
                        color: 'rgba(200, 200, 200, 0.1)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            }
        }
    });
}

// Получение данных о сделках с сервера
function loadTradesData() {
    console.log('Загрузка данных о сделках...');
    
    // Если есть активное соединение с сервером, запрашиваем реальные данные
    if (state.socket && state.connectionStatus === 'connected') {
        console.log('Запрашиваем реальные данные о сделках с сервера...');
        
        state.socket.emit('getTradesData', {}, (trades) => {
            if (trades && trades.length > 0) {
                console.log('Получены данные о сделках с сервера:', trades.length);
                state.trades = trades;
                updateTradesAnalysisTable();
                updateTradesStatistics();
            } else {
                console.log('Нет данных о сделках на сервере, загружаем демо-данные');
                loadDemoTradesData();
            }
        });
    } else {
        console.log('Нет соединения с сервером, загружаем демо-данные');
        loadDemoTradesData();
    }
}

// Добавляем в обработчик событий функционал вкладок
function setupTradesTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Удаляем активный класс у всех кнопок и вкладок
            document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.trades-tab-content').forEach(content => content.classList.remove('active'));
            
            // Добавляем активный класс выбранной кнопке
            button.classList.add('active');
            
            // Показываем соответствующий контент
            const tabId = button.dataset.tab;
            document.getElementById(tabId).classList.add('active');
        });
    });
}

// Функция загрузки данных о сделках
function loadDemoTrades() {
    console.log('Загрузка данных о сделках...');
    
    // Если есть активное соединение с сервером, запрашиваем реальные данные
    if (state.socket && state.connectionStatus === 'connected') {
        console.log('Запрашиваем реальные данные о сделках с сервера...');
        
        state.socket.emit('getTradesData', {}, (trades) => {
            if (trades && trades.length > 0) {
                console.log('Получены данные о сделках с сервера:', trades.length);
                state.trades = trades;
                updateTradesAnalysisTable();
                updateTradesStatistics();
            } else {
                console.log('Нет данных о сделках на сервере, загружаем демо-данные');
                loadDemoTradesData();
            }
        });
    } else {
        console.log('Нет соединения с сервером, загружаем демо-данные');
        loadDemoTradesData();
    }
}

// Функция загрузки демо-данных о сделках
function loadDemoTradesData() {
    // Генерируем демо-данные для тестирования
    const demoTrades = [
        {
            id: '1',
            number: 1,
            type: 'LONG',
            signal: 'Метка на графике',
            openTime: new Date('2023-10-01T15:30:00').getTime(),
            closeTime: new Date('2023-10-01T17:45:00').getTime(),
            openTimeFormatted: '01.10.23 15:30',
            closeTimeFormatted: '01.10.23 17:45',
            openPrice: 27150.42,
            closePrice: 27302.18,
            contracts: 1,
            profit: 151.76,
            profitPercent: 0.56,
            cumulativeProfit: 151.76,
            peakProfit: 151.76,
            maxDrawdown: 0,
            timeInPosition: 8100000,
            timeInPositionDisplay: '2ч 15мин',
            display: {
                profit: '+151.76 USDT',
                profitPercent: '+0.56%',
                cumulativeProfit: '+151.76 USDT',
                peakProfit: '+151.76 USDT',
                maxDrawdown: '-0.00 USDT'
            }
        },
        {
            id: '2',
            number: 2,
            type: 'SHORT',
            signal: 'TradingView сигнал',
            openTime: new Date('2023-10-01T18:15:00').getTime(),
            closeTime: new Date('2023-10-01T19:20:00').getTime(),
            openTimeFormatted: '01.10.23 18:15',
            closeTimeFormatted: '01.10.23 19:20',
            openPrice: 27280.30,
            closePrice: 27140.55,
            contracts: 1,
            profit: 139.75,
            profitPercent: 0.51,
            cumulativeProfit: 291.51,
            peakProfit: 291.51,
            maxDrawdown: 0,
            timeInPosition: 3900000,
            timeInPositionDisplay: '1ч 5мин',
            display: {
                profit: '+139.75 USDT',
                profitPercent: '+0.51%',
                cumulativeProfit: '+291.51 USDT',
                peakProfit: '+291.51 USDT',
                maxDrawdown: '-0.00 USDT'
            }
        },
        {
            id: '3',
            number: 3,
            type: 'LONG',
            signal: 'Фигура на графике',
            openTime: new Date('2023-10-01T19:50:00').getTime(),
            closeTime: new Date('2023-10-01T20:07:00').getTime(),
            openTimeFormatted: '01.10.23 19:50',
            closeTimeFormatted: '01.10.23 20:07',
            openPrice: 27150.42,
            closePrice: 27068.30,
            contracts: 1,
            profit: -82.12,
            profitPercent: -0.30,
            cumulativeProfit: 209.39,
            peakProfit: 291.51,
            maxDrawdown: 82.12,
            timeInPosition: 1020000,
            timeInPositionDisplay: '17мин',
            display: {
                profit: '-82.12 USDT',
                profitPercent: '-0.30%',
                cumulativeProfit: '+209.39 USDT',
                peakProfit: '+291.51 USDT',
                maxDrawdown: '-82.12 USDT'
            }
        },
        {
            id: '4',
            number: 4,
            type: 'SHORT',
            signal: 'Индикатор (short/sell)',
            openTime: new Date('2023-10-01T20:13:00').getTime(),
            closeTime: new Date('2023-10-01T20:17:00').getTime(),
            openTimeFormatted: '01.10.23 20:13',
            closeTimeFormatted: '01.10.23 20:17',
            openPrice: 27050.80,
            closePrice: 27029.60,
            contracts: 1,
            profit: 21.20,
            profitPercent: 0.08,
            cumulativeProfit: 230.59,
            peakProfit: 291.51,
            maxDrawdown: 82.12,
            timeInPosition: 240000,
            timeInPositionDisplay: '4мин',
            display: {
                profit: '+21.20 USDT',
                profitPercent: '+0.08%',
                cumulativeProfit: '+230.59 USDT',
                peakProfit: '+291.51 USDT',
                maxDrawdown: '-82.12 USDT'
            }
        }
    ];
    
    state.trades = demoTrades;
    updateTradesAnalysisTable();
    updateTradesStatistics();
}

// Инициализация всего приложения
function initApp() {
    // ... existing code ...
    
    // Инициализация вкладок на странице анализа сделок
    setupTradesTabs();
    
    // Загружаем демо-данные для тестирования
    loadDemoTrades();
    
    // ... existing code ...
}

// Функция для обновления таблицы форматированных сделок
function updateFormattedTradesTable(trades) {
    const tbody = document.getElementById('trades-body');
    if (!tbody) return;
    
    if (!trades || trades.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data-message">Нет данных о сделках</td></tr>';
        return;
    }
    
    tbody.innerHTML = trades.map(trade => `
        <tr>
            <td>${trade.action}</td>
            <td class="trade-type ${trade.type === 'LONG' ? 'type-buy' : 'type-sell'}">${trade.type}</td>
            <td>${trade.time}</td>
            <td>${trade.price}</td>
            <td class="${parseFloat(trade.pnl) >= 0 ? 'profit-positive' : 'profit-negative'}">${parseFloat(trade.pnl) >= 0 ? '+' : ''}${trade.pnl}</td>
        </tr>
    `).join('');
}

// Добавим функцию для запроса форматированных данных о сделках
function loadFormattedTrades() {
    console.log('Запрашиваем форматированные данные о сделках...');
    
    // Если есть активное соединение с сервером, запрашиваем данные
    if (state.socket && state.connectionStatus === 'connected') {
        state.socket.emit('getFormattedTrades', {}, (trades) => {
            if (trades && trades.length > 0) {
                console.log('Получены форматированные данные о сделках:', trades.length);
                updateFormattedTradesTable(trades);
            } else {
                console.log('Нет форматированных данных о сделках на сервере');
                updateFormattedTradesTable([]);
            }
        });
    } else {
        console.log('Нет соединения с сервером');
        updateFormattedTradesTable([]);
    }
} 