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
        real_balance REAL DEFAULT 110
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        pair TEXT,
        direction TEXT,
        amount REAL,
        entry_price REAL,
        expiry INTEGER,
        result TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// --- TELEGRAM CONFIGURATION ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramMessage(message) {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' })
        });
    } catch (error) { console.error("Telegram error:", error); }
}

// --- AUTHENTICATION ROUTES ---
app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: "Missing fields" });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (email, password) VALUES (?, ?)`, [email, hashedPassword], function(err) {
            if (err) return res.status(400).json({ success: false, message: "Email already exists" });
            res.json({ success: true, message: "User created", userId: this.lastID });
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (err || !user) return res.status(400).json({ success: false, message: "User not found" });
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ success: false, message: "Invalid password" });
        
        res.json({ success: true, userId: user.id, demoBalance: user.demo_balance, realBalance: user.real_balance });
    });
});

// --- TRADING ROUTES ---
app.post('/api/place-trade', (req, res) => {
    const { userId, accountType, amount, tradeData } = req.body;
    if (!userId) return res.status(401).json({ success: false, message: "Not logged in" });

    let balanceCol = accountType === 'demo' ? 'demo_balance' : 'real_balance';
    
    db.run(`UPDATE users SET ${balanceCol} = ${balanceCol} + ? WHERE id = ?`, [amount, userId], function(err) {
        if (err) return res.status(500).json({ success: false, message: "Trade failed" });
        
        if (tradeData) {
            db.run(`INSERT INTO trades (user_id, pair, direction, amount, entry_price, expiry) VALUES (?, ?, ?, ?, ?, ?)`, 
                [userId, tradeData.pair, tradeData.direction, amount, tradeData.entryPrice, tradeData.expiry]);

            let action = tradeData.direction === 'BUY' ? '🟢 BUY' : '🔴 SELL';
            let msg = `<b>New Trade Executed</b>\n\nUser ID: ${userId}\nPair: ${tradeData.pair}\nAction: ${action}\nAmount: $${amount}\nAccount: ${accountType.toUpperCase()}`;
            sendTelegramMessage(msg);
        }

        res.json({ success: true, message: "Trade placed" });
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

app.listen(PORT, () => {
    console.log(`Backend Server running on port ${PORT}`);
});
