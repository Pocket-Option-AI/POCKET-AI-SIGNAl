const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, './')));

// --- DATABASE SETUP ---
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error(err.message);
    console.log('Connected to SQLite database.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password TEXT,
        demo_balance REAL DEFAULT 50000,
        real_balance REAL DEFAULT 110,
        real_start_balance REAL DEFAULT 110,
        telegram_chat_id TEXT
    )`);

    db.run(`ALTER TABLE users ADD COLUMN real_start_balance REAL DEFAULT 110`, (err) => {});
    db.run(`ALTER TABLE users ADD COLUMN telegram_chat_id TEXT`, (err) => {});

    db.run(`CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        pair TEXT,
        direction TEXT,
        amount REAL,
        entry_price REAL,
        expiry INTEGER,
        result TEXT,
        account_type TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT,
        amount REAL,
        details TEXT,
        status TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT,
        icon TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pair TEXT,
        direction TEXT,
        entry_price REAL,
        tp REAL,
        sl REAL,
        strength INTEGER,
        result TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Helper to log activity
function logActivity(userId, action, icon) {
    db.run(`INSERT INTO activities (user_id, action, icon) VALUES (?, ?, ?)`, [userId, action, icon]);
}

// --- TELEGRAM CONFIGURATION ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '9128311691:AAHNoHNFCLjpB7QE89j7poUBGvAq-xIRP5o';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramMessage(chatId, message, buttons = null) {
    if (!TELEGRAM_TOKEN || !chatId) return;
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        let body = { chat_id: chatId, text: message, parse_mode: 'HTML' };
        if (buttons) {
            body.reply_markup = { inline_keyboard: buttons };
        }
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (error) { console.error("Telegram error:", error); }
}

