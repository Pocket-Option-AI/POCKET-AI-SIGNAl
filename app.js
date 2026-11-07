// --- APP STATE & AUTHENTICATION ---
let state = {
    userId: null, 
    account: 'demo', 
    balances: { demo: 0, real: 0 },
    activeTrades: [],
    history: []
};

let isLoginMode = true; 

const canvas = document.getElementById('tradingChart');
const ctx = canvas.getContext('2d');
let width, height;
let prices = [];
let timestamps = [];
let maxPoints = 100;
let currentPrice = 1.08500;
let isChartRunning = false;
let ws = null; 

// --- AUTHENTICATION LOGIC ---
function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? "Welcome Back" : "Create Account";
    document.getElementById('auth-btn').innerText = isLoginMode ? "Log In" : "Register";
    document.getElementById('switch-text').innerText = isLoginMode ? "Don't have an account? Register" : "Already have an account? Log In";
}

async function handleAuth() {
    let email = document.getElementById('login-email').value;
    let password = document.getElementById('login-pass').value;

    if (!email || !password) { alert("Please enter email and password."); return; }

    let endpoint = isLoginMode ? '/api/login' : '/api/register';

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();

        if (data.success) {
            state.userId = data.userId;
            document.getElementById('auth-screen').classList.remove('active');
            document.getElementById('dashboard-screen').classList.add('active');
            document.getElementById('app-body').classList.remove('light-mode');
            
            loadUserData();
            startChartEngine(15);
        } else {
            alert((isLoginMode ? "Login" : "Registration") + " failed: " + data.message);
        }
    } catch (error) {
        console.error("Auth error:", error);
        alert("Network error. Please try again.");
    }
}

function logout() {
    state.userId = null;
    location.reload();
}

// --- FETCH USER DATA ---
async function loadUserData() {
    if (!state.userId) return;
    try {
        const response = await fetch(`/api/user-data/${state.userId}`);
        const data = await response.json();
        
        if (data.success) {
            state.balances.demo = data.balances.demo_balance;
            state.balances.real = data.balances.real_balance;
            updateBalanceDisplay();
        }
    } catch (error) { console.error("Error loading user data:", error); }
}

function updateBalanceDisplay() {
    state.account = document.getElementById('account-type').value;
    let balance = state.balances[state.account] || 0;
    document.getElementById('display-balance').innerText = "$" + balance.toFixed(2);
    
    let walletText = document.getElementById('wallet-balance-text');
    if (walletText) walletText.innerText = "$" + balance.toFixed(2);
}

// --- TRADING LOGIC ---
async function placeTrade(direction) {
    let amount = parseFloat(document.getElementById('trade-amount').value);
    let expirySeconds = parseInt(document.getElementById('trade-expiry').value);
    let pair = document.getElementById('currency-pair').value;
    
    if (isNaN(amount) || amount <= 0) { alert("Please enter a valid amount."); return; }
    if (amount > state.balances[state.account]) { alert("Insufficient balance in " + state.account + " account."); return; }

    state.balances[state.account] -= amount;
    updateBalanceDisplay();

    let trade = {
        id: Date.now(),
        pair: pair,
        direction: direction,
        amount: amount,
        entryPrice: currentPrice,
        expiry: expirySeconds,
        status: 'OPEN',
        result: null
    };

    state.activeTrades.push(trade);
    renderHistory();

    try {
        await fetch('/api/place-trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userId: state.userId,
                accountType: state.account, 
                amount: amount,
                tradeData: { pair, direction, entryPrice: currentPrice, expiry: expirySeconds }
            })
        });
    } catch (error) { console.error("Failed to save trade:", error); }

    setTimeout(() => { closeTrade(trade.id); }, expirySeconds * 1000);
}

function closeTrade(tradeId) {
    let tradeIndex = state.activeTrades.findIndex(t => t.id === tradeId);
    if (tradeIndex === -1) return;
    
    let trade = state.activeTrades[tradeIndex];
    let exitPrice = currentPrice;
    
    let isWin = false;
    if (trade.direction === 'BUY' && exitPrice > trade.entryPrice) isWin = true;
    if (trade.direction === 'SELL' && exitPrice < trade.entryPrice) isWin = true;

    let payout = isWin ? trade.amount * 1.92 : 0; 
    state.balances[state.account] += payout;
    updateBalanceDisplay();

    trade.status = 'CLOSED';
    trade.result = isWin ? 'WIN' : 'LOSS';
    trade.payout = payout;
    
    state.history.unshift(trade);
    state.activeTrades.splice(tradeIndex, 1);
    renderHistory();

    if (payout > 0) {
        fetch('/api/place-trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: state.userId, accountType: state.account, amount: -payout, tradeData: null })
        });
    }
}

