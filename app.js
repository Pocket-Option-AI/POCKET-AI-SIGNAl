// --- APP STATE & AUTHENTICATION ---
let state = {
    userId: null, 
    account: 'demo', 
    balances: { demo: 0, real: 0 },
    activeTrades: [],
    history: [],
    currentPair: 'EUR/USD',
    currentPayout: 92
};

const canvas = document.getElementById('tradingChart');
const ctx = canvas.getContext('2d');
let width, height;
let prices = [];
let timestamps = [];
let maxPoints = 80; 
let currentPrice = 1.08500;
let isChartRunning = false;
let chartTags = []; 
let ws = null; 
let scrollInterval = null;
let chartType = 'line'; 
let candleData = []; 
let tickerInterval = null;
let marketInterval = null;
let payoutInterval = null;
let historyTimer = null;

// --- MENU TOGGLES ---
function toggleProfile() { 
    document.getElementById('profile-menu').classList.toggle('open'); 
    if (document.getElementById('profile-menu').classList.contains('open')) {
        fetchTodayStats();
    }
}
function toggleSocial() { document.getElementById('social-menu').classList.toggle('open'); }
function copyTrader(name) { alert(`✅ You are now copying ${name}. Trades will be mirrored to your account.`); }

// --- DYNAMIC PAYOUT ENGINE (HOT/COLD) ---
function updateDynamicPayouts() {
    let pairs = [
        { id: 'eur', min: 45, max: 94 },
        { id: 'gbp', min: 45, max: 94 },
        { id: 'jpy', min: 45, max: 94 },
        { id: 'aed', min: 45, max: 94 }
    ];
    
    pairs.forEach(p => {
        let newPayout = Math.floor(Math.random() * (p.max - p.min + 1)) + p.min;
        let el = document.getElementById(`payout-${p.id}`);
        let hotBadge = document.getElementById(`hot-${p.id}`);
        let coldBadge = document.getElementById(`cold-${p.id}`);
        
        if (el) {
            el.innerText = newPayout + "%";
            
            if (hotBadge) {
                if (newPayout >= 90) {
                    hotBadge.style.display = 'inline-block';
                    el.style.color = '#f59e0b';
                } else {
                    hotBadge.style.display = 'none';
                    el.style.color = '#22c55e';
                }
            }
            
            if (coldBadge) {
                if (newPayout < 60) {
                    coldBadge.style.display = 'inline-block';
                    el.style.color = '#38bdf8';
                } else {
                    coldBadge.style.display = 'none';
                }
            }
        }
    });
}

// --- FETCH ACTIVITIES ---
async function fetchActivities() {
    if (!state.userId) return;
    let list = document.getElementById('activities-list');
    list.innerHTML = '<p style="color: #64748b; text-align: center; font-size: 13px;">Loading...</p>';
    
    try {
        const res = await fetch(`/api/activities/${state.userId}`);
        const data = await res.json();
        if (data.success) {
            if (data.activities.length === 0) {
                list.innerHTML = '<p style="color: #64748b; text-align: center; font-size: 13px;">No recent activity.</p>';
                return;
            }
            list.innerHTML = '';
            data.activities.forEach(act => {
                list.innerHTML += `
                    <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #1e293b; font-size: 13px;">
                        <div style="display: flex; align-items: center; gap: 10px;"><span style="font-size: 16px;">${act.icon}</span><span style="color: white;">${act.action}</span></div>
                        <div style="color: #64748b; font-size: 10px; text-align: right;">${new Date(act.timestamp).toLocaleString()}</div>
                    </div>
                `;
            });
        }
    } catch (e) { console.error(e); }
}

// --- TODAY'S STATS FETCH ---
async function fetchTodayStats() {
    if (!state.userId) return;
    let accountTypeEl = document.getElementById('account-type');
    let accountType = accountTypeEl ? accountTypeEl.value : 'demo';
    try {
        const res = await fetch(`/api/today-stats/${state.userId}/${accountType}`);
        const data = await res.json();
        if (data.success) {
            document.getElementById('stat-trades').innerText = data.totalTrades;
            document.getElementById('stat-winrate').innerText = data.winRate + "%";
            let profitEl = document.getElementById('stat-profit');
            profitEl.innerText = (data.totalProfit >= 0 ? "+$" : "-$") + Math.abs(data.totalProfit);
            profitEl.style.color = data.totalProfit >= 0 ? "#22c55e" : "#ef4444";
        }
    } catch (e) { console.error("Failed to load stats:", e); }
}

// --- MARKET WATCH FETCH ---
function fetchMarketData() {
    let marketData = [
        { pair: 'EUR/USD', flag: '🇪🇺', price: 1.08500, change: (Math.random() * 2 - 1) },
        { pair: 'GBP/USD', flag: '🇬🇧', price: 1.26500, change: (Math.random() * 2 - 1) },
        { pair: 'USD/JPY', flag: '🇺🇸', price: 150.500, change: (Math.random() * 2 - 1) },
        { pair: 'AED/CNY OTC', flag: '🇦🇪', price: 1.72500, change: (Math.random() * 2 - 1) }
    ];
    if (state.currentPair === 'EUR/USD') marketData[0].price = currentPrice;
    
    let marketList = document.getElementById('market-list');
    if (!marketList) return;
    
    marketList.innerHTML = '';
    marketData.forEach(m => {
        let color = m.change >= 0 ? '#22c55e' : '#ef4444';
        let sign = m.change >= 0 ? '+' : '';
        let decimals = m.pair === 'USD/JPY' ? 3 : 5;
        
        marketList.innerHTML += `
            <div class="settings-item" onclick="changeAsset('${m.pair}', ${m.price}, 92)" style="border-bottom: 1px solid #1e293b; padding: 15px 0;">
                <div style="display: flex; align-items: center; gap: 10px;"><span style="font-size: 20px;">${m.flag}</span><div><div style="font-weight: bold; color: white;">${m.pair}</div><div style="font-size: 12px; color: #94a3b8;">${m.price.toFixed(decimals)}</div></div></div>
                <div style="text-align: right;"><span style="color: ${color}; font-weight: bold; font-size: 14px;">${sign}${m.change.toFixed(2)}%</span><div style="font-size: 10px; color: #64748b;">Today</div></div>
            </div>
        `;
    });
}

