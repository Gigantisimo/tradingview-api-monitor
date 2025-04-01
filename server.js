const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');
const { Client } = require('@mathieuc/tradingview');
const axios = require('axios');
    const TradingView = require('@mathieuc/tradingview');
    const WebSocket = require('ws');
    const cors = require('cors');

// Создаем экземпляр Express
const app = express();

    // Настраиваем CORS для Express
    app.use(cors({
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));

const server = http.createServer(app);

    // Настраиваем Socket.IO с расширенными настройками CORS
const io = socketIO(server, {
    cors: {
        origin: '*',
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization'],
            credentials: true
        },
        transports: ['websocket', 'polling'],
        allowEIO3: true
});

// Переменные для хранения состояния
const settings = {
    tradingViewApi: {
        session: process.env.SESSION || '',
        signature: process.env.SIGNATURE || '',
        strategyId: process.env.STRATEGY_ID || ''
    },
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        sendNotifications: process.env.SEND_NOTIFICATIONS !== 'false'
    },
    monitoring: {
        market: process.env.MARKET || 'BINANCE:BTCUSDT',
        timeframe: process.env.TIMEFRAME || '15',
        cooldownPeriod: parseInt(process.env.COOLDOWN_PERIOD || '0'),
        signalFreshness: parseInt(process.env.SIGNAL_FRESHNESS || '60000'),
        checkInterval: parseInt(process.env.CHECK_INTERVAL || '15000'),
        minPositionHoldTime: parseInt(process.env.MIN_POSITION_HOLD_TIME || '0')
    }
};

// Переменные для работы с TradingView
let tvClient = null;
let chart = null;
let currentSymbol = settings.monitoring.market;
let currentTimeframe = settings.monitoring.timeframe;

// Переменные для отслеживания позиций и сигналов
const MAX_SIGNALS = 100;
const signals = [];
const currentPositions = {};
const positionHistory = [];
const processedSignals = {}; // Для отслеживания уже обработанных сигналов

// Счетчик активных подключений
let connectionCount = 0;

// Статистика
const statistics = {
    signalsToday: 0,
    activePositions: 0,
    notificationsSent: 0,
    startTime: new Date()
};

// Статические файлы
app.use(express.static(path.join(__dirname)));

// Обработка корневого маршрута
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Socket.IO подключение
io.on('connection', (socket) => {
    console.log('👤 Клиент подключен:', socket.id);
    connectionCount++;
    
    // Отправляем начальные данные подключенному клиенту
    socket.emit('initialData', {
        signals: signals,
        currentPositions: currentPositions,
        positionHistory: positionHistory,
        statistics: statistics
    });
    
    // Обрабатываем запрос на обновление настроек
    socket.on('updateSettings', (newSettings) => {
        console.log('🔧 Получен запрос на обновление настроек:', newSettings);
        
        // Обновляем настройки
        if (newSettings.tradingViewApi) {
            settings.tradingViewApi = {...settings.tradingViewApi, ...newSettings.tradingViewApi};
        }
        
        if (newSettings.telegram) {
            settings.telegram = {...settings.telegram, ...newSettings.telegram};
        }
        
        if (newSettings.monitoring) {
            settings.monitoring = {...settings.monitoring, ...newSettings.monitoring};
        }
        
        // Сохраняем обновленные настройки
        saveSettings();
        
        // Перезапускаем мониторинг с новыми настройками
        restartMonitoring();
    });
    
    // Обрабатываем запрос на перезапуск мониторинга
    socket.on('restart', () => {
        console.log('🔄 Получен запрос на перезапуск мониторинга');
        restartMonitoring();
    });
    
    // Обрабатываем запрос на удаление сигнала
    socket.on('deleteSignal', (data) => {
        console.log('🗑️ Запрос на удаление сигнала:', data);
        
        if (data && data.id) {
            // Находим сигнал по ID
            const signalIndex = signals.findIndex(s => s.id === data.id);
            
            if (signalIndex !== -1) {
                // Удаляем сигнал
                signals.splice(signalIndex, 1);
                
                // Отправляем обновленные данные всем клиентам
                io.emit('initialData', {
                    signals: signals,
                    currentPositions: currentPositions,
                    positionHistory: positionHistory,
                    statistics: statistics
                });
                
                console.log(`✅ Сигнал ${data.id} удален`);
            } else {
                console.log(`⚠️ Сигнал ${data.id} не найден`);
            }
        }
    });
    
    // Обрабатываем запрос на получение данных о сделках
    socket.on('getTradesData', (data, callback) => {
        console.log('📊 Запрос на получение данных о сделках');
        
        // Получаем данные о сделках
        const tradesData = getTradesData();
        
        // Возвращаем данные через callback
        if (typeof callback === 'function') {
            callback(tradesData);
        }
        
        // Также отправляем всем клиентам
        io.emit('tradesUpdate', tradesData);
    });
    
    // Обрабатываем отключение клиента
    socket.on('disconnect', () => {
        console.log('👤 Клиент отключен:', socket.id);
        connectionCount--;
    });
    
    socket.on('getFormattedTrades', (data, callback) => {
        console.log('Получен запрос на форматированную историю позиций');
        const formatted = formatPositionHistory();
        if (typeof callback === 'function') {
            callback(formatted);
        }
        io.emit('formattedTrades', formatted);
    });
});

    // Вспомогательные функции для работы с TradingView API
    async function initTradingViewClient(settings) {
        try {
            console.log('Инициализация TradingView клиента...');
            
            if (!settings.tradingViewApi.session || !settings.tradingViewApi.signature) {
                throw new Error('Отсутствуют session или signature в настройках');
            }

            const client = new TradingView.Client({
                token: settings.tradingViewApi.session,
                signature: settings.tradingViewApi.signature,
                debug: true // Включаем отладку для диагностики
            });

            // Проверяем подключение
            await new Promise((resolve, reject) => {
                client.onConnected().then(() => {
                    console.log('✅ TradingView клиент успешно подключен');
                    resolve();
                }).catch(reject);

                // Таймаут на подключение
                setTimeout(() => {
                    reject(new Error('Таймаут подключения к TradingView'));
                }, 10000);
            });

            return client;
        } catch (error) {
            console.error('❌ Ошибка при инициализации TradingView клиента:', error.message);
            throw error;
        }
    }

    async function createChart(client, settings) {
        try {
            console.log('Создание чарта...');
            
            const chart = new client.Session.Chart();
            
            // Устанавливаем рынок и таймфрейм
            await chart.setMarket(settings.monitoring.market, {
                timeframe: settings.monitoring.timeframe,
                range: 50 // Количество свечей для загрузки
            });

            // Ждем загрузки символа
            await new Promise((resolve, reject) => {
                chart.onSymbolLoaded(() => {
                    console.log('✅ Символ успешно загружен');
                    resolve();
                });

                chart.onError((...err) => {
                    console.error('❌ Ошибка чарта:', ...err);
                    reject(new Error('Ошибка при загрузке символа'));
                });

                // Таймаут на загрузку символа
                setTimeout(() => {
                    reject(new Error('Таймаут загрузки символа'));
                }, 10000);
            });

            return chart;
        } catch (error) {
            console.error('❌ Ошибка при создании чарта:', error.message);
            throw error;
        }
    }