function renderHistory() {
    let historyDiv = document.getElementById('history-list');
    if (state.history.length === 0 && state.activeTrades.length === 0) {
        historyDiv.innerHTML = '<div class="history-item empty">No trades yet. Place a trade to begin.</div>';
        return;
    }
    historyDiv.innerHTML = '';
    
    state.activeTrades.forEach(t => {
        historyDiv.innerHTML += `<div class="history-item"><span>${t.pair} • ${t.direction} • $${t.amount.toFixed(2)}</span><span style="color:#3b82f6;">Running...</span></div>`;
    });

    state.history.forEach(t => {
        let cls = t.result === 'WIN' ? 'win' : 'loss';
        let color = t.result === 'WIN' ? '#22c55e' : '#ef4444';
        historyDiv.innerHTML += `<div class="history-item ${cls}"><span>${t.pair} • ${t.direction} • $${t.amount.toFixed(2)}</span><span style="color:${color}; font-weight:bold;">${t.result}</span></div>`;
    });
}

// --- CHART ENGINE ---
function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    width = canvas.width;
    height = canvas.height - 20; 
}
window.addEventListener('resize', resizeCanvas);

function initChart() {
    resizeCanvas();
    prices = [];
    timestamps = [];
    let now = Date.now();
    for (let i = 0; i < maxPoints; i++) {
        prices.push(currentPrice);
        timestamps.push(now - ((maxPoints - i) * 1000)); 
    }
}

function startChartEngine(speed) {
    initChart();
    isChartRunning = true;
    if (ws) ws.close();
    ws = new WebSocket('wss://stream.binance.com:9443/ws/eurusdt@trade');
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.p) {
            currentPrice = parseFloat(data.p);
            prices.push(currentPrice);
            timestamps.push(Date.now());
            if (prices.length > maxPoints) { prices.shift(); timestamps.shift(); }
            let decimals = currentPrice > 10 ? 3 : 5;
            document.getElementById('live-price').innerText = `Active: ${state.activeTrades.length} | Price: ${currentPrice.toFixed(decimals)}`;
        }
    };
    if (prices.length > 0) requestAnimationFrame(drawChart);
}

function drawChart() {
    if (!isChartRunning) return;
    ctx.clearRect(0, 0, width, height + 20);
    let stepX = width / (maxPoints - 1);
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'; 
    ctx.lineWidth = 1;
    let gridSpacing = 40;
    for (let x = 0; x < width; x += gridSpacing) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y < height; y += gridSpacing) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    if (prices.length === 0) { requestAnimationFrame(drawChart); return; }

    let minPrice = Math.min(...prices);
    let maxPrice = Math.max(...prices);
    let priceRange = maxPrice - minPrice;
    if (priceRange === 0) priceRange = 0.001;
    let padding = priceRange * 0.1;
    minPrice -= padding; maxPrice += padding;
    let adjustedRange = maxPrice - minPrice;
    function getY(price) { return height - ((price - minPrice) / adjustedRange * height); }

    let gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.4)'); 
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
    ctx.beginPath(); ctx.moveTo(0, height); 
    for (let i = 0; i < prices.length; i++) ctx.lineTo(i * stepX, getY(prices[i]));
    ctx.lineTo(width, height); ctx.fillStyle = gradient; ctx.fill();

    ctx.beginPath(); ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2;
    for (let i = 0; i < prices.length; i++) {
        if (i === 0) ctx.moveTo(i * stepX, getY(prices[i]));
        else ctx.lineTo(i * stepX, getY(prices[i]));
    }
    ctx.stroke();

    let lastPrice = prices[prices.length - 1];
    let lastX = (prices.length - 1) * stepX;
    let lastY = getY(lastPrice);
    let decimals = lastPrice > 10 ? 3 : 5;

    ctx.beginPath(); ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)'; ctx.setLineDash([5, 5]);
    ctx.moveTo(0, lastY); ctx.lineTo(width, lastY); ctx.stroke(); ctx.setLineDash([]); 
    ctx.beginPath(); ctx.fillStyle = '#3b82f6'; ctx.arc(lastX, lastY, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3b82f6'; ctx.fillRect(width - 65, lastY - 10, 65, 22);
    ctx.fillStyle = 'white'; ctx.font = 'bold 12px Arial'; ctx.fillText(lastPrice.toFixed(decimals), width - 60, lastY + 5);

    if (state.activeTrades.length > 0) {
        let activeTrade = state.activeTrades[state.activeTrades.length - 1];
        let chartSpeed = parseInt(document.getElementById('chart-timeframe').value);
        let pointsRemaining = activeTrade.expiry / (chartSpeed * 0.2); 
        let expiryX = width + (pointsRemaining * stepX);
        if (expiryX < width) {
             ctx.beginPath(); ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1;
             ctx.moveTo(expiryX, 0); ctx.lineTo(expiryX, height); ctx.stroke();
        }
    }

    ctx.fillStyle = '#64748b'; ctx.font = '10px Arial';
    for (let i = 0; i < timestamps.length; i += 20) {
        if (i * stepX > width - 30) continue;
        let date = new Date(timestamps[i]);
        let timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        ctx.fillText(timeStr, i * stepX, height + 15);
    }
    requestAnimationFrame(drawChart);
}

