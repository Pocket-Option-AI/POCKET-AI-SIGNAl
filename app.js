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
let maxPoints = 100;
let currentPrice = 1.72500;
let isChartRunning = false;
let ws = null; 
let chartTags = []; 

// --- PROFILE MENU TOGGLE ---
function toggleProfile() {
    document.getElementById('profile-menu').classList.toggle('open');
}

// --- LIVE CLOCK ---
setInterval(() => {
    let clockEl = document.getElementById('live-clock');
    let topChartTime = document.getElementById('top-chart-time');
    if (clockEl) {
        let now = new Date();
        let timeStr = now.toLocaleTimeString([], { hour12: false });
        clockEl.innerText = timeStr;
        if (topChartTime) topChartTime.innerText = timeStr;
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
            startChartEngine(15);
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
    state.account = 'demo'; 
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
        id: Date.now(),
        pair: pair,
        direction: direction,
        amount: amount,
        entryPrice: currentPrice,
        expiry: expirySeconds,
        status: 'OPEN',
        result: null,
        startTime: Date.now() 
    };

    state.activeTrades.push(trade);
    
    chartTags.push({
        type: 'entry',
        tradeId: trade.id,
        price: currentPrice,
        direction: direction,
        amount: amount,
        expiry: Date.now() + (expirySeconds * 1000)
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
                userId: state.userId, 
                accountType: state.account, 
                tradeId: trade.id, 
                amount: trade.amount, 
                direction: trade.direction,
                entryPrice: trade.entryPrice,
                exitPrice: exitPrice,
                pair: trade.pair
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
                chartTags.push({
                    type: 'profit',
                    price: exitPrice,
                    amount: payout - trade.amount,
                    time: Date.now()
                });
            }
        }
    } catch (e) { console.error("Failed to close trade:", e); }
}

function renderHistory() {
    let historyDiv = document.getElementById('history-list');
    if (state.history.length === 0 && state.activeTrades.length ===