// Инициализация TradingView API
async function initTradingView() {
    // Если клиент уже существует, закрываем его
    if (tvClient) {
        try {
            if (typeof tvClient.end === 'function') {
                tvClient.end();
            }
            tvClient = null;
        } catch (error) {
            console.log('Ошибка при закрытии текущего клиента:', error);
        }
    }
    
    // Проверяем, что настройки сессии указаны
    if (!settings.tradingViewApi.session || !settings.tradingViewApi.signature) {
        throw new Error('Необходимо указать SESSION и SIGNATURE для подключения к TradingView API');
    }
    
    // Удаляем возможные пробелы в токенах
    settings.tradingViewApi.session = settings.tradingViewApi.session.trim();
    settings.tradingViewApi.signature = settings.tradingViewApi.signature.trim();
    
    // Проверяем формат данных
    if (settings.tradingViewApi.session.length < 5) {
        throw new Error('SESSION слишком короткий, проверьте правильность данных');
    }
    
    if (settings.tradingViewApi.signature.length < 10) {
        throw new Error('SIGNATURE слишком короткий, проверьте правильность данных');
    }
    
    // Создаем новый клиент
    try {
        // Создание клиента TradingView API
        console.log('Попытка создания клиента TradingView с данными:');
        console.log('- Token (первые 5 символов):', settings.tradingViewApi.session.substring(0, 5) + '...');
        console.log('- Signature (первые 10 символов):', settings.tradingViewApi.signature.substring(0, 10) + '...');
        
        try {
            // Способ 1: Пробуем создать клиент с прямыми параметрами
            console.log('Пробуем метод инициализации #1...');
            tvClient = new Client({
                token: settings.tradingViewApi.session,
                signature: settings.tradingViewApi.signature
            });
        } catch (error1) {
            console.log('Метод инициализации #1 не удался, пробуем метод #2...');
            
            try {
                // Способ 2: Пробуем альтернативный способ создания клиента
                tvClient = new Client();
                
                // Вручную устанавливаем токен и подпись вместо передачи в конструктор
                tvClient.headers = {
                    'Cookie': `sessionid=${settings.tradingViewApi.session}; signature=${settings.tradingViewApi.signature}`
                };
            } catch (error2) {
                console.log('Метод инициализации #2 не удался, пробуем метод #3...');
                
                try {
                    // Способ 3: Пробуем другие имена параметров
                    tvClient = new Client({
                        sessionid: settings.tradingViewApi.session,
                        sign: settings.tradingViewApi.signature
                    });
                } catch (error3) {
                    console.error('Все методы инициализации не удались:');
                    console.error('Ошибка метода #1:', error1);
                    console.error('Ошибка метода #2:', error2);
                    console.error('Ошибка метода #3:', error3);
                    throw new Error('Не удалось инициализировать клиент TradingView');
                }
            }
        }
        
        // Проверяем создание клиента
        if (!tvClient) {
            throw new Error('Клиент TradingView не был создан');
        }
        
        // Проверяем наличие важных методов
        if (typeof tvClient.end !== 'function') {
            console.warn('Внимание: метод tvClient.end отсутствует');
        }
        
        if (typeof tvClient.Session !== 'object' || typeof tvClient.Session.Chart !== 'function') {
            console.warn('Внимание: метод tvClient.Session.Chart отсутствует');
        }
        
        // Инициализируем график (заменено на заглушку)
        console.log('TradingView API клиент создан успешно');
        
        // Пробуем инициализировать график, если возможно
        if (typeof tvClient.Session === 'object' && typeof tvClient.Session.Chart === 'function') {
            try {
                await updateChart();
            } catch (chartError) {
                console.error('Ошибка при инициализации графика:', chartError);
                console.log('Продолжаем работу без графика');
            }
        } else {
            console.log('Невозможно инициализировать график, работаем в режиме эмуляции');
        }
        
        // Эмулируем обновление графика каждые 15 секунд
        setInterval(() => {
            // Эмуляция обновления данных
            io.emit('initialData', {
                signals,
                currentPositions: getPositionsStatus().positions,
                positionHistory: getValidatedPositionHistory(),
                statistics
            });
        }, 15000);
        
        // Возвращаем успешный результат
        return true;
    } catch (error) {
        console.error('Ошибка при инициализации TradingView API:', error);
        console.error('Стек ошибки:', error.stack);
        throw error;
    }
}

// Обновление графика
async function updateChart() {
    if (!tvClient) {
        throw new Error('TradingView клиент не инициализирован');
    }
    
    // Если символ или таймфрейм не изменились, возвращаемся
    if (currentSymbol === settings.monitoring.market && currentTimeframe === settings.monitoring.timeframe && chart) {
        return;
    }
    
    // Обновляем текущие значения
    currentSymbol = settings.monitoring.market;
    currentTimeframe = settings.monitoring.timeframe;
    
    // Если график уже существует, закрываем его
    if (chart) {
        try {
            if (typeof chart.close === 'function') {
                chart.close();
            }
        } catch (err) {
            console.log('Ошибка при закрытии графика:', err);
        }
        chart = null;
    }
    
    // Создаем новый график
    try {
        // Проверяем доступность необходимых методов
        if (!tvClient.Session || typeof tvClient.Session.Chart !== 'function') {
            throw new Error('Метод tvClient.Session.Chart недоступен');
        }
        
        // Создаем график
        chart = new tvClient.Session.Chart();
        
        // Устанавливаем символ и таймфрейм
        await chart.setMarket(currentSymbol, {
            timeframe: currentTimeframe
        });
        
        // Если указан ID стратегии, загружаем её
        if (settings.tradingViewApi.strategyId) {
            try {
                await loadStrategy();
            } catch (strategyError) {
                console.error('Ошибка при загрузке стратегии:', strategyError);
            }
        }
        
        // Устанавливаем обработчик для цен
        if (typeof chart.onUpdate === 'function') {
            chart.onUpdate(() => {
                if (!chart || !chart.periods || chart.periods.length === 0) return;
                
                const lastBar = chart.periods[chart.periods.length - 1];
                if (lastBar) {
                    // Обновляем цены для открытых позиций
                    Object.values(currentPositions).forEach(position => {
                        position.currentPrice = lastBar.close;
                    });
                    
                    // Отправляем обновленные позиции
                    io.emit('initialData', {
                        signals,
                        currentPositions: getPositionsStatus().positions,
                        positionHistory: getValidatedPositionHistory(),
                        statistics
                    });
                }
            });
        } else {
            console.warn('Метод chart.onUpdate недоступен');
        }
        
        // Устанавливаем обработчик для графических элементов
        if (typeof chart.onGraphicUpdate === 'function') {
            chart.onGraphicUpdate(processGraphicElements);
        } else {
            console.warn('Метод chart.onGraphicUpdate недоступен');
            
            // Устанавливаем интервал для имитации обновлений графика
            setInterval(() => {
                io.emit('initialData', {
                    signals,
                    currentPositions: getPositionsStatus().positions,
                    positionHistory: getValidatedPositionHistory(),
                    statistics
                });
            }, settings.monitoring.checkInterval);
        }
        
        console.log(`График обновлен: ${currentSymbol}, таймфрейм: ${currentTimeframe}`);
    } catch (error) {
        console.error('Ошибка при обновлении графика:', error);
        throw error;
    }
}

// Загрузка стратегии
async function loadStrategy() {
    if (!chart) {
        throw new Error('График не инициализирован');
    }
    
    console.log('📊 Загрузка Pine Script стратегии...');
    
    try {
            // Пробуем различные варианты получения индикатора
            let strategy;
            try {
                console.log('🔍 Пробуем загрузить индикатор...');
                strategy = await TradingView.getIndicator(settings.tradingViewApi.strategyId);
            } catch (error) {
                console.log('❌ Не удалось загрузить стратегию, пробуем использовать RSI...');
                try {
                    // Используем RSI как запасной вариант для тестирования
                    strategy = await TradingView.getIndicator('STD;Relative%20Strength%20Index');
        } catch (error) {
                    throw new Error(`Не удалось загрузить ни стратегию, ни RSI: ${error.message}`);
                }
            }
            
            if (!strategy) {
                throw new Error('Не удалось получить стратегию');
            }
            
            console.log(`✅ Стратегия найдена: ${strategy.description || 'Без описания'}`);
            console.log('📊 Создание экземпляра стратегии...');
            
            // Создаем экземпляр исследования (Study) на основе стратегии
            const strategyInstance = new chart.Study(strategy);
        
        // Обработка ошибок индикатора
            strategyInstance.onError((...err) => {
                console.error('❌ Ошибка стратегии:', ...err);
            });

        // Когда индикатор готов
            strategyInstance.onReady(() => {
                console.log(`✅ Стратегия '${strategyInstance.instance.description}' успешно загружена!`);
                
                // Добавляем обработчик периодического отслеживания сигналов
                console.log('⏱️ Запуск периодического отслеживания сигналов...');
                
                // Эмулируем тестовый сигнал для проверки работы системы
                const testSignal = {
                    id: generateId(),
                    time: Date.now(),
                    symbol: currentSymbol,
                    type: 'TEST',
                    price: chart.periods[0]?.close || 0,
                    source: 'Тест системы',
                    status: 'pending',
                    isRealTime: true  // Помечаем как сигнал реального времени
                };
                
                // Добавляем тестовый сигнал
                addSignal(testSignal);
            });
        
            // Обработка данных из стратегии
            strategyInstance.onUpdate(() => {
                try {
                    // Получаем данные стратегии и чарта
                    const periods = strategyInstance.periods;
                    if (!periods || !periods.length || !periods[0]) return;
                    
                    const currentPrice = chart.periods[0]?.close || 0;
                    const symbol = chart.infos.description;
                    
                    // Проверяем наличие обновлений
                    console.log(`\n[${new Date().toLocaleString()}] Обновление данных стратегии для ${symbol} @ ${currentPrice}`);
                    
                    // Проверяем, есть ли новые графические элементы или сигналы
                    processStrategySignals(strategyInstance);
                } catch (error) {
                    console.error('❌ Ошибка при обработке обновления стратегии:', error.message);
                }
            });
        
            return strategyInstance;
    } catch (error) {
            console.error('❌ Ошибка при загрузке стратегии:', error.message);
            console.error('Стек ошибки:', error.stack);
        enableEmulationMode();
        return null;
    }
}