// --- TELEGRAM WEBHOOK (NEW) ---
app.post('/api/telegram-webhook', async (req, res) => {
    const { message, callback_query } = req.body;

    // Handle /start command with user ID
    if (message && message.text) {
        let chatId = message.chat.id.toString();
        let text = message.text;

        if (text.startsWith('/start')) {
            let parts = text.split(' ');
            if (parts.length > 1) {
                let userId = parts[1];
                db.run(`UPDATE users SET telegram_chat_id = ? WHERE id = ?`, [chatId, userId], function(err) {
                    if (err) {
                        sendTelegramMessage(chatId, "❌ Failed to link account. Please try again.");
                        return;
                    }
                    logActivity(userId, "Linked Telegram bot", "🔗");
                    sendTelegramMessage(chatId, "✅ Account successfully linked!\n\nUse the buttons below to trade on your <b>Real Account</b>:", [
                        [{ text: "BUY $10", callback_data: "buy_10" }, { text: "SELL $10", callback_data: "sell_10" }],
                        [{ text: "BUY $20", callback_data: "buy_20" }, { text: "SELL $20", callback_data: "sell_20" }],
                        [{ text: "BUY $30", callback_data: "buy_30" }, { text: "SELL $30", callback_data: "sell_30" }],
                        [{ text: "BUY $40", callback_data: "buy_40" }, { text: "SELL $40", callback_data: "sell_40" }],
                        [{ text: "BUY $55", callback_data: "buy_55" }, { text: "SELL $55", callback_data: "sell_55" }],
                        [{ text: "BUY $70", callback_data: "buy_70" }, { text: "SELL $70", callback_data: "sell_70" }],
                        [{ text: "BUY $85", callback_data: "buy_85" }, { text: "SELL $85", callback_data: "sell_85" }],
                        [{ text: "BUY $110", callback_data: "buy_110" }, { text: "SELL $110", callback_data: "sell_110" }]
                    ]);
                });
            } else {
                sendTelegramMessage(chatId, "👋 Welcome to Pocket AI Signal!\n\nPlease click the 'Connect Telegram' button on the website to link your account.");
            }
        }
    }

    // Handle button clicks
    if (callback_query) {
        let chatId = callback_query.message.chat.id.toString();
        let data = callback_query.data;
        let [action, amountStr] = data.split('_');
        let amount = parseFloat(amountStr);
        let direction = action === 'buy' ? 'BUY' : 'SELL';

        // Find user by chat ID
        db.get(`SELECT id, real_balance, real_start_balance FROM users WHERE telegram_chat_id = ?`, [chatId], async (err, user) => {
            if (err || !user) {
                sendTelegramMessage(chatId, "❌ Account not linked. Please connect on the website.");
                return;
            }

            // Check Daily Limit
            let dailyProfit = user.real_balance - user.real_start_balance;
            if (dailyProfit >= 499) {
                sendTelegramMessage(chatId, "❌ Daily profit limit of $499 reached. Please return tomorrow.");
                return;
            }

            // Check Balance
            if (amount > user.real_balance) {
                sendTelegramMessage(chatId, "❌ Insufficient balance.");
                return;
            }

            // Place Trade
            let mockPrice = 1.0850 + (Math.random() - 0.5) * 0.005;
            db.run(`UPDATE users SET real_balance = real_balance - ? WHERE id = ?`, [amount, user.id], function(err) {
                if (err) {
                    sendTelegramMessage(chatId, "❌ Trade failed.");
                    return;
                }

                db.run(`INSERT INTO trades (user_id, pair, direction, amount, entry_price, expiry, account_type) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [user.id, 'EUR/USD', direction, amount, mockPrice, 15, 'real']);

                logActivity(user.id, `Opened a ${direction} trade via Telegram for $${amount}`, "🚀");

                sendTelegramMessage(chatId, `🚀 <b>Trade Placed!</b>\n\nPair: EUR/USD\nDirection: ${direction}\nAmount: $${amount}\nExpiry: 15s\n\nWaiting for result...`);

                // Simulate trade result after 15 seconds
                setTimeout(() => {
                    let isWin = Math.random() * 100 <= 98;
                    let payout = isWin ? (amount * 1.92) : 0;
                    let resultStr = isWin ? 'WIN' : 'LOSS';

                    db.run(`UPDATE users SET real_balance = real_balance + ? WHERE id = ?`, [payout, user.id], function(err) {
                        if (err) return;

                        db.run(`UPDATE trades SET result = ? WHERE id = (SELECT MAX(id) FROM trades WHERE user_id = ?)`, [resultStr, user.id]);

                        if (isWin) {
                            let profit = (payout - amount).toFixed(2);
                            sendTelegramMessage(chatId, `🏆 <b>TRADE WON!</b>\n\nProfit: +$${profit}\nNew Balance: $${(user.real_balance - amount + payout).toFixed(2)}`);
                            logActivity(user.id, `Won a Telegram trade (+$${profit})`, "🏆");
                        } else {
                            sendTelegramMessage(chatId, `📉 <b>TRADE LOST</b>\n\nLoss: -$${amount}\nNew Balance: $${(user.real_balance - amount).toFixed(2)}`);
                            logActivity(user.id, `Lost a Telegram trade (-$${amount})`, "📉");
                        }
                    });
                }, 15000);
            });
        });
    }

    res.sendStatus(200);
});

// --- AI SIGNAL GENERATOR ENGINE ---
function generateAISignal() {
    let mockPrice = 1.0850 + (Math.random() - 0.5) * 0.005;
    let rsi = Math.floor(Math.random() * 40) + 30;
    let signal = rsi > 60 ? "BUY" : rsi < 40 ? "SELL" : "NEUTRAL";
    
    let tp = signal === "BUY" ? (mockPrice + 0.0020).toFixed(5) : (mockPrice - 0.0020).toFixed(5);
    let sl = signal === "BUY" ? (mockPrice - 0.0010).toFixed(5) : (mockPrice + 0.0010).toFixed(5);

    let isWin = Math.random() * 100 <= 98;
    let result = isWin ? "WIN" : "LOSS";

    db.run(`INSERT INTO signals (pair, direction, entry_price, tp, sl, strength, result) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ["EUR/USD", signal, mockPrice, tp, sl, rsi, result]);

    if (TELEGRAM_CHAT_ID) {
        let msg = `🚨 <b>AI SIGNAL DETECTED</b> 🚨\n\n` +
                  `Pair: <b>EUR/USD</b>\n` +
                  `Direction: <b>${signal}</b>\n` +
                  `Entry: ${mockPrice.toFixed(5)}\n` +
                  `Take Profit: ${tp}\n` +
                  `Stop Loss: ${sl}\n\n` +
                  `<i>Generated by Pocket AI Engine</i>`;
        sendTelegramMessage(TELEGRAM_CHAT_ID, msg);
    }
}

db.get(`SELECT COUNT(*) as count FROM signals`, (err, row) => {
    if (row && row.count === 0) {
        for (let i = 0; i < 5; i++) {
            let mockPrice = 1.0850 + (Math.random() - 0.5) * 0.005;
            let rsi = Math.floor(Math.random() * 40) + 30;
            let signal = rsi > 60 ? "BUY" : "SELL";
            let isWin = Math.random() * 100 <= 98;
            db.run(`INSERT INTO signals (pair, direction, entry_price, tp, sl, strength, result) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ["EUR/USD", signal, mockPrice, mockPrice + 0.0020, mockPrice - 0.0010, rsi, isWin ? "WIN" : "LOSS"]);
        }
    }
});

setInterval(generateAISignal, 30000);

// --- AUTHENTICATION ROUTES ---
app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: "Missing fields" });
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (email, password, real_start_balance) VALUES (?, ?, 110)`, [email, hashedPassword], function(err) {
            if (err) return res.status(400).json({ success: false, message: "Email already exists" });
            res.json({ success: true, message: "User created", userId: this.lastID });
        });
    } catch (error) { res.status(500).json({ success: false, message: "Server error" }); }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (err || !user) return res.status(400).json({ success: false, message: "User not found" });
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ success: false, message: "Invalid password" });
        
        logActivity(user.id, "Successful login", "🔐");
        res.json({ success: true, userId: user.id, demoBalance: user.demo_balance, realBalance: user.real_balance });
    });
});

// --- TRADING ROUTES ---
app.post('/api/place-trade', (req, res) => {
    const { userId, accountType, amount, tradeData } = req.body;
    if (!userId) return res.status(401).json({ success: false, message: "Not logged in" });

    if (accountType === 'demo') {
        executeTrade(userId, accountType, amount, tradeData, res);
        return;
    }

    db.get(`SELECT real_balance, real_start_balance FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ success: false, message: "User not found" });
        let dailyProfit = user.real_balance - user.real_start_balance;
        if (dailyProfit >= 499) {
            return res.status(400).json({ success: false, message: "Daily profit limit of $499 reached. Please return tomorrow." });
        }
        executeTrade(userId, accountType, amount, tradeData, res);
    });
});

function executeTrade(userId, accountType, amount, tradeData, res) {
    let balanceCol = accountType === 'demo' ? 'demo_balance' : 'real_balance';
    db.run(`UPDATE users SET ${balanceCol} = ${balanceCol} - ? WHERE id = ?`, [amount, userId], function(err) {
        if (err) return res.status(500).json({ success: false, message: "Trade failed" });
        
        if (tradeData) {
            db.run(`INSERT INTO trades (user_id, pair, direction, amount, entry_price, expiry, account_type) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
                [userId, tradeData.pair, tradeData.direction, amount, tradeData.entryPrice, tradeData.expiry, accountType]);
            
            logActivity(userId, `Opened a ${tradeData.direction} trade on ${tradeData.pair} for $${amount}`, "🚀");
            
            let action = tradeData.direction === 'BUY' ? '🟢 BUY' : '🔴 SELL';
            if (TELEGRAM_CHAT_ID) {
                let msg = `<b>🚀 NEW TRADE OPENED</b>\n\nPair: ${tradeData.pair}\nAction: ${action}\nAmount: $${amount}\nAccount: ${accountType.toUpperCase()}`;
                sendTelegramMessage(TELEGRAM_CHAT_ID, msg);
            }
        }
        res.json({ success: true, message: "Trade placed" });
    });
}

app.post('/api/close-trade', (req, res) => {
    const { userId, accountType, tradeId, amount, direction, entryPrice, exitPrice, pair } = req.body;
    if (!userId) return res.status(401).json({ success: false, message: "Not logged in" });

    let isWin = false;
    let diceRoll = Math.random() * 100;
    if (diceRoll <= 98) { isWin = true; } 
    else {
        if (direction === 'BUY' && exitPrice > entryPrice) isWin = true;
        if (direction === 'SELL' && exitPrice < entryPrice) isWin = true;
    }

    let payout = isWin ? (amount * 1.92) : 0;
    let resultStr = isWin ? 'WIN' : 'LOSS';
    let balanceCol = accountType === 'demo' ? 'demo_balance' : 'real_balance';

    db.run(`UPDATE users SET ${balanceCol} = ${balanceCol} + ? WHERE id = ?`, [payout, userId], function(err) {
        if (err) return res.status(500).json({ success: false, message: "Failed to update balance" });
        db.run(`UPDATE trades SET result = ? WHERE id = ?`, [resultStr, tradeId]);

        if (isWin) {
            let profit = (payout - amount).toFixed(2);
            logActivity(userId, `Won a trade on ${pair} (+$${profit})`, "🏆");
            if (TELEGRAM_CHAT_ID) {
                let msg = `🤖 <b>AI SIGNAL WON!</b>\n\nPair: ${pair || 'EUR/USD'}\nProfit: <b>+$${profit}</b>\nAccount: ${accountType.toUpperCase()}`;
                sendTelegramMessage(TELEGRAM_CHAT_ID, msg);
            }
        } else {
            logActivity(userId, `Lost a trade on ${pair} (-$${amount})`, "📉");
        }
        res.json({ success: true, result: resultStr, payout: payout });
    });
});

app.get('/api/signal-feed', (req, res) => {
    db.all(`SELECT * FROM signals ORDER BY timestamp DESC LIMIT 15`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: "Failed to fetch signals" });
        res.json({ success: true, signals: rows });
    });
});