// --- PROGRESS STATS FETCH ---
async function fetchProgressStats() {
    if (!state.userId) return;
    let accountTypeEl = document.getElementById('account-type');
    let accountType = accountTypeEl ? accountTypeEl.value : 'demo';
    
    try {
        const res = await fetch(`/api/progress-stats/${state.userId}/${accountType}`);
        const data = await res.json();
        if (data.success) {
            document.getElementById('prog-best').innerText = "$" + data.bestTrade;
            document.getElementById('prog-volume').innerText = "$" + data.totalVolume;
            document.getElementById('prog-streak').innerText = data.maxStreak;
            document.getElementById('prog-wins').innerText = data.totalWins;
            
            let chartDiv = document.getElementById('prog-chart');
            chartDiv.innerHTML = '';
            let maxProfit = Math.max(...data.last7Days.map(d => Math.abs(d.profit)), 10);
            
            data.last7Days.forEach(day => {
                let heightPercent = (Math.abs(day.profit) / maxProfit) * 100;
                if (heightPercent < 5) heightPercent = 5;
                let color = day.profit >= 0 ? '#22c55e' : '#ef4444';
                
                chartDiv.innerHTML += `
                    <div style="display: flex; flex-direction: column; align-items: center; width: 12%;">
                        <div style="height: 80px; display: flex; align-items: flex-end; width: 100%; justify-content: center;"><div style="width: 80%; background: ${color}; height: ${heightPercent}%; border-radius: 2px;"></div></div>
                        <span style="font-size: 9px; color: #64748b; margin-top: 5px;">${day.date}</span>
                    </div>
                `;
            });
        }
    } catch (e) { console.error("Failed to load progress:", e); }
}

// --- FINANCE LEDGER FETCH ---
async function fetchFinanceLedger() {
    if (!state.userId) return;
    let ledgerList = document.getElementById('finance-ledger-list');
    ledgerList.innerHTML = '<p style="color: #64748b; text-align: center; font-size: 13px;">Loading...</p>';
    
    try {
        const res = await fetch(`/api/finance-ledger/${state.userId}`);
        const data = await res.json();
        if (data.success) {
            if (data.ledger.length === 0) {
                ledgerList.innerHTML = '<p style="color: #64748b; text-align: center; font-size: 13px;">No transactions yet.</p>';
                return;
            }
            ledgerList.innerHTML = '';
            data.ledger.forEach(tx => {
                let isPositive = (tx.type === 'trade' && tx.status === 'WIN') || (tx.type === 'deposit');
                let color = isPositive ? '#22c55e' : '#ef4444';
                let sign = isPositive ? '+' : '-';
                let displayAmount = tx.type === 'trade' ? (tx.status === 'WIN' ? (tx.amount * 1.92).toFixed(2) : tx.amount.toFixed(2)) : tx.amount.toFixed(2);
                let title = tx.type === 'trade' ? `Trade: ${tx.title}` : tx.title;
                let statusText = tx.type === 'trade' ? tx.status : tx.status;
                
                ledgerList.innerHTML += `
                    <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #1e293b; font-size: 12px;">
                        <div><span style="color: white; text-transform: capitalize;">${title}</span><br><span style="color: #64748b; font-size: 10px;">${new Date(tx.timestamp).toLocaleString()} • ${statusText}</span></div>
                        <div style="color: ${color}; font-weight: bold; text-align: right;">${sign}$${displayAmount}</div>
                    </div>
                `;
            });
        }
    } catch (e) { console.error(e); }
}

// --- ASSET MARKET WATCH MENU ---
function toggleAssetMenu() {
    let menu = document.getElementById('asset-menu');
    if (menu.style.bottom === '0px') { menu.style.bottom = '-100%'; } 
    else { menu.style.bottom = '0px'; updateDynamicPayouts(); }
}

function changeAsset(pair, basePrice, payout) {
    state.currentPair = pair;
    state.currentPayout = payout;
    currentPrice = basePrice;
    document.getElementById('selected-asset-name').innerText = pair;
    document.getElementById('current-pair-name').innerText = pair;
    document.getElementById('current-price-display').innerText = basePrice.toFixed(pair === 'USD/JPY' ? 3 : 5);
    toggleAssetMenu();
    closeModal('market-modal');
    initChart(); 
    document.querySelector('.profit-info').innerHTML = `<span>Payout: <strong>+${payout}%</strong></span><span>Profit: <strong id="potential-profit">+$${(1 * (payout/100)).toFixed(2)}</strong></span>`;
}