// Функция для включения режима эмуляции
function enableEmulationMode() {
    console.log(`⚠️ Эмуляция стратегии для ${settings.tradingViewApi.strategyId}`);
    
    // Устанавливаем интервал для проверки сигналов в режиме эмуляции
    setInterval(() => {
        if (chart && chart.periods && chart.periods.length > 0) {
            const lastBar = chart.periods[chart.periods.length - 1];
            if (lastBar) {
                // Получаем текущую цену
                const currentPrice = lastBar.close;
                
                // Добавляем информативный сигнал для тестирования
                if (Math.random() < 0.1) { // 10% шанс генерации сигнала
                    const signalTypes = ['BUY', 'SELL', 'CLOSE'];
                    const randomType = signalTypes[Math.floor(Math.random() * signalTypes.length)];
                    
                    // Генерируем тестовый сигнал
                    const testSignal = {
                        id: generateId(),
                        time: Date.now(),
                        symbol: currentSymbol,
                        type: randomType,
                        price: currentPrice,
                        source: 'Эмуляция',
                            status: 'pending',
                            isRealTime: true // Помечаем как сигнал реального времени
                    };
                    
                    // Обрабатываем сигнал
                    console.log(`⚠️ Сгенерирован тестовый сигнал: ${randomType} для ${currentSymbol} по цене ${currentPrice}`);
                    processSignal(testSignal);
                }
            }
        }
    }, settings.monitoring.checkInterval);
}

    // Добавляем глобальную переменную для отслеживания времени последней проверки
    let lastCheckTimestamp = Date.now();

    // Сохраняем время запуска сервера для отсечения старых меток
    const SERVER_START_TIME = Date.now();