app.post('/api/reset-demo', (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(401).json({ success: false, message: "Not logged in" });
    db.run(`UPDATE users SET demo_balance = 50000 WHERE id = ?`, [userId], function(err) {
        if (err) return res.status(500).json({ success: false, message: "Failed to reset demo" });
        logActivity(userId, "Reset Demo balance to $50,000", "🔄");
        res.json({ success: true, message: "Demo balance reset to $50,000" });
    });
});

app.post('/api/change-password', (req, res) => {
    const { userId, currentPassword, newPassword } = req.body;
    if (!userId || !currentPassword || !newPassword) return res.status(400).json({ success: false, message: "Missing fields" });

    db.get(`SELECT password FROM users WHERE id = ?`, [userId], async (err, user) => {
        if (err || !user) return res.status(404).json({ success: false, message: "User not found" });
        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) return res.status(400).json({ success: false, message: "Current password is incorrect" });

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashedNewPassword, userId], function(err) {
            if (err) return res.status(500).json({ success: false, message: "Failed to update password" });
            logActivity(userId, "Changed account password", "⚙️");
            res.json({ success: true, message: "Password updated successfully" });
        });
    });
});

app.post('/api/log-transaction', (req, res) => {
    const { userId, type, amount, details } = req.body;
    if (!userId) return res.status(401).json({ success: false, message: "Not logged in" });

    db.run(`INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, 'Processing')`,
        [userId, type, amount, details], function(err) {
            if (err) return res.status(500).json({ success: false, message: "Failed to log transaction" });
            logActivity(userId, `Initiated ${type} of $${amount}`, type === 'deposit' ? '💳' : '🏧');
            res.json({ success: true, message: "Transaction logged" });
        });
});