// --- LIVE TICKER ENGINE ---
const fakeUsers = ["User***92", "User***17", "Trader***4", "Pro***88", "Alex***", "Sarah***", "Crypto***1", "Forex***X"];
function startLiveTicker() {
    if (tickerInterval) clearInterval(tickerInterval);
    tickerInterval = setInterval(() => {
        let tickerEl = document.getElementById('live-ticker');
        if (!tickerEl) return;
        tickerEl.style.transition = 'none';
        tickerEl.style.right = '-100%';
        let user = fakeUsers[Math.floor(Math.random() * fakeUsers.length)];
        let amount = (Math.random() * 500 + 10).toFixed(2);
        let pair = Math.random() > 0.5 ? "EUR/USD" : "AED/CNY";
        let direction = Math.random() > 0.5 ? "BUY" : "SELL";
        let color = direction === "BUY" ? "#22c55e" : "#ef4444";
        tickerEl.innerHTML = `👤 ${user} won <span style="color: #fff;">$${amount}</span> on ${pair} (${direction}) <span style="color: ${color};">●</span>`;
        setTimeout(() => {
            tickerEl.style.transition = 'right 4s linear';
            tickerEl.style.right = '100%';
        }, 100);
    }, 3500);
}

// --- CHART TYPE TOGGLE ---
function setChartType(type) {
    chartType = type;
    let lineBtn = document.getElementById('btn-line');
    let candleBtn = document.getElementById('btn-candle');
    if (type === 'line') {
        lineBtn.style.background = '#3b82f6'; lineBtn.style.color = 'white';
        candleBtn.style.background = 'transparent'; candleBtn.style.color = '#94a3b8';
    } else {
        candleBtn.style.background = '#3b82f6'; candleBtn.style.color = 'white';
        lineBtn.style.background = 'transparent'; lineBtn.style.color = '#94a3b8';
    }
}

// --- LIVE CLOCK ---
setInterval(() => {
    let clockEl = document.getElementById('live-clock');
    if (clockEl) { clockEl.innerText = new Date().toLocaleTimeString([], { hour12: false }); }
}, 1000);

// --- AUTHENTICATION LOGIC ---
function showRegister() { document.getElementById('login-box').style.display = 'none'; document.getElementById('register-box').style.display = 'block'; }
function showLogin() { document.getElementById('register-box').style.display = 'none'; document.getElementById('login-box').style.display = 'block'; }

async function handleRegister() {
    let email = document.getElementById('register-email').value;
    let password = document.getElementById('register-pass').value;
    if (!email || !password) { alert("Please enter email and password."); return; }
    try {
        const res = await fetch('/api/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (data.success) { alert("Registration successful! Please log in."); showLogin(); } 
        else { alert("Registration failed: " + data.message); }
    } catch (e) { alert("Network error."); }
}

async function handleLogin() {
    let email = document.getElementById('login-email').value;
    let password = document.getElementById('login-pass').value;
    if (!email || !password) { alert("Please enter email and password."); return; }
    try {
        const res = await fetch('/api/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (data.success) {
            state.userId = data.userId;
            document.getElementById('auth-screen').classList.remove('active');
            document.getElementById('dashboard-screen').classList.add('active');
            document.getElementById('app-body').classList.remove('light-mode');
            loadUserData();
            loadHistory();
            startChartEngine();
            startLiveTicker();
            
            if (payoutInterval) clearInterval(payoutInterval);
            payoutInterval = setInterval(updateDynamicPayouts, 5000);

            if (historyTimer) clearInterval(historyTimer);
            historyTimer = setInterval(() => {
                renderHistory();
                updateActiveTradeBar();
            }, 1000);
        } else { alert("Login failed: " + data.message); }
    } catch (e) { alert("Network error."); }
}

function logout() { state.userId = null; location.reload(); }

async function loadUserData() {
    if (!state.userId) return;
    try {
        const res = await fetch(`/api/user-data/${state.userId}`);
        const data = await res.json();
        if (data.success) {
            state.balances.demo = data.balances.demo_balance;
            state.balances.real = data.balances.real_balance;
            updateBalanceDisplay();
        }
    } catch (e) { console.error(e); }
}

async function loadHistory() {
    if (!state.userId) return;
    try {
        const res = await fetch(`/api/trade-history/${state.userId}`);
        const data = await res.json();
        if (data.success) {
            state.history = data.history;
            renderHistory();
            renderWalletLedger();
        }
    } catch (e) { console.error("Failed to load history:", e); }
}

function updateBalanceDisplay() {
    let accountTypeEl = document.getElementById('account-type');
    if (accountTypeEl) state.account = accountTypeEl.value;
    let balance = state.balances[state.account] || 0;
    let headerBal = document.getElementById('display-balance');
    if (headerBal) headerBal.innerText = "$" + balance.toFixed(2);
    let profileBal = document.getElementById('profile-balance-text');
    if (profileBal) profileBal.innerText = "$" + balance.toFixed(2);
    let walletText = document.getElementById('wallet-balance-text');
    if (walletText) walletText.innerText = "$" + balance.toFixed(2);
}

// --- UPDATE ACTIVE FLOATING BAR ---
function updateActiveTradeBar() {
    let bar = document.getElementById('active-trade-bar');
    if (!bar) return;
    
    if (state.activeTrades.length === 0) {
        bar.style.display = 'none';
        return;
    }
    
    bar.style.display = 'block';
    let trade = state.activeTrades[0]; // Show the most recent active trade
    let timeLeft = Math.max(0, Math.ceil((trade.startTime + (trade.expiry * 1000) - Date.now()) / 1000));
    
    document.getElementById('at-pair').innerText = trade.pair;
    
    let dirEl = document.getElementById('at-dir');
    dirEl.innerText = trade.direction;
    dirEl.style.color = trade.direction === 'BUY' ? '#22c55e' : '#ef4444';
    
    document.getElementById('at-timer').innerText = `⏱ ${timeLeft}s`;
    
    // Calculate live P/L
    let currentDiff = currentPrice - trade.entryPrice;
    let isWinning = (trade.direction === 'BUY' && currentDiff > 0) || (trade.direction === 'SELL' && currentDiff < 0);
    
    // Use a simplified P/L estimate for the floating bar
    let plAmount = isWinning ? (trade.amount * 0.92) : -trade.amount;
    let plEl = document.getElementById('at-pl');
    plEl.innerText = (plAmount >= 0 ? "+$" : "-$") + Math.abs(plAmount).toFixed(2);
    plEl.style.color = plAmount >= 0 ? '#22c55e' : '#ef4444';
}

// --- TRADING LOGIC ---
async function placeTrade(direction) {
    let amount = parseFloat(document.getElementById('trade-amount').value);
    let expirySeconds = parseInt(document.getElementById('trade-expiry').value);
    let pair = state.currentPair;
    if (isNaN(amount) || amount <= 0) { alert("Please enter a valid amount."); return; }
    if (amount > state.balances[state.account]) { alert("Insufficient balance."); return; }

    try {
        const res = await fetch('/api/place-trade', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: state.userId, accountType: state.account, amount: amount, tradeData: { pair, direction, entryPrice: currentPrice, expiry: expirySeconds } })
        });
        const data = await res.json();
        
        if (!data.success) {
            alert("❌ " + data.message); 
            return;
        }

        state.balances[state.account] -= amount;
        updateBalanceDisplay();

        let trade = { id: Date.now(), pair, direction, amount, entryPrice: currentPrice, expiry: expirySeconds, status: 'OPEN', result: null, startTime: Date.now() };
        state.activeTrades.push(trade);
        chartTags.push({ type: 'entry', tradeId: trade.id, price: currentPrice, direction, amount, expiry: Date.now() + (expirySeconds * 1000) });
        renderHistory();
        updateActiveTradeBar();

        setTimeout(() => { closeTrade(trade.id); }, expirySeconds * 1000);

    } catch (e) { console.error(e); alert("Network error."); }
}