// Функция для обработки графических элементов стратегии
function processGraphicElements(graphicData) {
    try {
            if (!graphicData || !chart) {
                console.log('Нет данных графика или график не инициализирован');
                return;
            }
            
            // Передаем графические данные в основную функцию обработки сигналов
            // Создаем временный объект, похожий на strategyInstance, но содержащий только графические элементы
            const tempInstance = {
                graphic: graphicData,
                strategyReport: null,
                periods: []
            };
            
            // Делегируем всю обработку сигналов функции processStrategySignals
            processStrategySignals(tempInstance);
            
        } catch (error) {
            console.error('❌ Ошибка при обработке графических элементов:', error);
        }
    }
    
    function processStrategySignals(strategyInstance) {
        try {
            if (!strategyInstance || !chart) {
                return;
            }
        
        const currentPrice = chart.periods[0]?.close || 0;
        const symbol = chart.infos.description;
            const timestamp = Date.now();
            
            // Период охлаждения для предотвращения частых сигналов
            const COOLDOWN_PERIOD = settings.monitoring.cooldownPeriod || 0;
            const SIGNAL_FRESHNESS = settings.monitoring.signalFreshness || 60000; // 1 минута по умолчанию
            
            // Проверяем, прошло ли достаточно времени с последнего сигнала
            if (COOLDOWN_PERIOD > 0) {
                const lastPositionChangeTime = currentPositions[symbol]?.openTime || 0;
                const timeSinceLastChange = timestamp - lastPositionChangeTime;
                
                if (lastPositionChangeTime > 0 && timeSinceLastChange < COOLDOWN_PERIOD) {
                    console.log(`⏳ Активен период охлаждения (${Math.floor(timeSinceLastChange/1000)}с из ${COOLDOWN_PERIOD/1000}с). Пропускаем проверку сигналов.`);
                    return;
                }
            }
            
            console.log('=== Проверка новых сигналов стратегии ===');
            
            // Флаг для отслеживания, был ли обнаружен сигнал в текущем проходе
            let signalDetected = false;
            
            // 1. Проверяем данные периодов стратегии для индикаторов
            if (strategyInstance.periods && strategyInstance.periods.length > 0) {
                const latestPeriod = strategyInstance.periods[0];
                
                // Если период свежий (не старше SIGNAL_FRESHNESS), обрабатываем его
                if (latestPeriod && latestPeriod.$time && 
                    (timestamp - latestPeriod.$time * 1000) <= SIGNAL_FRESHNESS) {
                    
                    console.log('🔍 Проверка данных индикатора:', JSON.stringify(latestPeriod));
                    
                    // Проверяем различные поля для обнаружения сигналов
                    // Проверка сигнального поля value
                    if (latestPeriod.value !== undefined) {
                        const signalValue = Array.isArray(latestPeriod.value) ? latestPeriod.value[0] : latestPeriod.value;
                        
                        // Создаем уникальный ключ для сигнала
                        const signalKey = `value_${signalValue}_${symbol}_${Math.floor(timestamp / 5000)}`;
                        
                        if (signalValue === 1 || signalValue === '1' || signalValue === true) {
                            console.log('🟢 Найден BUY сигнал в данных стратегии (value)');
                    const signal = {
                        id: generateId(),
                                time: timestamp,
                                symbol: symbol,
                                type: 'BUY',
                        price: currentPrice,
                                source: 'Индикатор (value)',
                                status: 'pending',
                                isRealTime: true
                    };
                    processSignal(signal);
                            signalDetected = true;
                        } else if (signalValue === -1 || signalValue === '-1' || signalValue === false) {
                            console.log('🔴 Найден SELL сигнал в данных стратегии (value)');
                    const signal = {
                        id: generateId(),
                                time: timestamp,
                                symbol: symbol,
                                type: 'SELL',
                        price: currentPrice,
                                source: 'Индикатор (value)',
                                status: 'pending',
                                isRealTime: true
                    };
                    processSignal(signal);
                            signalDetected = true;
                        }
                    }
                    
                    // Проверка сигнальных полей long/short
                    if (!signalDetected) {
                        if (latestPeriod.long === 1 || latestPeriod.long === true || 
                            latestPeriod.buy === 1 || latestPeriod.buy === true ||
                            latestPeriod.plot_0 === 1) {
                            
                            console.log('🟢 Найден BUY сигнал в данных стратегии (long/buy/plot_0)');
                    const signal = {
                        id: generateId(),
                                time: timestamp,
                                symbol: symbol,
                        type: 'BUY',
                        price: currentPrice,
                                source: 'Индикатор (long/buy)',
                                status: 'pending',
                                isRealTime: true
                    };
                    processSignal(signal);
                            signalDetected = true;
                        } else if (latestPeriod.short === 1 || latestPeriod.short === true || 
                                  latestPeriod.sell === 1 || latestPeriod.sell === true ||
                                  latestPeriod.plot_0 === -1) {
                
                            console.log('🔴 Найден SELL сигнал в данных стратегии (short/sell/plot_0)');
                    const signal = {
                        id: generateId(),
                                time: timestamp,
                                symbol: symbol,
                        type: 'SELL',
                        price: currentPrice,
                                source: 'Индикатор (short/sell)',
                                status: 'pending',
                                isRealTime: true
                    };
                    processSignal(signal);
                            signalDetected = true;
                        }
                    }
                    
                    // Проверка сигнала закрытия
                    if (!signalDetected) {
                        if (latestPeriod.close === 1 || latestPeriod.close === true || 
                            latestPeriod.exit === 1 || latestPeriod.exit === true) {
                            
                            console.log('🔵 Найден CLOSE сигнал в данных стратегии');
                            const signal = {
                                id: generateId(),
                                time: timestamp,
                                symbol: symbol,
                                type: 'CLOSE',
                                price: currentPrice,
                                source: 'Индикатор (close/exit)',
                                status: 'pending',
                                isRealTime: true
                            };
                            processSignal(signal);
                            signalDetected = true;
                        }
                    }
                }
            }
            
            // 2. Проверяем графические элементы, только если не обнаружили сигнал в данных стратегии
            if (!signalDetected && strategyInstance.graphic && strategyInstance.graphic.labels && 
                strategyInstance.graphic.labels.length > 0) {
                
                // Фильтруем и сортируем метки: только с непустым текстом, отсортированные по времени (сначала новые)
                const relevantLabels = [...strategyInstance.graphic.labels]
                    .filter(label => label.text && label.text.trim() !== '')
                    .sort((a, b) => {
                        // Если есть явное время, используем его, иначе полагаемся на порядок отображения (индекс/id)
                        const timeA = a.time ? a.time * 1000 : 0;
                        const timeB = b.time ? b.time * 1000 : 0;
                        return timeB - timeA || b.id - a.id;
                    });
                
                // Выбираем только самую свежую метку
                const recentLabels = relevantLabels.filter(label => {
                    const labelTime = label.time ? label.time * 1000 : timestamp;
                    // Метка считается свежей, если она создана не раньше SERVER_START_TIME и не старше SIGNAL_FRESHNESS
                    return labelTime >= SERVER_START_TIME && (timestamp - labelTime) <= SIGNAL_FRESHNESS;
                }).slice(0, 1); // Берем только самую последнюю метку
                
                if (recentLabels.length > 0) {
                    const label = recentLabels[0];
                    const labelText = label.text.toUpperCase().trim();
                    const labelTime = label.time ? label.time * 1000 : timestamp;
                    const formattedTime = new Date(labelTime).toLocaleTimeString();
                    
                    // Создаем уникальный ключ для отслеживания обработанных меток
                    const labelKey = `${labelText}_${symbol}_${Math.floor(labelTime / 5000)}`;
                    
                    // Проверяем, не обрабатывали ли мы уже эту метку
                    if (!processedSignals[labelKey]) {
                        console.log(`📝 Обработка свежей метки: "${labelText}" (${formattedTime})`);
                        
                        // Сохраняем информацию о том, что эта метка была обработана
                        processedSignals[labelKey] = {
                            time: labelTime,
                            processed: timestamp
                        };
                        
                        // Генерируем сигналы в зависимости от текста метки
                        if (labelText.includes('BUY') || labelText === 'B' || labelText === 'LONG' || 
                            label.style === 'label_up' || label.style === 'arrowup') {
                            
                            console.log('🟢 Обнаружен сигнал BUY в метке');
                    const signal = {
                        id: generateId(),
                                time: labelTime,
                                symbol: symbol,
                        type: 'BUY',
                        price: currentPrice,
                                source: 'Метка на графике',
                                status: 'pending',
                                isRealTime: true
                    };
                    processSignal(signal);
                            signalDetected = true;
                        }
                        else if (labelText.includes('SELL') || labelText === 'S' || labelText === 'SHORT' || 
                                label.style === 'label_down' || label.style === 'arrowdown') {
                            
                            console.log('🔴 Обнаружен сигнал SELL в метке');
                    const signal = {
                        id: generateId(),
                                time: labelTime,
                                symbol: symbol,
                        type: 'SELL',
                        price: currentPrice,
                                source: 'Метка на графике',
                                status: 'pending',
                                isRealTime: true
                    };
                    processSignal(signal);
                            signalDetected = true;
                        }
                        else if (labelText.includes('CLOSE') || labelText === 'C' || 
                                labelText.includes('EXIT') || labelText === 'E' ||
                                labelText.includes('CLOSE LONG') || labelText === 'CL' ||
                                labelText.includes('CLOSE SHORT') || labelText === 'CS' ||
                                labelText.includes('CLOSE ENTRY') || 
                                labelText.includes('CLOSE ORDER') || 
                                labelText.includes('CLOSE POSITION') || 
                                // Добавляем поддержку формата "Close entry(s) order Short"
                                labelText.includes('ENTRY') && labelText.includes('ORDER')) {
                            
                            console.log('🔵 Обнаружен сигнал закрытия позиции в метке:', labelText);
                            
                            // Проверяем, есть ли открытая позиция
                            if (currentPositions[symbol]) {
                                const positionType = currentPositions[symbol].type;
                                
                                // Определяем тип закрываемой позиции из текста метки
                                const targetPositionType = 
                                    labelText.includes('LONG') ? 'LONG' : 
                                    labelText.includes('SHORT') ? 'SHORT' : null;
                                
                                // Проверяем, соответствует ли тип метки типу открытой позиции
                                let shouldClose = true;
                                
                                // Только если метка специфична для типа позиции, проверяем соответствие
                                if (targetPositionType && targetPositionType !== positionType) {
                                    shouldClose = false;
                                    console.log(`⚠️ Метка для закрытия ${targetPositionType}, но открыта ${positionType} позиция`);
                                }
                                
                                if (shouldClose) {
                                    const signal = {
                                        id: generateId(),
                                        time: labelTime,
                                        symbol: symbol,
                                        type: 'CLOSE',
                                        price: currentPrice,
                                        source: `Метка закрытия: ${labelText}`,
                                        status: 'pending',
                                        isRealTime: true,
                                        positionType: positionType // Сохраняем тип позиции в сигнале
                                    };
                                    processSignal(signal);
                                    signalDetected = true;
                                }
                            } else {
                                console.log('⚠️ Игнорируем сигнал закрытия - нет открытой позиции');
                            }
                        }
                    } else {
                        console.log(`⏭️ Метка "${labelText}" уже была обработана недавно`);
                    }
                }
            }
            
            // 3. Проверяем фигуры, только если не обнаружили сигнал в других источниках
            if (!signalDetected && strategyInstance.graphic && strategyInstance.graphic.shapes && 
                strategyInstance.graphic.shapes.length > 0) {
                
                // Получаем только свежие фигуры, созданные после запуска сервера
                const recentShapes = strategyInstance.graphic.shapes
                    .filter(shape => {
                        const shapeTime = shape.time ? shape.time * 1000 : timestamp;
                        return shapeTime >= SERVER_START_TIME && (timestamp - shapeTime) <= SIGNAL_FRESHNESS;
                    })
                    .sort((a, b) => {
                        const timeA = a.time ? a.time * 1000 : 0;
                        const timeB = b.time ? b.time * 1000 : 0;
                        return timeB - timeA || b.id - a.id;
                    })
                    .slice(0, 1); // Берем только самую последнюю фигуру
                
                if (recentShapes.length > 0) {
                    const shape = recentShapes[0];
                    const shapeTime = shape.time ? shape.time * 1000 : timestamp;
                    const formattedTime = new Date(shapeTime).toLocaleTimeString();
                    
                    // Создаем уникальный ключ для отслеживания обработанных фигур
                    const shapeKey = `${shape.shape}_${symbol}_${Math.floor(shapeTime / 5000)}`;
                    
                    // Проверяем, не обрабатывали ли мы уже эту фигуру
                    if (!processedSignals[shapeKey]) {
                        console.log(`🔶 Обработка свежей фигуры: ${shape.shape} (${formattedTime})`);
                        
                        // Сохраняем информацию о том, что эта фигура была обработана
                        processedSignals[shapeKey] = {
                            time: shapeTime,
                            processed: timestamp
                        };
                        
                        // Проверяем тип фигуры для определения сигнала
                        if (shape.shape === 'triangleup' || shape.shape === 'arrowup') {
                            console.log('🟢 Обнаружен BUY сигнал в фигуре');
                            const signal = {
                                id: generateId(),
                                time: shapeTime,
                                symbol: symbol,
                                type: 'BUY',
                                price: currentPrice,
                                source: 'Фигура на графике',
                                status: 'pending',
                                isRealTime: true
                            };
                            processSignal(signal);
                        } 
                        else if (shape.shape === 'triangledown' || shape.shape === 'arrowdown') {
                            console.log('🔴 Обнаружен SELL сигнал в фигуре');
                            const signal = {
                                id: generateId(),
                                time: shapeTime,
                                symbol: symbol,
                                type: 'SELL',
                                price: currentPrice,
                                source: 'Фигура на графике',
                                status: 'pending',
                                isRealTime: true
                            };
                            processSignal(signal);
                        }
                        else if (shape.shape === 'xcross' || shape.shape === 'cross' || 
                                (shape.text && (
                                    shape.text.toUpperCase().includes('CLOSE') || 
                                    shape.text.toUpperCase().includes('EXIT') ||
                                    (shape.text.toUpperCase().includes('ENTRY') && shape.text.toUpperCase().includes('ORDER'))
                                ))) {
                            // Проверяем, есть ли открытая позиция для закрытия
                            if (currentPositions[symbol]) {
                                const positionType = currentPositions[symbol].type;
                                const shapeTextInfo = shape.text ? ` с текстом "${shape.text}"` : '';
                                console.log(`🔵 Обнаружен CLOSE сигнал в фигуре${shapeTextInfo}`);
                                
                                // Определяем тип закрываемой позиции из текста фигуры (если есть)
                                const targetPositionType = shape.text ? 
                                    (shape.text.toUpperCase().includes('LONG') ? 'LONG' : 
                                     shape.text.toUpperCase().includes('SHORT') ? 'SHORT' : null) : null;
                                
                                // Проверяем соответствие типа
                                let shouldClose = true;
                                if (targetPositionType && targetPositionType !== positionType) {
                                    shouldClose = false;
                                    console.log(`⚠️ Фигура для закрытия ${targetPositionType}, но открыта ${positionType} позиция`);
                                }
                                
                                if (shouldClose) {
                                    const signal = {
                                        id: generateId(),
                                        time: shapeTime,
                                        symbol: symbol,
                                        type: 'CLOSE',
                                        price: currentPrice,
                                        source: `Фигура закрытия${shape.text ? `: ${shape.text}` : ''}`,
                                        status: 'pending',
                                        isRealTime: true,
                                        positionType: positionType
                                    };
                                    processSignal(signal);
                                }
                            } else {
                                console.log('⚠️ Игнорируем сигнал закрытия - нет открытой позиции');
                            }
                        }
                    } else {
                        console.log(`⏭️ Фигура "${shape.shape}" уже была обработана недавно`);
                    }
                }
            }
            
            // Сохраняем время последней проверки
            lastCheckTimestamp = timestamp;
            
    } catch (error) {
            console.error('❌ Ошибка при обработке сигналов стратегии:', error);
    }
}

    // Обработка сигналов стратегии