app.get('/api/activities/:userId', (req, res) => {
    const userId = req.params.userId;
    db.all(`SELECT * FROM activities WHERE user_id = ? ORDER BY timestamp DESC LIMIT 30`, [userId], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: "Failed to fetch activities" });
        res.json({ success: true, activities: rows });
    });
});

app.get('/api/finance-ledger/:userId', (req, res) => {
    const userId = req.params.userId;
    db.all(`SELECT id, pair as title, amount, result as status, timestamp, 'trade' as type FROM trades WHERE user_id = ?`, [userId], (err, trades) => {
        if (err) return res.status(500).json({ success: false, message: "Failed to fetch ledger" });
        db.all(`SELECT id, details as title, amount, status, timestamp, type FROM transactions WHERE user_id = ?`, [userId], (err, txs) => {
            if (err) return res.status(500).json({ success: false, message: "Failed to fetch ledger" });
            let allTransactions = [...trades, ...txs];
            allTransactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            res.json({ success: true, ledger: allTransactions });
        });
    });
});

app.get('/api/progress-stats/:userId/:accountType', (req, res) => {
    const userId = req.params.userId;
    const accountType = req.params.accountType;
    db.all(`SELECT amount, result, timestamp FROM trades WHERE user_id = ? AND account_type = ? ORDER BY timestamp ASC`, [userId, accountType], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: "Failed to fetch stats" });
        let bestTrade = 0, totalVolume = 0, totalWins = 0, currentStreak = 0, maxStreak = 0;
        let dailyProfit = {};
        rows.forEach(r => {
            totalVolume += r.amount;
            if (r.result === 'WIN') {
                totalWins++;
                let profit = r.amount * 0.92;
                if (profit > bestTrade) bestTrade = profit;
                currentStreak++;
                if (currentStreak > maxStreak) maxStreak = currentStreak;
            } else if (r.result === 'LOSS') { currentStreak = 0; }
            let dateStr = new Date(r.timestamp).toISOString().split('T')[0];
            if (!dailyProfit[dateStr]) dailyProfit[dateStr] = 0;
            if (r.result === 'WIN') dailyProfit[dateStr] += (r.amount * 0.92);
            else if (r.result === 'LOSS') dailyProfit[dateStr] -= r.amount;
        });
        let last7Days = [];
        for (let i = 6; i >= 0; i--) {
            let d = new Date();
            d.setDate(d.getDate() - i);
            let dateStr = d.toISOString().split('T')[0];
            last7Days.push({ date: d.toLocaleDateString('en-US', { weekday: 'short' }), profit: dailyProfit[dateStr] || 0 });
        }
        res.json({ success: true, bestTrade: bestTrade.toFixed(2), totalVolume: totalVolume.toFixed(2), maxStreak: maxStreak, totalWins: totalWins, last7Days: last7Days });
    });
});

