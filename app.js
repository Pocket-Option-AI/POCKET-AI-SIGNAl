// --- APP STATE & AUTHENTICATION ---
let state = {
    account: 'demo', 
    balances: { demo: 50000, real: 110 },
    isLoggedIn: false,
    activeTrades: [],
    history: []
};

// --- CHART VARIABLES ---
const canvas = document.getElementById('tradingChart');
const ctx = canvas.getContext('2d');
let width, height;

let prices = [];
let timestamps = [];
let maxPoints = 100;
let currentPrice = 1.68500;
let volatility = 0.00015; 
let isChartRunning = false;
let updateInterval = null; 

// Control Listeners
document.getElementById('currency-pair').addEventListener('change', (e) => {
    let pair = e.target.value;
    document.getElementById('current-pair-name').innerText = pair;
    
    if (pair === 'EUR/USD') { currentPrice = 1.08500; volatility = 0.00010; }
    else if (pair === 'GBP/USD') { currentPrice = 1.26500; volatility = 0.00012; }
    else if (pair === 'USD/JPY') { currentPrice = 150.500; volatility = 0.01500; }
    else if (pair === 'AED/CNY OTC') { currentPrice = 1.68500; volatility = 0.00015; }
    
    initChart(); 
});

document.getElementById('chart-timeframe').addEventListener('change', (e) => {
    let speed = parseInt(e.target.value);
    startChartEngine(speed);
});

// --- AUTHENTICATION & UI ---
function login() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('dashboard-screen').classList.add('active');
    document.getElementById('app-body').classList.remove('light-mode');
    updateBalanceDisplay();
    
    // Connect to the backend to get the real saved balances
    syncBalancesFromServer(); 
    
    startChartEngine(15); 
}

function logout() { location.reload(); }

function updateBalanceDisplay() {
    state.account = document.getElementById('account-type').value;
    let balance = state.balances[state.account];
    document.getElementById('display-balance').innerText = "$" + balance.toFixed(2);
    
    let walletText = document.getElementById('wallet-balance-text');
    if (walletText) walletText.innerText = "$" + balance.toFixed(2);
}

document.getElementById('trade-amount').addEventListener('input', (e) => {
    let amount = parseFloat(e.target.value) || 0;
    let profit = amount * 0.92; 
    document.getElementById('potential-profit').innerText = "+$" + profit.toFixed(2);
});

// --- TRADING LOGIC ---
function placeTrade(direction) {
    let amount = parseFloat(document.getElementById('trade-amount').value);
    let expirySeconds = parseInt(document.getElementById('trade-expiry').value);
    let pair = document.getElementById('currency-pair').value;
    
    if (isNaN(amount) || amount <= 0) { alert("Please enter a valid amount."); return; }
    if (amount > state.balances[state.account]) { alert("Insufficient balance in " + state.account + " account."); return; }

    state.balances[state.account] -= amount;
    
    // Save deduction to the backend server and alert Telegram
    saveTradeToServer(state.account, -amount, {
        pair: pair,
        direction: direction,
        amount: amount,
        expiry: expirySeconds
    });
    
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
    
    // Save payout to the backend server
    saveTradeToServer(state.account, payout);
    
    updateBalanceDisplay();

    trade.status = 'CLOSED';
    trade.result = isWin ? 'WIN' : 'LOSS';
    trade.payout = payout;
    
    state.history.unshift(trade);
    state.activeTrades.splice(tradeIndex, 1);
    renderHistory();
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
        historyDiv.innerHTML += `<div class="history-item ${cls}"><span>${t.pair} • ${t.direction} • $${t.amount.toFixed(2)}</span><span style="color:${color}; font-weight:bold;">${t.result} ($${t.payout.toFixed(2)})</span></div>`;
    });
}

// --- HTML5 CANVAS CHART ENGINE ---
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
        generateNextPrice();
        timestamps.push(now - ((maxPoints - i) * 1000)); 
    }
}

function generateNextPrice() {
    let change = (Math.random() - 0.5) * volatility;
    if (Math.random() > 0.95) change *= 3; 
    currentPrice += change;
    
    let basePrice = document.getElementById('currency-pair').value === 'EUR/USD' ? 1.08500 : 
                    document.getElementById('currency-pair').value === 'GBP/USD' ? 1.26500 : 
                    document.getElementById('currency-pair').value === 'USD/JPY' ? 150.500 : 1.68500;
                    
    if (currentPrice > basePrice + (volatility * 20)) currentPrice -= volatility * 2;
    if (currentPrice < basePrice - (volatility * 20)) currentPrice += volatility * 2;
    
    prices.push(currentPrice);
    timestamps.push(Date.now());
    
    if (prices.length > maxPoints) { prices.shift(); timestamps.shift(); }
}

