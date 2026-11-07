const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json()); // Allows us to read JSON data from the frontend

// This tells the server to serve your HTML, CSS, and JS files
app.use(express.static(path.join(__dirname, './')));

// A simple test API endpoint
app.get('/api/status', (req, res) => {
  res.json({
    status: "Online",
    platform: "POCKET-AI-SIGNAL",
    time: new Date()
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Backend Server is running on port ${PORT}`);
});