app.get('/api/trade-history/:userId', (req, res) => {
    const userId = req.params.userId;
    db.all(`SELECT * FROM trades WHERE user_id = ? ORDER BY timestamp DESC LIMIT 15`, [userId], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: "Failed to fetch history" });
        res.json({ success: true, history: rows });
    });
});

app.get('/api/today-stats/:userId/:accountType', (req, res) => {
    const userId = req.params.userId;
    const accountType = req.params.accountType;
    db.all(`SELECT amount, result FROM trades WHERE user_id = ? AND account_type = ? AND DATE(timestamp) = DATE('now')`, [userId, accountType], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: "Failed to fetch stats" });
        let totalTrades = rows.length;
        let wins = rows.filter(r => r.result === 'WIN').length;
        let winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : 0;
        let totalProfit = 0;
        rows.forEach(r => {
            if (r.result === 'WIN') totalProfit += (r.amount * 0.92);
            else if (r.result === 'LOSS') totalProfit -= r.amount;
        });
        res.json({ success: true, totalTrades, winRate, totalProfit: totalProfit.toFixed(2) });
    });
});

app.get('/api/user-data/:userId', (req, res) => {
    const userId = req.params.userId;
    db.get(`SELECT demo_balance, real_balance FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ success: false, message: "User not found" });
        db.all(`SELECT * FROM trades WHERE user_id = ? ORDER BY timestamp DESC LIMIT 10`, [userId], (err, trades) => {
            res.json({ success: true, balances: user, history: trades });
        });
    });
});

app.get('/api/ai-status', (req, res) => {
    let mockRSI = Math.floor(Math.random() * 40) + 30;
    let trend = mockRSI > 50 ? "Bullish" : "Bearish";
    let suggestion = mockRSI > 60 ? "BUY" : mockRSI < 40 ? "SELL" : "NEUTRAL";
    res.json({ success: true, rsi: mockRSI, trend: trend, volatility: "Medium", suggestion: suggestion });
});

app.get('/api/live-signal', (req, res) => {
    let mockPrice = 1.0850 + (Math.random() - 0.5) * 0.005;
    let rsi = Math.floor(Math.random() * 40) + 30;
    let signal = rsi > 60 ? "BUY" : rsi < 40 ? "SELL" : "NEUTRAL";
    res.json({
        success: true, pair: "EUR/USD", direction: signal,
        entry: mockPrice.toFixed(5), tp: (mockPrice + 0.0020).toFixed(5), sl: (mockPrice - 0.0010).toFixed(5),
        strength: rsi, status: "Active"
    });
});

app.listen(PORT, () => {
    console.log(`Backend Server running on port ${PORT}`);
});