function startChartEngine(speed) {
    if (updateInterval) clearInterval(updateInterval); 
    initChart();
    isChartRunning = true;
    
    updateInterval = setInterval(() => {
        if (!isChartRunning) return;
        generateNextPrice();
        let pair = document.getElementById('currency-pair').value;
        let decimals = pair === 'USD/JPY' ? 3 : 5;
        document.getElementById('live-price').innerText = `Active: ${state.activeTrades.length} | Price: ${currentPrice.toFixed(decimals)}`;
    }, speed * 200); 

    if (prices.length > 0) requestAnimationFrame(drawChart);
}

function drawChart() {
    if (!isChartRunning) return;
    
    ctx.clearRect(0, 0, width, height + 20);
    let stepX = width / (maxPoints - 1);
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'; 
    ctx.lineWidth = 1;
    let gridSpacing = 40;
    
    for (let x = 0; x < width; x += gridSpacing) { 
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); 
    }
    for (let y = 0; y < height; y += gridSpacing) { 
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); 
    }

    if (prices.length === 0) { requestAnimationFrame(drawChart); return; }

    let minPrice = Math.min(...prices);
    let maxPrice = Math.max(...prices);
    let priceRange = maxPrice - minPrice;
    if (priceRange === 0) priceRange = 0.001;
    
    let padding = priceRange * 0.1;
    minPrice -= padding;
    maxPrice += padding;
    let adjustedRange = maxPrice - minPrice;
    
    function getY(price) { return height - ((price - minPrice) / adjustedRange * height); }

    let gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.4)'); 
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
    
    ctx.beginPath();
    ctx.moveTo(0, height); 
    for (let i = 0; i < prices.length; i++) ctx.lineTo(i * stepX, getY(prices[i]));
    ctx.lineTo(width, height); 
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = '#3b82f6'; 
    ctx.lineWidth = 2;
    ctx.lineJoin = 'miter'; 
    for (let i = 0; i < prices.length; i++) {
        if (i === 0) ctx.moveTo(i * stepX, getY(prices[i]));
        else ctx.lineTo(i * stepX, getY(prices[i]));
    }
    ctx.stroke();

    let lastPrice = prices[prices.length - 1];
    let lastX = (prices.length - 1) * stepX;
    let lastY = getY(lastPrice);
    let pair = document.getElementById('currency-pair').value;
    let decimals = pair === 'USD/JPY' ? 3 : 5;

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
    ctx.setLineDash([5, 5]);
    ctx.moveTo(0, lastY); ctx.lineTo(width, lastY); ctx.stroke();
    ctx.setLineDash([]); 

    ctx.beginPath();
    ctx.fillStyle = '#3b82f6';
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(width - 65, lastY - 10, 65, 22);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px Arial';
    ctx.fillText(lastPrice.toFixed(decimals), width - 60, lastY + 5);

    if (state.activeTrades.length > 0) {
        let activeTrade = state.activeTrades[state.activeTrades.length - 1];
        let chartSpeed = parseInt(document.getElementById('chart-timeframe').value);
        let pointsRemaining = activeTrade.expiry / (chartSpeed * 0.2); 
        let expiryX = width + (pointsRemaining * stepX);
        
        if (expiryX < width) {
             ctx.beginPath();
             ctx.strokeStyle = '#3b82f6';
             ctx.lineWidth = 1;
             ctx.moveTo(expiryX, 0); ctx.lineTo(expiryX, height);
             ctx.stroke();
        }
    }

    ctx.fillStyle = '#64748b';
    ctx.font = '10px Arial';
    for (let i = 0; i < timestamps.length; i += 20) {
        if (i * stepX > width - 30) continue;
        let date = new Date(timestamps[i]);
        let timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        ctx.fillText(timeStr, i * stepX, height + 15);
    }

    requestAnimationFrame(drawChart);
}

// --- MODAL CONTROL SYSTEM ---
function openModal(modalId) { document.getElementById(modalId).style.display = "block"; }
function closeModal(modalId) { document.getElementById(modalId).style.display = "none"; }
window.onclick = function(event) { if (event.target.classList.contains('modal')) event.target.style.display = "none"; }

// --- BACKEND CONNECTION SYSTEM ---
async function syncBalancesFromServer() {
    try {
        const response = await fetch('/api/get-balance');
        const data = await response.json();
        
        if (data.success) {
            state.balances.demo = data.demoBalance;
            state.balances.real = data.realBalance;
            updateBalanceDisplay();
            console.log("Balances synced with server!");
        }
    } catch (error) {
        console.error("Error connecting to backend:", error);
    }
}

async function saveTradeToServer(accountType, amount, tradeData = null) {
    try {
        const response = await fetch('/api/update-balance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                accountType: accountType, 
                amount: amount,
                tradeData: tradeData 
            })
        });
        const data = await response.json();
        if (data.success) {
            console.log("Server balance updated to:", data.newBalance);
        }
    } catch (error) {
        console.error("Failed to save trade to server:", error);
    }
}