function tradeFromModal(direction) {
    closeModal('signals-modal');
    closeModal('ai-modal');
    placeTrade(direction);
}

async function closeTrade(tradeId) {
    let tradeIndex = state.activeTrades.findIndex(t => t.id === tradeId);
    if (tradeIndex === -1) return;
    let trade = state.activeTrades[tradeIndex];
    let exitPrice = currentPrice;
    chartTags = chartTags.filter(tag => tag.tradeId !== tradeId);

    try {
        const res = await fetch('/api/close-trade', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: state.userId, accountType: state.account, tradeId: trade.id, amount: trade.amount, direction: trade.direction, entryPrice: trade.entryPrice, exitPrice: exitPrice, pair: trade.pair })
        });
        const data = await res.json();
        if (data.success) {
            let payout = data.payout;
            let isWin = data.result === 'WIN';
            state.balances[state.account] += payout;
            updateBalanceDisplay();
            trade.status = 'CLOSED';
            trade.result = data.result;
            state.history.unshift(trade);
            state.activeTrades.splice(tradeIndex, 1);
            renderHistory();
            updateActiveTradeBar();
            if (isWin) {
                chartTags.push({ type: 'profit', price: exitPrice, amount: payout - trade.amount, time: Date.now() });
            }
        }
    } catch (e) { console.error("Failed to close trade:", e); }
}

function renderHistory() {
    let historyDiv = document.getElementById('history-list');
    if (state.history.length === 0 && state.activeTrades.length === 0) {
        historyDiv.innerHTML = '<div class="history-item empty">No trades yet. Place a trade to begin.</div>';
        return;
    }
    historyDiv.innerHTML = '';
    
    state.activeTrades.forEach(t => {
        let timeLeft = Math.max(0, Math.ceil((t.startTime + (t.expiry * 1000) - Date.now()) / 1000));
        historyDiv.innerHTML += `
            <div class="history-item" style="border-left: 4px solid #3b82f6;">
                <span>${t.pair} • ${t.direction} • $${t.amount.toFixed(2)}</span>
                <span style="color:#60a5fa; font-weight: bold;">⏱ ${timeLeft}s</span>
            </div>
        `;
    });

    state.history.forEach(t => {
        let cls = t.result === 'WIN' ? 'win' : 'loss';
        let color = t.result === 'WIN' ? '#22c55e' : '#ef4444';
        historyDiv.innerHTML += `<div class="history-item ${cls}"><span>${t.pair} • ${t.direction} • $${t.amount.toFixed(2)}</span><span style="color:${color}; font-weight:bold;">${t.result}</span></div>`;
    });
}