// --- UI MODALS & FETCHING ---
function openModal(modalId) { 
    document.getElementById(modalId).style.display = "block"; 
    if (modalId === 'ai-modal') fetchAIStatus();
    if (modalId === 'signals-modal') fetchLiveSignals();
}
function closeModal(modalId) { document.getElementById(modalId).style.display = "none"; }
window.onclick = function(event) { if (event.target.classList.contains('modal')) event.target.style.display = "none"; }

document.getElementById('trade-amount').addEventListener('input', (e) => {
    let amount = parseFloat(e.target.value) || 0;
    let profit = amount * 0.92; 
    document.getElementById('potential-profit').innerText = "+$" + profit.toFixed(2);
});

// Fetch AI Status
async function fetchAIStatus() {
    try {
        const response = await fetch('/api/ai-status');
        const data = await response.json();
        if (data.success) {
            document.getElementById('ai-modal').innerHTML = `
                <div class="modal-content">
                    <span class="close-btn" onclick="closeModal('ai-modal')">&times;</span>
                    <h2>AI Trader Engine</h2>
                    <p style="margin-top:10px;">RSI: <b>${data.rsi}</b></p>
                    <p>Trend: <b>${data.trend}</b></p>
                    <p>Volatility: <b>${data.volatility}</b></p>
                    <p style="margin-top:10px; font-size: 18px;">Suggestion: <b style="color:${data.suggestion === 'BUY' ? '#22c55e' : data.suggestion === 'SELL' ? '#ef4444' : '#3b82f6'}">${data.suggestion}</b></p>
                </div>
            `;
        }
    } catch (e) { console.error(e); }
}

// Fetch Live Signals
async function fetchLiveSignals() {
    try {
        const response = await fetch('/api/live-signal');
        const data = await response.json();
        if (data.success) {
            document.getElementById('signals-modal').innerHTML = `
                <div class="modal-content">
                    <span class="close-btn" onclick="closeModal('signals-modal')">&times;</span>
                    <h2>AI Forex Signals</h2>
                    <div class="signal-card" style="margin-top: 15px; border-left: 4px solid #3b82f6; padding-left: 10px;">
                        <div style="display:flex; justify-content:space-between; font-weight:bold; margin-bottom: 5px;">
                            <span>${data.pair}</span>
                            <span style="color:${data.direction === 'BUY' ? '#22c55e' : '#ef4444'}">${data.direction}</span>
                        </div>
                        <p>Entry: ${data.entry} | TP: ${data.tp} | SL: ${data.sl}</p>
                        <p style="font-size: 12px; color: #94a3b8;">Strength: ${data.strength}%</p>
                    </div>
                </div>
            `;
        }
    } catch (e) { console.error(e); }
}
