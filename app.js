// --- APP STATE & AUTHENTICATION ---
let state = {
    userId: null, 
    account: 'demo', 
    balances: { demo: 0, real: 0 },
    activeTrades: [],
    history: []
};

const canvas = document.getElementById('tradingChart');
const ctx = canvas.getContext('2d');
let width, height;
let prices = [];
let timestamps = [];
let maxPoints = 80; // Number of points on screen
let currentPrice = 1.72500;
let isChartRunning = false;
let chartTags = []; 
let scrollInterval = null;

// --- PROFILE MENU TOGGLE ---
function toggleProfile() {
    document.getElementById('profile-menu').classList.toggle('open');
}

// --- LIVE CLOCK ---
setInterval(() => {
    let clockEl = document.getElementById('live-clock');
    if (clockEl) {
        let now = new Date();
        clockEl.innerText = now.toLocaleTimeString([], { hour12: false });
    }
}, 1000);

// --- LIVE SLIDER ---
const slider = document.getElementById('payout-slider');
if (slider) {
    slider.addEventListener('input', (e) => {
        let val = e.target.value;
        e.target.style.background = `linear-gradient(to right, #22c55e ${val}%, #ef4444 ${val}%)`;
    });
}

// --- AUTHENTICATION LOGIC ---
function showRegister() {
    document.getElementById('login-box').style.display = 'none';
    document.getElementById('register-box').style.display = 'block';
}
function showLogin() {
    document.getElementById('register-box').style.display = 'none';
    document.getElementById('login-box').style.display = 'block';
}

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
        if (data.success) {
            alert("Registration successful! Please log in.");
            showLogin();
        } else { alert("Registration failed: " + data.message); }
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
            startChartEngine();
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

// --- TRADING LOGIC ---
async function placeTrade(direction) {
    let amount = parseFloat(document.getElementById('trade-amount').value);
    let expirySeconds = parseInt(document.getElementById('trade-expiry').value);
    let pair = 'AED/CNY OTC';
    
    if (isNaN(amount) || amount <= 0) { alert("Please enter a valid amount."); return; }
    if (amount > state.balances[state.account]) { alert("Insufficient balance."); return; }

    state.balances[state.account] -= amount;
    updateBalanceDisplay();

    let trade = {
        id: Date.now(), pair, direction, amount,
        entryPrice: currentPrice, expiry: expirySeconds,
        status: 'OPEN', result: null, startTime: Date.now() 
    };

    state.activeTrades.push(trade);
    chartTags.push({
        type: 'entry', tradeId: trade.id, price: currentPrice,
        direction, amount, expiry: Date.now() + (expirySeconds * 1000)
    });

    renderHistory();

    try {
        await fetch('/api/place-trade', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: state.userId, accountType: state.account, amount: amount, tradeData: { pair, direction, entryPrice: currentPrice, expiry: expirySeconds } })
        });
    } catch (e) { console.error(e); }

    setTimeout(() => { closeTrade(trade.id); }, expirySeconds * 1000);
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
            body: JSON.stringify({ 
                userId: state.userId, accountType: state.account, tradeId: trade.id, 
                amount: trade.amount, direction: trade.direction,
                entryPrice: trade.entryPrice, exitPrice: exitPrice, pair: trade.pair
            })
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
        historyDiv.innerHTML += `<div class="history-item"><span>${t.pair} • ${t.direction} • $${t.amount.toFixed(2)}</span><span style="color:#60a5fa;">Running...</span></div>`;
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
    canvas.width = rect.width; canvas.height = rect.height;
    width = canvas.width; height = canvas.height - 20; 
}
window.addEventListener('resize', resizeCanvas);

function initChart() {
    resizeCanvas(); prices = []; timestamps = [];
    let now = Date.now();
    
    // Generate initial jagged data
    for (let i = 0; i < maxPoints; i++) { 
        let change = (Math.random() - 0.5) * 0.0020; 
        currentPrice += change;
        prices.push(currentPrice); 
        timestamps.push(now - ((maxPoints - i) * 1000)); 
    }
}