function renderWalletLedger() {
    let ledgerDiv = document.getElementById('wallet-ledger');
    if (!ledgerDiv) return;
    if (state.history.length === 0) {
        ledgerDiv.innerHTML = '<p style="color: #64748b; text-align: center; font-size: 13px;">No recent transactions.</p>';
        return;
    }
    ledgerDiv.innerHTML = '';
    state.history.forEach(t => {
        let isWin = t.result === 'WIN';
        let color = isWin ? '#22c55e' : '#ef4444';
        let sign = isWin ? '+' : '-';
        let amount = isWin ? (t.amount * 0.92).toFixed(2) : t.amount.toFixed(2);
        ledgerDiv.innerHTML += `<div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #1e293b; font-size: 12px;"><div><span style="color: white;">${t.pair} ${t.direction}</span><br><span style="color: #64748b; font-size: 10px;">${new Date(t.timestamp).toLocaleString()}</span></div><div style="color: ${color}; font-weight: bold; text-align: right;">${sign}$${amount}</div></div>`;
    });
}

// --- CHART ENGINE ---
function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width; canvas.height = rect.height;
    width = canvas.width; height = canvas.height - 20; 
}
window.addEventListener('resize', resizeCanvas);

function initChart() {
    resizeCanvas(); prices = []; timestamps = []; candleData = [];
    let now = Date.now();
    for (let i = 0; i < maxPoints; i++) { prices.push(currentPrice); timestamps.push(now - ((maxPoints - i) * 1000)); }
}

function startChartEngine() {
    initChart(); isChartRunning = true;
    if (ws) ws.close();
    if (scrollInterval) clearInterval(scrollInterval);

    // Check if it's the weekend
    let day = new Date().getDay();
    let isWeekend = (day === 0 || day === 6);
    let useSimulated = (state.currentPair !== 'EUR/USD') || isWeekend;
    
    if (!useSimulated) {
        ws = new WebSocket('wss://stream.binance.com:9443/ws/eurusdt@trade');
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.p) {
                currentPrice = parseFloat(data.p);
                let priceDisplay = document.getElementById('current-price-display');
                if (priceDisplay) priceDisplay.innerText = currentPrice.toFixed(5);
                updateLiveSlider(currentPrice);
                updateActiveTradeBar();
            }
        };
    } else {
        scrollInterval = setInterval(() => {
            let volatility = state.currentPair === 'USD/JPY' ? 0.015 : 0.00015;
            let change = (Math.random() - 0.5) * volatility * 3; 
            currentPrice += change;
            let decimals = state.currentPair === 'USD/JPY' ? 3 : 5;
            let priceDisplay = document.getElementById('current-price-display');
            if (priceDisplay) priceDisplay.innerText = currentPrice.toFixed(decimals);
            updateLiveSlider(currentPrice);
            updateActiveTradeBar();
        }, 500);
    }

    scrollInterval = setInterval(() => {
        prices.push(currentPrice); timestamps.push(Date.now());
        if (prices.length > maxPoints) { prices.shift(); timestamps.shift(); }
        if (prices.length % 5 === 0) {
            let last5 = prices.slice(-5);
            let open = last5[0]; let close = last5[last5.length - 1];
            let high = Math.max(...last5); let low = Math.min(...last5);
            candleData.push({ open, close, high, low, isUp: close >= open });
            if (candleData.length > 20) candleData.shift();
        }
        let decimals = state.currentPair === 'USD/JPY' ? 3 : 5;
        document.getElementById('live-price').innerText = `Active: ${state.activeTrades.length} | Price: ${currentPrice.toFixed(decimals)}`;
    }, 500); 

    if (prices.length > 0) requestAnimationFrame(drawChart);
}

let lastSliderPrice = currentPrice;
function updateLiveSlider(price) {
    let sliderEl = document.getElementById('payout-slider');
    let greenLabel = document.getElementById('green-percent');
    let redLabel = document.getElementById('red-percent');
    if (sliderEl && greenLabel && redLabel) {
        let currentPercent = parseFloat(sliderEl.value) || 9;
        if (price > lastSliderPrice) currentPercent += (Math.random() * 0.5); 
        else if (price < lastSliderPrice) currentPercent -= (Math.random() * 0.5); 
        if (currentPercent > 95) currentPercent = 95;
        if (currentPercent < 5) currentPercent = 5;
        sliderEl.value = currentPercent;
        greenLabel.innerText = Math.floor(currentPercent) + "%";
        redLabel.innerText = Math.floor(100 - currentPercent) + "%";
        sliderEl.style.background = `linear-gradient(to right, #22c55e ${currentPercent}%, #ef4444 ${currentPercent}%)`;
        lastSliderPrice = price;
    }
}