function processSignal(signal) {
    try {
            // Проверяем валидность сигнала
            if (!signal || !signal.type || !signal.symbol) {
                console.log('⚠️ Получен некорректный сигнал:', signal);
                return;
            }
        
            const symbol = signal.symbol;
            const timestamp = Date.now();
            const signalTime = new Date(signal.time).toLocaleTimeString();
            
            // Генерируем уникальный ключ для отслеживания обработанных сигналов
            // Используем сочетание символа, типа и времени с точностью до 5 секунд
            const signalKey = `${symbol}_${signal.type}_${Math.floor(signal.time / 5000)}`;
            
            console.log(`\n👉 СИГНАЛ: ${signal.type} для ${symbol} @ ${signalTime} (${signal.source})`);
            
            // Проверяем, не обрабатывали ли мы уже этот сигнал
            if (processedSignals[signalKey]) {
                console.log(`⏭️ Сигнал уже был обработан недавно. Пропускаем.`);
                signal.status = 'ignored';
                return signal;
            }
            
            // Проверяем "свежесть" сигнала
            const SIGNAL_MAX_AGE = settings.monitoring.signalFreshness || 60000; // 1 минута по умолчанию
            if (timestamp - signal.time > SIGNAL_MAX_AGE) {
                console.log(`⏭️ Сигнал устарел (${Math.floor((timestamp - signal.time)/1000)}с). Пропускаем.`);
                signal.status = 'ignored';
                return signal;
            }
            
            // Проверяем, что сигнал не старше SERVER_START_TIME
            if (signal.time < SERVER_START_TIME) {
                console.log(`⏭️ Сигнал получен до запуска сервера (${new Date(SERVER_START_TIME).toLocaleTimeString()}). Пропускаем.`);
                signal.status = 'ignored';
                return signal;
            }
            
            // Проверяем период охлаждения между сигналами
            const COOLDOWN_PERIOD = settings.monitoring.cooldownPeriod || 0;
            if (COOLDOWN_PERIOD > 0) {
                const lastPositionChangeTime = currentPositions[symbol]?.openTime || 0;
                if (lastPositionChangeTime > 0) {
                    const timeSinceLastChange = timestamp - lastPositionChangeTime;
                    if (timeSinceLastChange < COOLDOWN_PERIOD) {
                        console.log(`⏳ Активен период охлаждения (${Math.floor(timeSinceLastChange/1000)}с из ${COOLDOWN_PERIOD/1000}с). Пропускаем.`);
                        signal.status = 'ignored';
                        return signal;
                    }
                }
            }
            
            // Сохраняем информацию о том, что этот сигнал был обработан
            processedSignals[signalKey] = {
                time: signal.time,
                processed: timestamp
            };
            
            // Очищаем старые обработанные сигналы (старше 5 минут)
            const fiveMinutesAgo = timestamp - 5 * 60 * 1000;
            Object.keys(processedSignals).forEach(key => {
                if (processedSignals[key].time < fiveMinutesAgo) {
                    delete processedSignals[key];
                }
            });
            
            // Обработка сигналов BUY/SELL/CLOSE
            if (signal.type === 'BUY' || signal.type === 'SELL') {
                const targetPositionType = signal.type === 'BUY' ? 'LONG' : 'SHORT';
                const currentPositionType = currentPositions[symbol] ? currentPositions[symbol].type : null;
                
                // Уже в запрашиваемой позиции - игнорируем
                if (currentPositionType === targetPositionType) {
                    console.log(`⚠️ Уже находимся в ${targetPositionType} позиции по ${symbol}. Игнорируем сигнал.`);
                    signal.status = 'ignored';
                    return signal;
                }
                
                // Проверяем существующую позицию на минимальное время удержания (если настроено)
                const MIN_POSITION_HOLD_TIME = settings.monitoring.minPositionHoldTime || 0; // в миллисекундах
                if (currentPositionType && MIN_POSITION_HOLD_TIME > 0) {
                    const openTime = currentPositions[symbol].openTime || 0;
                    const timeInPosition = timestamp - openTime;
                    
                    if (timeInPosition < MIN_POSITION_HOLD_TIME) {
                        console.log(`⏳ Позиция ${currentPositionType} открыта менее минимального времени удержания (${Math.floor(timeInPosition/1000)}с из ${MIN_POSITION_HOLD_TIME/1000}с). Игнорируем.`);
                        signal.status = 'ignored';
                        return signal;
                    }
                }
                
                // Если есть открытая позиция другого типа - закрываем её
                if (currentPositionType) {
                    console.log(`🔄 Находимся в ${currentPositionType} позиции. Закрываем перед новым входом в ${targetPositionType}.`);
                    
                    // Создаем и обрабатываем сигнал на закрытие текущей позиции
                    const closeSignal = {
                        id: generateId(),
                        time: signal.time,
                        symbol: symbol,
                        type: 'CLOSE',
                        price: signal.price,
                        source: `Автоматическое закрытие перед ${signal.type}`,
                        status: 'pending',
                        isRealTime: signal.isRealTime
                    };
                    
            // Закрываем текущую позицию
                    const closeResult = closePosition(closeSignal);
                    closeSignal.status = 'accepted';
                    
                    // Добавляем сигнал закрытия в историю
                    signals.unshift(closeSignal);
                    
                    // Ограничиваем размер истории
                    if (signals.length > MAX_SIGNALS) {
                        signals = signals.slice(0, MAX_SIGNALS);
                    }
                    
                    // Отправляем оповещение только если это реальный сигнал и уведомления включены
                    if (signal.isRealTime && settings.telegram.sendNotifications) {
                        sendTelegramAlert(closeSignal);
                    }
                    
                    // Обновляем интерфейс
                    io.emit('signal', closeSignal);
                }
                
                // Открываем новую позицию
                openPosition(signal);
                signal.status = 'accepted';
            }
            else if (signal.type === 'CLOSE') {
                // Проверяем, есть ли открытая позиция для закрытия
                if (currentPositions[symbol]) {
                    // Более надежное определение типа позиции из сигнала
                    const sourceText = (signal.source || '').toUpperCase();
                    const targetPositionType = signal.positionType || 
                                             (sourceText.includes('LONG') ? 'LONG' : 
                                              sourceText.includes('SHORT') ? 'SHORT' : null);
                    
                    // Добавляем больше логов для диагностики
                    console.log(`🔎 Обрабатываем закрытие позиции. Сигнал: ${JSON.stringify(signal)}`);
                    console.log(`🔎 Текущая позиция: ${currentPositions[symbol].type}, Целевая позиция из сигнала: ${targetPositionType}`);
                    
                    // Если указан тип позиции, но он не соответствует открытой позиции, игнорируем сигнал
                    if (targetPositionType && targetPositionType !== currentPositions[symbol].type) {
                        console.log(`⚠️ Сигнал для закрытия ${targetPositionType}, но открыта ${currentPositions[symbol].type} позиция. Игнорируем.`);
                        signal.status = 'ignored';
                        return signal;
                    }
                    
                    // Проверяем минимальное время удержания позиции
                    const MIN_POSITION_HOLD_TIME = settings.monitoring.minPositionHoldTime || 0;
                    if (MIN_POSITION_HOLD_TIME > 0) {
                        const openTime = currentPositions[symbol].openTime || 0;
                        const timeInPosition = timestamp - openTime;
                        
                        if (timeInPosition < MIN_POSITION_HOLD_TIME) {
                            console.log(`⏳ Позиция открыта менее минимального времени удержания (${Math.floor(timeInPosition/1000)}с из ${MIN_POSITION_HOLD_TIME/1000}с). Игнорируем закрытие.`);
                            signal.status = 'ignored';
                            return signal;
                        }
                    }
                    
                    console.log(`✅ Закрываем ${currentPositions[symbol].type} позицию по ${symbol} по цене ${signal.price}`);
                    closePosition(signal);
                    signal.status = 'accepted';
                } else {
                    console.log(`⚠️ Нет открытой позиции по ${symbol} для закрытия. Игнорируем сигнал.`);
                    signal.status = 'ignored';
                }
            }
            else {
                console.log(`⚠️ Неизвестный тип сигнала: ${signal.type}. Игнорируем.`);
                signal.status = 'ignored';
            }
            
            // Отправляем оповещение в Telegram, только если сигнал релевантный и уведомления включены
            if (signal.isRealTime && signal.status === 'accepted' && settings.telegram.sendNotifications) {
        sendTelegramAlert(signal);
    }
    
            // Если сигнал обработан, сохраняем его в историю
            if (signal.status === 'accepted') {
                // Добавляем сигнал в историю
                signals.unshift(signal);
                
                // Ограничиваем размер истории
                if (signals.length > MAX_SIGNALS) {
                    signals = signals.slice(0, MAX_SIGNALS);
                }
                
                // Обновляем интерфейс
    io.emit('signal', signal);
            }
            
            return signal;
            
    } catch (error) {
            console.error('❌ Ошибка при обработке сигнала:', error);
            signal.status = 'error';
            signal.error = error.message;
            return signal;
        }
    }

    // Открытие позиции
    function openPosition(signal) {
        try {
            // Проверяем, нет ли уже открытой позиции для этого инструмента
            if (currentPositions[signal.symbol]) {
                console.log(`Уже есть открытая позиция для ${signal.symbol}`);
                return false;
            }
            
            // Создаем новую позицию
            const positionType = signal.type === 'BUY' ? 'LONG' : 'SHORT';
            currentPositions[signal.symbol] = {
                symbol: signal.symbol,
                type: positionType,
                price: signal.price,
                time: signal.time || Date.now(),
                source: signal.source || 'Стратегия',
                openTimeFormatted: new Date(signal.time || Date.now()).toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                })
            };
            
            // Отправляем обновленные данные на клиенты
            io.emit('position', {
                symbol: signal.symbol,
                type: positionType,
                openPrice: signal.price,
                openTime: currentPositions[signal.symbol].time,
                openTimeFormatted: currentPositions[signal.symbol].openTimeFormatted,
                currentPrice: signal.price,
                source: signal.source || 'Стратегия',
                status: 'open'
            });
            
            // Обновляем статистику
            updateStatistics();
            
            console.log(`Позиция открыта для ${signal.symbol} (${positionType}) по цене ${signal.price}`);
            
            return true;
        } catch (error) {
            console.error('Ошибка при открытии позиции:', error);
            return false;
        }
}