function startChartEngine() {
    initChart(); isChartRunning = true;
    
    if (scrollInterval) clearInterval(scrollInterval);
    
    // THE NATURAL MOVEMENT ENGINE
    scrollInterval = setInterval(() => {
        // Randomly decide if the market is slow, normal, or fast
        let speedMultiplier = 1.0;
        let dice = Math.random();
        if (dice > 0.9) speedMultiplier = 3.0; // 10% chance of a sharp spike
        else if (dice > 0.7) speedMultiplier = 1.5; // 20% chance of moderate speed
        else if (dice < 0.2) speedMultiplier = 0.3; // 20% chance of slow movement

        // Generate natural price change
        let change = (Math.random() - 0.5) * 0.0015 * speedMultiplier; 
        currentPrice += change;
        
        prices.push(currentPrice); 
        timestamps.push(Date.now());
        
        if (prices.length > maxPoints) { 
            prices.shift(); 
            timestamps.shift(); 
        }
        
        let priceDisplay = document.getElementById('current-price-display');
        if (priceDisplay) priceDisplay.innerText = currentPrice.toFixed(5);
        document.getElementById('live-price').innerText = `Active: ${state.activeTrades.length} | Price: ${currentPrice.toFixed(5)}`;
    }, 100); // Very fast update (10 times per second) for smooth continuous flow

    if (prices.length > 0) requestAnimationFrame(drawChart);
}

function drawChart() {
    if (!isChartRunning) return;
    ctx.clearRect(0, 0, width, height + 20);
    let stepX = width / (maxPoints - 1);
    
    // Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)'; ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y < height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    if (prices.length === 0) { requestAnimationFrame(drawChart); return; }

    // Price Mapping
    let minPrice = Math.min(...prices), maxPrice = Math.max(...prices);
    let priceRange = maxPrice - minPrice;
    if (priceRange === 0) priceRange = 0.001;
    let padding = priceRange * 0.1;
    minPrice -= padding; maxPrice += padding;
    let adjustedRange = maxPrice - minPrice;
    function getY(price) { return height - ((price - minPrice) / adjustedRange * height); }

    // Gradient (Underneath the line)
    let gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(96, 165, 250, 0.3)'); 
    gradient.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.beginPath(); ctx.moveTo(0, height); 
    for (let i = 0; i < prices.length; i++) ctx.lineTo(i * stepX, getY(prices[i]));
    ctx.lineTo(width, height); ctx.fillStyle = gradient; ctx.fill();

    // THIN SHARP ZIGZAG LINE
    ctx.beginPath(); 
    ctx.strokeStyle = '#60a5fa'; 
    ctx.lineWidth = 1.5; 
    ctx.lineJoin = 'miter'; 
    ctx.miterLimit = 0; // Forces sharp points
    
    for (let i = 0; i < prices.length; i++) {
        if (i === 0) ctx.moveTo(i * stepX, getY(prices[i]));
        else ctx.lineTo(i * stepX, getY(prices[i]));
    }
    ctx.stroke();

    // CURRENT PRICE INDICATOR & 5-DECIMAL SCALE LABELS
    let lastPrice = prices[prices.length - 1];
    let lastX = (prices.length - 1) * stepX;
    let lastY = getY(lastPrice);

    // Dashed line across
    ctx.beginPath(); ctx.strokeStyle = 'rgba(96, 165, 250, 0.4)'; ctx.setLineDash([4, 4]);
    ctx.moveTo(0, lastY); ctx.lineTo(width, lastY); ctx.stroke(); ctx.setLineDash([]); 
    
    // Blue dot
    ctx.beginPath(); ctx.fillStyle = '#60a5fa'; ctx.arc(lastX, lastY, 3, 0, Math.PI * 2); ctx.fill();
    
    // Current price box
    ctx.fillStyle = 'rgba(59, 130, 246, 0.8)'; ctx.fillRect(width - 65, lastY - 10, 65, 20);
    ctx.fillStyle = 'white'; ctx.font = 'bold 11px Arial'; ctx.fillText(lastPrice.toFixed(5), width - 60, lastY + 4);

    // 5-Decimal Price Scale (Right side)
    ctx.fillStyle = '#64748b'; ctx.font = '10px Arial';
    let steps = 5; // Number of labels on the right
    for (let i = 0; i <= steps; i++) {
        let priceLevel = minPrice + (adjustedRange * (i / steps));
        let yPos = getY(priceLevel);
        // Don't draw if too close to the current price box to prevent overlap
        if (Math.abs(yPos - lastY) > 15) {
            ctx.fillText(priceLevel.toFixed(5), width - 60, yPos);
        }
    }

    // Draw Visual Tags (Trades & Timers)
    let now = Date.now();
    chartTags = chartTags.filter(tag => {
        if (tag.type === 'entry') {
            let timeLeft = Math.max(0, Math.ceil((tag.expiry - now) / 1000));
            let tagY = getY(tag.price);
            let tagColor = tag.direction === 'BUY' ? '#22c55e' : '#ef4444';
            
            ctx.beginPath(); ctx.strokeStyle = tagColor; ctx.lineWidth = 1;
            ctx.moveTo(0, tagY); ctx.lineTo(width, tagY); ctx.stroke();

            ctx.fillStyle = tagColor;
            ctx.fillRect(10, tagY - 10, 70, 20);
            ctx.fillStyle = 'white'; ctx.font = 'bold 10px Arial';
            ctx.fillText(`${tag.direction} $${tag.amount}`, 15, tagY + 4);

            if (timeLeft > 0) {
                ctx.fillStyle = '#1e293b';
                ctx.fillRect(width - 60, tagY - 10, 50, 20);
                ctx.fillStyle = '#60a5fa'; ctx.font = 'bold 11px Arial';
                ctx.fillText(`⏱ ${timeLeft}s`, width - 55, tagY + 4);
            }
            return timeLeft > 0; 
        }
        if (tag.type === 'profit') {
            let tagY = getY(tag.price);
            if (now - tag.time < 5000) {
                ctx.fillStyle = '#22c55e';
                ctx.fillRect(width / 2 - 30, tagY - 25, 60, 20);
                ctx.fillStyle = 'white'; ctx.font = 'bold 12px Arial';
                ctx.fillText(`+$${tag.amount.toFixed(2)}`, width / 2 - 25, tagY - 10);
                return true;
            }
            return false;
        }
        return false;
    });

    // Time Labels (Bottom)
    ctx.fillStyle = '#64748b'; ctx.font = '10px Arial';
    for (let i = 0; i < timestamps.length; i += 15) {
        if (i * stepX > width - 30) continue;
        let date = new Date(timestamps[i]);
        ctx.fillText(date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), i * stepX, height + 15);
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
    document.getElementById('potential-profit').innerText = "+$" + (amount * 0.92).toFixed(2);
});

