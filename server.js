const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, './')));

// --- TELEGRAM CONFIGURATION ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramMessage(message) {
    console.log("Checking Telegram variables... Token exists:", !!TELEGRAM_TOKEN, "Chat ID exists:", !!TELEGRAM_CHAT_ID);
    
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
        console.log("Telegram credentials missing. Skipping notification.");
        return;
    }
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });
        console.log("Telegram alert sent successfully!");
    } catch (error) {
        console.error("Telegram error:", error);
    }
}

// --- DATABASE (Temporary Memory) ---
let serverBalances = { demo: 50000, real: 110 };

app.get('/api/get-balance', (req, res) => {
    res.json({ success: true, demoBalance: serverBalances.demo, realBalance: serverBalances.real });
});

app.post('/api/update-balance', (req, res) => {
    const { accountType, amount, tradeData } = req.body;
    
    if (accountType === 'demo' || accountType === 'real') {
        serverBalances[accountType] += amount;
        
        // If trade data is provided, send a Telegram Alert!
        if (tradeData) {
            let action = tradeData.direction === 'BUY' ? '🟢 BUY' : '🔴 SELL';
            let msg = `<b>New Trade Executed</b>\n\n` +
                      `Pair: ${tradeData.pair}\n` +
                      `Action: ${action}\n` +
                      `Amount: $${tradeData.amount}\n` +
                      `Account: ${accountType.toUpperCase()}\n` +
                      `Expiry: ${tradeData.expiry}s`;
            sendTelegramMessage(msg);
        }
        
        res.json({ success: true, newBalance: serverBalances[accountType] });
    } else {
        res.status(400).json({ success: false, message: "Invalid account type" });
    }
});

app.listen(PORT, () => {
    console.log(`Backend Server running on port ${PORT}`);
});