function drawChart() {
    if (!isChartRunning) return;
    ctx.clearRect(0, 0, width, height + 20);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)'; ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y < height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    if (prices.length === 0) { requestAnimationFrame(drawChart); return; }

    let allPrices = chartType === 'candle' && candleData.length > 0 ? candleData.flatMap(c => [c.high, c.low]) : prices;
    let minPrice = Math.min(...allPrices), maxPrice = Math.max(...allPrices);
    let priceRange = maxPrice - minPrice;
    if (priceRange === 0) priceRange = 0.001;
    let padding = priceRange * 0.1;
    minPrice -= padding; maxPrice += padding;
    let adjustedRange = maxPrice - minPrice;
    function getY(price) { return height - ((price - minPrice) / adjustedRange * height); }

    if (chartType === 'line') {
        let stepX = width / (maxPoints - 1);
        let gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, 'rgba(96, 165, 250, 0.3)'); 
        gradient.addColorStop(1, 'rgba(15, 23, 42, 0)');
        ctx.beginPath(); ctx.moveTo(0, height); 
        for (let i = 0; i < prices.length; i++) ctx.lineTo(i * stepX, getY(prices[i]));
        ctx.lineTo(width, height); ctx.fillStyle = gradient; ctx.fill();
        ctx.beginPath(); ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1.5; ctx.lineJoin = 'miter'; ctx.miterLimit = 0; 
        for (let i = 0; i < prices.length; i++) {
            if (i === 0) ctx.moveTo(i * stepX, getY(prices[i]));
            else ctx.lineTo(i * stepX, getY(prices[i]));
        }
        ctx.stroke();
    } else {
        if (candleData.length === 0) { requestAnimationFrame(drawChart); return; }
        let candleWidth = 12, spacing = 20, startX = width - (candleData.length * spacing);
        candleData.forEach((candle, index) => {
            let x = startX + (index * spacing) + (spacing / 2);
            let yOpen = getY(candle.open), yClose = getY(candle.close);
            let yHigh = getY(candle.high), yLow = getY(candle.low);
            let color = candle.isUp ? '#22c55e' : '#ef4444';
            ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.moveTo(x, yHigh); ctx.lineTo(x, yLow); ctx.stroke();
            ctx.fillStyle = color;
            let bodyTop = Math.min(yOpen, yClose), bodyHeight = Math.max(Math.abs(yOpen - yClose), 2);
            ctx.fillRect(x - (candleWidth / 2), bodyTop, candleWidth, bodyHeight);
        });
    }

    let lastPrice = prices[prices.length - 1];
    let lastX = chartType === 'line' ? (prices.length - 1) * (width / (maxPoints - 1)) : width - 10;
    let lastY = getY(lastPrice);
    ctx.beginPath(); ctx.strokeStyle = 'rgba(96, 165, 250, 0.4)'; ctx.setLineDash([4, 4]);
    ctx.moveTo(0, lastY); ctx.lineTo(width, lastY); ctx.stroke(); ctx.setLineDash([]); 
    ctx.beginPath(); ctx.fillStyle = '#60a5fa'; ctx.arc(lastX, lastY, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(59, 130, 246, 0.8)'; ctx.fillRect(width - 65, lastY - 10, 65, 20);
    ctx.fillStyle = 'white'; ctx.font = 'bold 11px Arial'; ctx.fillText(lastPrice.toFixed(state.currentPair === 'USD/JPY' ? 3 : 5), width - 60, lastY + 4);
    ctx.fillStyle = '#64748b'; ctx.font = '10px Arial';
    let steps = 5;
    for (let i = 0; i <= steps; i++) {
        let priceLevel = minPrice + (adjustedRange * (i / steps));
        let yPos = getY(priceLevel);
        if (Math.abs(yPos - lastY) > 15) { ctx.fillText(priceLevel.toFixed(state.currentPair === 'USD/JPY' ? 3 : 5), width - 60, yPos); }
    }

    let now = Date.now();
    chartTags = chartTags.filter(tag => {
        if (tag.type === 'entry') {
            let timeLeft = Math.max(0, Math.ceil((tag.expiry - now) / 1000));
            let tagY = getY(tag.price);
            let tagColor = tag.direction === 'BUY' ? '#22c55e' : '#ef4444';
            ctx.beginPath(); ctx.strokeStyle = tagColor; ctx.lineWidth = 1; ctx.moveTo(0, tagY); ctx.lineTo(width, tagY); ctx.stroke();
            ctx.fillStyle = tagColor; ctx.fillRect(10, tagY - 10, 70, 20);
            ctx.fillStyle = 'white'; ctx.font = 'bold 10px Arial'; ctx.fillText(`${tag.direction} $${tag.amount}`, 15, tagY + 4);
            if (timeLeft > 0) {
                ctx.fillStyle = '#1e293b'; ctx.fillRect(width - 60, tagY - 10, 50, 20);
                ctx.fillStyle = '#60a5fa'; ctx.font = 'bold 11px Arial'; ctx.fillText(`⏱ ${timeLeft}s`, width - 55, tagY + 4);
            }
            return timeLeft > 0; 
        }
        if (tag.type === 'profit') {
            let tagY = getY(tag.price);
            if (now - tag.time < 5000) {
                ctx.fillStyle = '#22c55e'; ctx.fillRect(width / 2 - 30, tagY - 25, 60, 20);
                ctx.fillStyle = 'white'; ctx.font = 'bold 12px Arial'; ctx.fillText(`+$${tag.amount.toFixed(2)}`, width / 2 - 25, tagY - 10);
                return true;
            }
            return false;
        }
        return false;
    });

    ctx.fillStyle = '#64748b'; ctx.font = '10px Arial';
    for (let i = 0; i < timestamps.length; i += 15) {
        let xPos = i * (width / (maxPoints - 1));
        if (xPos > width - 30) continue;
        let date = new Date(timestamps[i]);
        ctx.fillText(date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), xPos, height + 15);
    }
    requestAnimationFrame(drawChart);
}

// --- UI MODALS & FETCHING ---
function openModal(modalId) { 
    document.getElementById(modalId).style.display = "block"; 
    if (modalId === 'ai-modal') fetchAIStatus();
    if (modalId === 'signals-modal') fetchLiveSignals();
    if (modalId === 'wallet-modal') renderWalletLedger(); 
    if (modalId === 'finance-modal') fetchFinanceLedger();
    if (modalId === 'progress-modal') fetchProgressStats();
    if (modalId === 'activities-modal') fetchActivities();
    if (modalId === 'market-modal') {
        fetchMarketData();
        if (marketInterval) clearInterval(marketInterval);
        marketInterval = setInterval(fetchMarketData, 2000);
    }
}
function closeModal(modalId) { 
    document.getElementById(modalId).style.display = "none"; 
    if (modalId === 'market-modal' && marketInterval) clearInterval(marketInterval);
}
window.onclick = function(event) { if (event.target.classList.contains('modal')) event.target.style.display = "none"; }