async function fetchAIStatus() {
    try {
        const res = await fetch('/api/ai-status');
        const data = await res.json();
        if (data.success) {
            document.getElementById('ai-modal').innerHTML = `
                <div class="modal-content">
                    <span class="close-btn" onclick="closeModal('ai-modal')">&times;</span>
                    <h2>AI Trader Engine</h2>
                    <p style="margin-top:10px;">RSI: <b>${data.rsi}</b></p>
                    <p>Trend: <b>${data.trend}</b></p>
                    <p>Volatility: <b>${data.volatility}</b></p>
                    <p style="margin-top:10px; font-size: 18px;">Suggestion: <b style="color:${data.suggestion === 'BUY' ? '#22c55e' : data.suggestion === 'SELL' ? '#ef4444' : '#3b82f6'}">${data.suggestion}</b></p>
                </div>`;
        }
    } catch (e) { console.error(e); }
}

async function fetchLiveSignals() {
    try {
        const res = await fetch('/api/live-signal');
        const data = await res.json();
        if (data.success) {
            document.getElementById('signals-modal').innerHTML = `
                <div class="modal-content">
                    <span class="close-btn" onclick="closeModal('signals-modal')">&times;</span>
                    <h2>AI Forex Signals</h2>
                    <div class="signal-card" style="margin-top: 15px; border-left: 4px solid #60a5fa; padding-left: 10px;">
                        <div style="display:flex; justify-content:space-between; font-weight:bold; margin-bottom: 5px;">
                            <span>${data.pair}</span>
                            <span style="color:${data.direction === 'BUY' ? '#22c55e' : '#ef4444'}">${data.direction}</span>
                        </div>
                        <p>Entry: ${data.entry} | TP: ${data.tp} | SL: ${data.sl}</p>
                    </div>
                </div>`;
        }
    } catch (e) { console.error(e); }
}