// Закрытие позиции
    function closePosition(signal) {
        try {
            // Проверяем, есть ли открытые позиции для этого инструмента
            const positionInfo = currentPositions[signal.symbol];
            if (!positionInfo) {
                console.log(`Нет открытых позиций для ${signal.symbol}`);
                return false;
            }
            
            // Получаем текущее время
            const closeTime = Date.now();
            
        // Рассчитываем P&L
            const openPrice = positionInfo.price;
            const closePrice = signal.price;
            const positionType = positionInfo.type;
        let pnl = 0;
            let pnlPercent = 0;
            
            if (positionType === 'LONG') {
                pnl = closePrice - openPrice;
                pnlPercent = (pnl / openPrice) * 100;
        } else {
                pnl = openPrice - closePrice;
                pnlPercent = (pnl / openPrice) * 100;
            }
            
            // Форматируем P&L для отображения
            const pnlDisplay = `${pnl > 0 ? '+' : ''}${pnl.toFixed(2)} USDT`;
            const pnlPercentDisplay = `${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`;
            
            // Отслеживаем время в позиции
            const openTime = positionInfo.time;
            const timeInPosition = closeTime - openTime;
            const timeInPositionDisplay = formatTimeInterval(timeInPosition);
            
            // Обновляем статистику P&L
            statistics.totalPnl += pnl;
            
            if (pnl > 0) {
                statistics.profitTrades++;
                statistics.totalProfit += pnl;
            } else {
                statistics.lossTrades++;
                statistics.totalLoss += Math.abs(pnl);
            }
            
            // Создаем запись истории позиции
            const position = {
                id: generateId(),
                symbol: signal.symbol,
                type: positionType,
                openTime: openTime,
                closeTime: closeTime,
                openPrice: openPrice,
                closePrice: closePrice,
                pnl: pnl,
                pnlPercent: pnlPercent,
                pnlDisplay: pnlDisplay,
                pnlPercentDisplay: pnlPercentDisplay,
                timeInPosition: timeInPosition,
                timeInPositionDisplay: timeInPositionDisplay,
                source: positionInfo.source,
                openTimeFormatted: new Date(openTime).toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                closeTimeFormatted: new Date(closeTime).toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                closeSignalType: signal.type || 'CLOSE'
            };
            
            // Добавляем запись в историю позиций и удаляем из открытых
            positionHistory.unshift(position);
            delete currentPositions[signal.symbol];
            
            // Сохраняем обновленную историю позиций
            savePositionHistory();
            
            // Отправляем обновленные данные на клиенты
            io.emit('positionHistory', positionHistory);
            
            // Обновляем статистику
            updateStatistics();
            
            console.log(`Позиция закрыта для ${signal.symbol} с P&L: ${pnlDisplay} (${pnlPercentDisplay})`);
            console.log(`Время в позиции: ${timeInPositionDisplay}`);
            
            return true;
        } catch (error) {
            console.error('Ошибка при закрытии позиции:', error);
            return false;
        }
    }
    
    // Форматирование временного интервала
    function formatTimeInterval(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) {
            return `${days} д ${hours % 24} ч`;
        } else if (hours > 0) {
            return `${hours} ч ${minutes % 60} мин`;
        } else if (minutes > 0) {
            return `${minutes} мин ${seconds % 60} сек`;
        } else {
            return `${seconds} сек`;
        }
    }

    // Добавляем сигнал в список
function addSignal(signal) {
    signals.unshift(signal);
    
    // Ограничиваем количество сигналов
    if (signals.length > MAX_SIGNALS) {
        signals = signals.slice(0, MAX_SIGNALS);
    }
    
    // Обновляем статистику
    updateStatistics();
}

// Обновление статистики
function updateStatistics() {
    // Обновляем количество сигналов за сегодня
    const today = new Date().toDateString();
    statistics.signalsToday = signals.filter(signal => new Date(signal.time).toDateString() === today).length;
    
    // Отправляем обновленную статистику
    io.emit('statistics', statistics);
}