document.getElementById('trade-amount').addEventListener('input', (e) => {
    let amount = parseFloat(e.target.value) || 0;
    document.getElementById('potential-profit').innerText = "+$" + (amount * (state.currentPayout / 100)).toFixed(2);
});

async function fetchAIStatus() {
    try {
        const res = await fetch('/api/ai-status');
        const data = await res.json();
        if (data.success) {
            let suggColor = data.suggestion === 'BUY' ? '#22c55e' : data.suggestion === 'SELL' ? '#ef4444' : '#3b82f6';
            let rsiColor = data.rsi > 60 ? '#ef4444' : data.rsi < 40 ? '#22c55e' : '#f59e0b';
            document.getElementById('ai-content').innerHTML = `
                <span class="close-btn" onclick="closeModal('ai-modal')">&times;</span>
                <div class="ai-title">🤖 AI Trader Engine</div>
                <div class="ai-data-row"><span>RSI (Relative Strength)</span> <b style="color: ${rsiColor}">${data.rsi}</b></div>
                <div class="ai-data-row"><span>Trend Detection</span> <b>${data.trend}</b></div>
                <div class="ai-data-row"><span>Volatility</span> <b>${data.volatility}</b></div>
                <div class="ai-data-row" style="border:none; margin-top: 15px;"><span style="font-size: 16px;">AI Suggestion</span> <b style="color: ${suggColor}; font-size: 20px;">${data.suggestion}</b></div>
                <button class="ai-btn-trade" style="background: ${suggColor}; box-shadow: 0 0 10px ${suggColor};" onclick="tradeFromModal('${data.suggestion}')">Trade ${data.suggestion} Now</button>
            `;
        }
    } catch (e) { console.error(e); }
}

async function fetchLiveSignals() {
    try {
        const res = await fetch('/api/live-signal');
        const data = await res.json();
        if (data.success) {
            let dirColor = data.direction === 'BUY' ? '#22c55e' : '#ef4444';
            
            const feedRes = await fetch('/api/signal-feed');
            const feedData = await feedRes.json();
            
            let feedHTML = '';
            if (feedData.success && feedData.signals.length > 0) {
                feedData.signals.forEach(sig => {
                    let resultColor = sig.result === 'WIN' ? '#22c55e' : '#ef4444';
                    let dirColorBadge = sig.direction === 'BUY' ? '#22c55e' : '#ef4444';
                    feedHTML += `
                        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #1e293b; font-size: 11px;">
                            <div>
                                <span style="color: white; font-weight: bold;">${sig.pair}</span> 
                                <span style="color: ${dirColorBadge}; font-weight: bold;">${sig.direction}</span>
                                <br>
                                <span style="color: #64748b; font-size: 9px;">${new Date(sig.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <div style="text-align: right;">
                                <span style="color: white;">${sig.entry_price.toFixed(5)}</span>
                                <br>
                                <span style="color: ${resultColor}; font-weight: bold;">${sig.result}</span>
                            </div>
                        </div>
                    `;
                });
            } else {
                feedHTML = '<p style="color: #64748b; text-align: center; font-size: 12px;">Waiting for signals...</p>';
            }

            document.getElementById('signals-content').innerHTML = `
                <span class="close-btn" onclick="closeModal('signals-modal')">&times;</span>
                <div class="ai-title">📡 Live AI Signals</div>
                <div style="background: rgba(15, 23, 42, 0.5); padding: 15px; border-radius: 8px; border-left: 3px solid ${dirColor}; margin-bottom: 15px;">
                    <div style="display:flex; justify-content:space-between; font-weight:bold; margin-bottom: 10px;"><span style="font-size: 18px;">${data.pair}</span><span style="color:${dirColor}; font-size: 18px;">${data.direction}</span></div>
                    <div class="ai-data-row"><span>Entry Price</span> <b>${data.entry}</b></div>
                    <div class="ai-data-row"><span>Take Profit</span> <b style="color:#22c55e;">${data.tp}</b></div>
                    <div class="ai-data-row"><span>Stop Loss</span> <b style="color:#ef4444;">${data.sl}</b></div>
                    <div class="ai-data-row" style="border:none;"><span>Strength</span> <b>${data.strength}%</b></div>
                </div>
                
                <p style="font-size: 12px; color: #94a3b8; margin-bottom: 5px;">Recent Signal Feed</p>
                <div style="max-height: 150px; overflow-y: auto;">
                    ${feedHTML}
                </div>

                <button class="ai-btn-trade" style="background: ${dirColor}; box-shadow: 0 0 10px ${dirColor}; margin-top: 15px;" onclick="tradeFromModal('${data.direction}')">Execute ${data.direction}</button>
            `;
        }
    } catch (e) { console.error(e); }
}

function handleChatEnter(event) { if (event.key === "Enter") { sendChatMessage(); } }