// Отправка уведомления в Telegram
function sendTelegramAlert(signal) {
    try {
    if (!settings.telegram.botToken || !settings.telegram.chatId) {
            console.log('⚠️ Telegram токен или chat ID не настроены. Уведомление не отправлено.');
        return;
    }
    
        if (!settings.telegram.sendNotifications) {
            console.log('ℹ️ Отправка уведомлений отключена в настройках.');
            return;
        }

        if (!signal || !signal.type || !signal.symbol) {
            console.log('⚠️ Некорректный сигнал для отправки уведомления:', signal);
            return;
        }

        const TelegramBot = require('node-telegram-bot-api');
        const bot = new TelegramBot(settings.telegram.botToken);

        // Форматирование даты/времени
        const timestamp = signal.time ? new Date(signal.time) : new Date();
        const formattedTime = timestamp.toLocaleString('ru-RU', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        // Определяем тип сигнала и позиции
        let messageTitle = '';
        let messageEmoji = '';
        let messageColor = '';
        let additionalInfo = '';
        
        // Получаем данные о позиции и ПнЛ, если доступны
        const position = currentPositions[signal.symbol] || {};
        const positionHistory = getValidatedPositionHistory().find(p => 
            p.symbol === signal.symbol && Math.abs(p.closeTime - signal.time) < 5000
        );
        
        // Рассчитываем PnL для закрытых позиций
        let pnlInfo = '';
        if (signal.type === 'CLOSE' && positionHistory) {
            const pnlPercent = positionHistory.pnlPercent || 0;
            const pnlColor = pnlPercent >= 0 ? '🟢' : '🔴';
            pnlInfo = `\n💰 P&L: ${pnlColor} ${pnlPercent.toFixed(2)}%`;
            
            // Добавляем информацию о времени в позиции
            if (positionHistory.timeInPositionDisplay) {
                pnlInfo += `\n⏱️ Время в позиции: ${positionHistory.timeInPositionDisplay}`;
            }
        }
        
        switch (signal.type) {
            case 'BUY':
                messageTitle = '🟢 ОТКРЫТИЕ LONG ПОЗИЦИИ';
                messageEmoji = '📈';
                messageColor = '#4CAF50'; // Зеленый
                break;
                
            case 'SELL':
                messageTitle = '🔴 ОТКРЫТИЕ SHORT ПОЗИЦИИ';
                messageEmoji = '📉';
                messageColor = '#F44336'; // Красный
                break;
                
            case 'CLOSE':
                const positionType = position.type || (signal.positionType || '');
                messageTitle = `🔵 ЗАКРЫТИЕ ${positionType} ПОЗИЦИИ`;
                messageEmoji = '🎯';
                messageColor = '#2196F3'; // Синий
                break;
                
            default:
                messageTitle = '⚠️ СИГНАЛ НЕИЗВЕСТНОГО ТИПА';
                messageEmoji = '❓';
                messageColor = '#FF9800'; // Оранжевый
        }
        
        // Добавляем информацию о цене
        const price = signal.price ? 
            (typeof signal.price === 'number' ? signal.price.toFixed(8) : signal.price) : 
            'N/A';
            
        // Строим сообщение в формате HTML
        let message = `
<b>${messageTitle}</b> ${messageEmoji}

🏦 <b>Инструмент:</b> ${signal.symbol}
💵 <b>Цена:</b> ${price}
🕒 <b>Время:</b> ${formattedTime}
📋 <b>Источник:</b> ${signal.source || 'TradingView сигнал'}
${pnlInfo}

<i>TV-Monitor Bot</i>
`;
        
        // Отправляем сообщение
        bot.sendMessage(settings.telegram.chatId, message, { 
            parse_mode: 'HTML',
            disable_web_page_preview: true
        }).then(() => {
            console.log('✅ Telegram уведомление отправлено успешно');
            // Увеличиваем счетчик отправленных уведомлений
            statistics.notificationsSent++;
        }).catch(error => {
            console.error('❌ Ошибка при отправке Telegram уведомления:', error.message);
        });
        
    } catch (error) {
        console.error('❌ Ошибка в функции sendTelegramAlert:', error);
    }
}

// Функция для получения времени в позиции
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

// Генерация уникального ID
function generateId() {
        return Math.random().toString(36).substring(2, 15) + 
               Math.random().toString(36).substring(2, 15);
}

// Сохранение настроек в файл
function saveSettings() {
    try {
        const settingsJson = JSON.stringify(settings, null, 2);
        fs.writeFileSync(path.join(__dirname, 'settings.json'), settingsJson);
        console.log('Настройки сохранены в файл settings.json');
    } catch (error) {
        console.error('Ошибка при сохранении настроек:', error);
    }
}

// Загрузка настроек из файла
function loadSettings() {
    try {
        // Сначала пробуем загрузить настройки из файла settings.json
        const filePath = path.join(__dirname, 'settings.json');
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const savedSettings = JSON.parse(fileContent);
            console.log('Загружены настройки из файла');
            
            // Объединяем загруженные настройки с настройками по умолчанию
            settings.tradingViewApi = { ...settings.tradingViewApi, ...savedSettings.tradingViewApi };
            settings.telegram = { ...settings.telegram, ...savedSettings.telegram };
            settings.monitoring = { ...settings.monitoring, ...savedSettings.monitoring };
        }
        
        // Затем загружаем переменные окружения, которые имеют приоритет над файлом настроек
        // TradingView API
        if (process.env.SESSION) settings.tradingViewApi.session = process.env.SESSION;
        if (process.env.SIGNATURE) settings.tradingViewApi.signature = process.env.SIGNATURE;
        if (process.env.STRATEGY_ID) settings.tradingViewApi.strategyId = process.env.STRATEGY_ID;
        
        // Telegram
        if (process.env.TELEGRAM_BOT_TOKEN) settings.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (process.env.TELEGRAM_CHAT_ID) settings.telegram.chatId = process.env.TELEGRAM_CHAT_ID;
        if (process.env.SEND_NOTIFICATIONS !== undefined) 
            settings.telegram.sendNotifications = process.env.SEND_NOTIFICATIONS.toLowerCase() === 'true';
        
        // Мониторинг
        if (process.env.MARKET) settings.monitoring.market = process.env.MARKET;
        if (process.env.TIMEFRAME) settings.monitoring.timeframe = process.env.TIMEFRAME;
        if (process.env.COOLDOWN_PERIOD) 
            settings.monitoring.cooldownPeriod = parseInt(process.env.COOLDOWN_PERIOD);
        if (process.env.SIGNAL_FRESHNESS) 
            settings.monitoring.signalFreshness = parseInt(process.env.SIGNAL_FRESHNESS);
        if (process.env.CHECK_INTERVAL) 
            settings.monitoring.checkInterval = parseInt(process.env.CHECK_INTERVAL);
        if (process.env.MIN_POSITION_HOLD_TIME) 
            settings.monitoring.minPositionHoldTime = parseInt(process.env.MIN_POSITION_HOLD_TIME);
        
        // Обновляем глобальные переменные на основе настроек
        currentSymbol = settings.monitoring.market;
        currentTimeframe = settings.monitoring.timeframe;
        
        console.log('Настройки успешно загружены');
        return true;
    } catch (error) {
        console.error('Ошибка при загрузке настроек:', error);
        return false;
    }
}

// Загружаем настройки при запуске
loadSettings();

// Запускаем сервер
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    
    // Инициализируем подключение к TradingView, если указаны настройки
    if (settings.tradingViewApi.session && settings.tradingViewApi.signature) {
        initTradingView()
            .then(() => console.log('TradingView подключение успешно установлено'))
            .catch(error => console.error('Ошибка при подключении к TradingView:', error));
    } else {
        console.log('TradingView API не настроен. Ожидание подключения клиента...');
    }
}); 

    async function startMonitoring(settings) {
        try {
            console.log('🚀 Запуск мониторинга...');

            // Инициализируем клиент
            const client = await initTradingViewClient(settings);

            // Создаем чарт
            const chart = await createChart(client, settings);

            // Загружаем стратегию
            console.log('📊 Загрузка стратегии...');
            const strategy = await TradingView.getIndicator(settings.tradingViewApi.strategyId);
            
            if (!strategy) {
                throw new Error('Не удалось загрузить стратегию');
            }

            console.log('✅ Стратегия успешно загружена:', strategy.description);

            // Создаем экземпляр стратегии
            const strategyInstance = new chart.Study(strategy);

            // Настраиваем обработчики событий стратегии
            strategyInstance.onUpdate(() => {
                try {
                    checkForSignals(strategyInstance, chart, strategy.description);
                } catch (error) {
                    console.error('❌ Ошибка при обработке обновления стратегии:', error.message);
                }
            });

            strategyInstance.onError((...err) => {
                console.error('❌ Ошибка стратегии:', ...err);
            });

            return {
                client,
                chart,
                strategyInstance
            };
        } catch (error) {
            console.error('❌ Ошибка при запуске мониторинга:', error.message);
            throw error;
        }
    }

    // Функция для получения статуса позиций
    function getPositionsStatus() {
        // Обрабатываем текущие позиции перед отправкой
        const validatedPositions = Object.values(currentPositions).map(position => {
            // Создаем копию позиции для изменений
            const validatedPosition = { ...position };
            
            // Проверяем и исправляем дату открытия
            try {
                if (!validatedPosition.openTimeFormatted || validatedPosition.openTimeFormatted === 'Invalid Date') {
                    const timestamp = validatedPosition.openTime || Date.now();
                    const date = new Date(timestamp);
                    if (!isNaN(date.getTime())) {
                        validatedPosition.openTimeFormatted = date.toLocaleString('ru-RU', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                        });
                        validatedPosition.openTime = date.getTime();
                    } else {
                        const now = new Date();
                        validatedPosition.openTimeFormatted = now.toLocaleString('ru-RU');
                        validatedPosition.openTime = now.getTime();
                    }
                }
            } catch (e) {
                console.error('Ошибка при обработке даты открытия:', e);
                const now = new Date();
                validatedPosition.openTimeFormatted = now.toLocaleString('ru-RU');
                validatedPosition.openTime = now.getTime();
            }
            
            // Проверяем и исправляем цену открытия
            if (validatedPosition.openPrice === undefined || isNaN(validatedPosition.openPrice) || validatedPosition.openPrice <= 0) {
                validatedPosition.openPrice = validatedPosition.currentPrice || 0;
            }
            
            // Проверяем и исправляем текущую цену
            if (validatedPosition.currentPrice === undefined || isNaN(validatedPosition.currentPrice) || validatedPosition.currentPrice <= 0) {
                validatedPosition.currentPrice = validatedPosition.openPrice || 0;
            }
            
            // Рассчитываем P&L с защитой от NaN
            if (validatedPosition.openPrice > 0 && validatedPosition.currentPrice > 0) {
                let pnlPercent = 0;
                if (validatedPosition.type === 'LONG') {
                    pnlPercent = ((validatedPosition.currentPrice - validatedPosition.openPrice) / validatedPosition.openPrice) * 100;
                } else if (validatedPosition.type === 'SHORT') {
                    pnlPercent = ((validatedPosition.openPrice - validatedPosition.currentPrice) / validatedPosition.openPrice) * 100;
                }
                validatedPosition.pnlPercent = pnlPercent;
                validatedPosition.pnlDisplay = pnlPercent.toFixed(2) + '%';
            } else {
                validatedPosition.pnlPercent = 0;
                validatedPosition.pnlDisplay = '0.00%';
            }
            
            // Рассчитываем время в позиции
            try {
                const openTime = validatedPosition.openTime || Date.now();
                const now = Date.now();
                const timeInPosition = now - openTime;
                validatedPosition.timeInPosition = timeInPosition;
                validatedPosition.timeInPositionDisplay = formatTimeInterval(timeInPosition);
            } catch (e) {
                console.error('Ошибка при расчете времени в позиции:', e);
                validatedPosition.timeInPosition = 0;
                validatedPosition.timeInPositionDisplay = '0 сек';
            }
            
            return validatedPosition;
        });
        
        return {
            positions: validatedPositions,
            activeCount: validatedPositions.length
        };
    }

    // Функция для валидации истории позиций
    function getValidatedPositionHistory() {
        return positionHistory.map(position => {
            // Создаем копию позиции для изменений
            const validatedPosition = { ...position };
            
            // Проверяем и исправляем дату открытия
            try {
                if (!validatedPosition.openTimeFormatted || validatedPosition.openTimeFormatted === 'Invalid Date') {
                    const timestamp = validatedPosition.openTime || Date.now() - 3600000; // По умолчанию час назад
                    const date = new Date(timestamp);
                    validatedPosition.openTimeFormatted = !isNaN(date.getTime()) ? 
                        date.toLocaleString() : new Date(Date.now() - 3600000).toLocaleString();
                    validatedPosition.openTime = !isNaN(date.getTime()) ? 
                        date.getTime() : Date.now() - 3600000;
                }
            } catch (e) {
                console.error('Ошибка при обработке даты открытия в истории:', e);
                validatedPosition.openTimeFormatted = new Date(Date.now() - 3600000).toLocaleString();
                validatedPosition.openTime = Date.now() - 3600000;
            }
            
            // Проверяем и исправляем дату закрытия
            try {
                if (!validatedPosition.closeTimeFormatted || validatedPosition.closeTimeFormatted === 'Invalid Date') {
                    const timestamp = validatedPosition.closeTime || Date.now();
                    const date = new Date(timestamp);
                    validatedPosition.closeTimeFormatted = !isNaN(date.getTime()) ? 
                        date.toLocaleString() : new Date().toLocaleString();
                    validatedPosition.closeTime = !isNaN(date.getTime()) ? 
                        date.getTime() : Date.now();
                }
            } catch (e) {
                console.error('Ошибка при обработке даты закрытия в истории:', e);
                validatedPosition.closeTimeFormatted = new Date().toLocaleString();
                validatedPosition.closeTime = Date.now();
            }
            
            // Проверяем и исправляем цену открытия
            if (validatedPosition.openPrice === undefined || isNaN(validatedPosition.openPrice)) {
                validatedPosition.openPrice = validatedPosition.closePrice || 0;
            }
            
            // Проверяем и исправляем цену закрытия
            if (validatedPosition.closePrice === undefined || isNaN(validatedPosition.closePrice)) {
                validatedPosition.closePrice = validatedPosition.openPrice || 0;
            }
            
            // Рассчитываем P&L с защитой от NaN
            if (validatedPosition.pnlPercent === undefined || isNaN(validatedPosition.pnlPercent)) {
                if (validatedPosition.openPrice && validatedPosition.closePrice && 
                    !isNaN(validatedPosition.openPrice) && !isNaN(validatedPosition.closePrice) && 
                    validatedPosition.openPrice > 0) {
                    let pnlPercent = 0;
                    if (validatedPosition.type === 'LONG') {
                        pnlPercent = ((validatedPosition.closePrice - validatedPosition.openPrice) / validatedPosition.openPrice) * 100;
                    } else {
                        pnlPercent = ((validatedPosition.openPrice - validatedPosition.closePrice) / validatedPosition.openPrice) * 100;
                    }
                    validatedPosition.pnlPercent = pnlPercent;
                    validatedPosition.pnlDisplay = pnlPercent.toFixed(2) + '%';
                } else {
                    validatedPosition.pnlPercent = 0;
                    validatedPosition.pnlDisplay = '0.00%';
                }
            } else if (!validatedPosition.pnlDisplay) {
                validatedPosition.pnlDisplay = validatedPosition.pnlPercent.toFixed(2) + '%';
            }
            
            // Проверяем время в позиции
            if (!validatedPosition.timeInPositionDisplay) {
                try {
                    const openTime = validatedPosition.openTime || (validatedPosition.closeTime - 3600000);
                    const closeTime = validatedPosition.closeTime || Date.now();
                    const timeInPosition = closeTime - openTime;
                    validatedPosition.timeInPosition = timeInPosition;
                    validatedPosition.timeInPositionDisplay = formatTimeInterval(timeInPosition);
                } catch (e) {
                    console.error('Ошибка при расчете времени в позиции в истории:', e);
                    validatedPosition.timeInPosition = 0;
                    validatedPosition.timeInPositionDisplay = '0 сек';
                }
            }
            
            return validatedPosition;
        });
    }

// Форматирование времени для логов
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Функция для получения данных о сделках
function getTradesData() {
    try {
        // Используем историю позиций как источник данных о сделках
        const validatedHistory = getValidatedPositionHistory();
        
        // Преобразуем историю позиций в формат сделок
        const trades = validatedHistory.map((position, index) => {
            // Создаем уникальный id для сделки, если его нет
            const tradeId = position.id || generateId();
            
            // Рассчитываем совокупную прибыль, рост и просадку
            let cumulativeProfit = 0;
            let peakProfit = 0;
            let maxDrawdown = 0;
            
            // Проходим по всем предыдущим сделкам для расчета показателей
            for (let i = validatedHistory.length - 1; i >= index; i--) {
                const p = validatedHistory[i];
                const profit = p.pnl || 0;
                
                cumulativeProfit += profit;
                
                // Обновляем пиковую прибыль
                if (cumulativeProfit > peakProfit) {
                    peakProfit = cumulativeProfit;
                }
                
                // Рассчитываем текущую просадку от пика
                const currentDrawdown = peakProfit - cumulativeProfit;
                if (currentDrawdown > maxDrawdown) {
                    maxDrawdown = currentDrawdown;
                }
            }
            
            // Определяем тип сделки (LONG/SHORT)
            let tradeType = '';
            if (position.type === 'LONG') {
                tradeType = 'LONG';
            } else if (position.type === 'SHORT') {
                tradeType = 'SHORT';
            }
            
            // Возвращаем объект сделки
            return {
                id: tradeId,
                number: validatedHistory.length - index, // Номер сделки (в обратном порядке)
                type: tradeType,
                signal: position.source || 'TradingView',
                openTime: position.openTime,
                closeTime: position.closeTime,
                openTimeFormatted: position.openTimeFormatted,
                closeTimeFormatted: position.closeTimeFormatted,
                openPrice: position.openPrice,
                closePrice: position.closePrice,
                contracts: 1, // По умолчанию 1 контракт
                profit: position.pnl || 0,
                profitPercent: position.pnlPercent || 0,
                cumulativeProfit: cumulativeProfit,
                peakProfit: peakProfit,
                maxDrawdown: maxDrawdown,
                timeInPosition: position.timeInPosition,
                timeInPositionDisplay: position.timeInPositionDisplay,
                display: {
                    profit: position.pnlDisplay || `${position.pnl > 0 ? '+' : ''}${position.pnl?.toFixed(2) || 0} USDT`,
                    profitPercent: `${position.pnlPercent > 0 ? '+' : ''}${position.pnlPercent?.toFixed(2) || 0}%`,
                    cumulativeProfit: `${cumulativeProfit > 0 ? '+' : ''}${cumulativeProfit.toFixed(2)} USDT`,
                    peakProfit: `+${peakProfit.toFixed(2)} USDT`,
                    maxDrawdown: `-${maxDrawdown.toFixed(2)} USDT`
                }
            };
        });
        
        // Возвращаем массив сделок
        return trades;
    } catch (error) {
        console.error('Ошибка при получении данных о сделках:', error);
        return [];
    }
}

// Улучшенная функция форматирования истории позиций
function formatPositionHistory() {
    return positionHistory.map(position => {
        let action;
        
        // Определяем действие более точно
        if (position.closeSignalType === 'CLOSE' || position.closeSignalType.includes('CLOSE') || position.closeSignalType.includes('EXIT')) {
            action = `Выход из ${position.type === 'LONG' ? 'длинной' : 'короткой'} позиции`;
        } else if (position.type === 'LONG') {
            action = 'Вход в длинную позицию';
        } else if (position.type === 'SHORT') {
            action = 'Вход в короткую позицию';
        } else {
            action = `${position.type} операция`;
        }

        return {
            action: action,
            type: position.type,
            time: new Date(position.openTime).toLocaleString('ru-RU', {
                day: '2-digit',
                month: 'short',
                year: 'numeric г.',
                hour: '2-digit',
                minute: '2-digit'
            }).replace(/\./g, '').replace('г', 'г.'),
            price: `${position.openPrice.toFixed(2)} USDT`,
            pnl: position.pnl.toFixed(1),
            source: position.source || 'Н/Д'
        };
    }).reverse(); // Чтобы новые сделки были сверху
}