function sendChatMessage() {
    let input = document.getElementById('chat-input');
    let msg = input.value.trim();
    if (!msg) return;
    let chatBox = document.getElementById('chat-messages');
    chatBox.innerHTML += `<div style="background: #2b5278; color: white; padding: 10px 15px; border-radius: 12px; border-bottom-right-radius: 0; max-width: 85%; align-self: flex-end; font-size: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.2);">${msg}</div>`;
    input.value = ''; chatBox.scrollTop = chatBox.scrollHeight;
    let typingId = 'typing-' + Date.now();
    chatBox.innerHTML += `<div id="${typingId}" style="background: #182533; color: #708499; padding: 10px 15px; border-radius: 12px; border-bottom-left-radius: 0; max-width: 85%; align-self: flex-start; font-size: 13px; font-style: italic;">typing...</div>`;
    chatBox.scrollTop = chatBox.scrollHeight;
    setTimeout(() => {
        document.getElementById(typingId).remove();
        let reply = "I have forwarded your message to a human agent. Please wait a moment.";
        let lowerMsg = msg.toLowerCase();
        if (lowerMsg.includes("hi") || lowerMsg.includes("hello") || lowerMsg.includes("help")) reply = "Hello! I am your AI assistant. How can I help you today?";
        else if (lowerMsg.includes("deposit") || lowerMsg.includes("money") || lowerMsg.includes("fund")) reply = "You can deposit funds by clicking the green Deposit button in your profile menu.";
        else if (lowerMsg.includes("trade") || lowerMsg.includes("win") || lowerMsg.includes("profit")) reply = "Our AI engine has a 98% win rate! Just place a trade and watch the magic.";
        else if (lowerMsg.includes("withdraw")) reply = "Withdrawals require KYC verification. Please contact support on Telegram for assistance.";
        chatBox.innerHTML += `<div style="background: #182533; color: white; padding: 10px 15px; border-radius: 12px; border-bottom-left-radius: 0; max-width: 85%; align-self: flex-start; font-size: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.2);">${reply}</div>`;
        chatBox.scrollTop = chatBox.scrollHeight;
    }, 1000);
}

async function logTransaction(type, amount, details) {
    try {
        await fetch('/api/log-transaction', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: state.userId, type, amount, details })
        });
    } catch (e) { console.error("Failed to log transaction:", e); }
}

function openStripeCheckout(amount) {
    let selectedAccount = document.getElementById('account-type').value;
    if (selectedAccount !== 'real') { alert("Please switch to the QT Real account to make deposits."); return; }
    closeModal('deposit-modal');
    document.getElementById('stripe-amount-display').innerText = "$" + amount;
    openModal('stripe-modal');
}

function processStripePayment() {
    let btn = document.getElementById('stripe-pay-btn');
    btn.innerText = "Processing..."; btn.style.opacity = "0.7"; btn.style.cursor = "not-allowed";
    let amount = parseFloat(document.getElementById('stripe-amount-display').innerText.replace('$', ''));
    logTransaction('deposit', amount, 'Stripe Deposit');
    setTimeout(() => { btn.innerText = "Processing..."; }, 2000);
}

function processWithdrawal() {
    let amount = parseFloat(document.getElementById('crypto-amount').value);
    let address = document.getElementById('crypto-address').value;
    let network = document.getElementById('crypto-network').value;
    let selectedAccount = document.getElementById('account-type').value;
    if (selectedAccount !== 'real') { alert("Please switch to the QT Real account to withdraw."); return; }
    if (!address || address.length < 10) { alert("Please enter a valid wallet address."); return; }
    if (isNaN(amount) || amount < 5000) { alert("Minimum withdrawal is $5,000."); return; }
    let btn = document.getElementById('withdraw-btn');
    btn.innerText = "Processing..."; btn.style.opacity = "0.7"; btn.style.cursor = "not-allowed";
    logTransaction('withdrawal', amount, `${network} Withdrawal`);
    setTimeout(() => { btn.innerText = "Processing..."; }, 2000);
}

async function changePassword() {
    let currentPass = document.getElementById('current-pass').value;
    let newPass = document.getElementById('new-pass').value;
    let confirmPass = document.getElementById('confirm-pass').value;
    if (!currentPass || !newPass || !confirmPass) { alert("Please fill all fields."); return; }
    if (newPass !== confirmPass) { alert("New passwords do not match."); return; }
    if (newPass.length < 6) { alert("Password must be at least 6 characters."); return; }
    let btn = document.getElementById('change-pass-btn');
    btn.innerText = "Updating..."; btn.style.opacity = "0.7";
    try {
        const res = await fetch('/api/change-password', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: state.userId, currentPassword: currentPass, newPassword: newPass })
        });
        const data = await res.json();
        if (data.success) {
            alert("✅ Password updated successfully!");
            document.getElementById('current-pass').value = '';
            document.getElementById('new-pass').value = '';
            document.getElementById('confirm-pass').value = '';
            closeModal('settings-modal');
        } else { alert("❌ Error: " + data.message); }
    } catch (e) { alert("Network error."); }
    btn.innerText = "Update Password"; btn.style.opacity = "1";
}

async function resetDemoBalance() {
    if (!confirm("Are you sure you want to reset your Demo balance to $50,000? Your trade history will be kept.")) return;
    let btn = document.getElementById('reset-demo-btn');
    btn.innerText = "Resetting..."; btn.style.opacity = "0.7";
    try {
        const res = await fetch('/api/reset-demo', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: state.userId })
        });
        const data = await res.json();
        if (data.success) {
            alert("✅ Demo balance reset to $50,000!");
            state.balances.demo = 50000;
            updateBalanceDisplay();
            closeModal('settings-modal');
        } else { alert("❌ Error: " + data.message); }
    } catch (e) { alert("Network error."); }
    btn.innerText = "Reset Demo Balance to $50,000"; btn.style.opacity = "1";
}
