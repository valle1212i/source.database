// routes/index.js
const express = require('express');
const http = require('http');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// ── Whitelist för domäner ───────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  'https://source-database.onrender.com',
  'https://admin-portal-rn5z.onrender.com',
  'https://vattentrygg.se',
  'https://www.vattentrygg.se',
];

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true); // Postman/curl
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false); // blockera okända
  },
  credentials: false, // ändra till true om cookies ska skickas
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '50kb' }));

// ── Socket.IO ───────────────────────────────────────────────────────────────
const { Server } = require('socket.io');
const io = new Server(server, { cors: corsOptions });

// gör io tillgänglig för andra routes
app.set('io', io);

// Socket.IO events
io.on('connection', (socket) => {
  socket.on('join_site', (siteId) => {
    const room = typeof siteId === 'string' && siteId.trim() ? siteId.trim() : 'default';
    socket.join(`site:${room}`);
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/pageviews', require('./pageviews'));

// ── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Routes-server körs på port ${PORT}`);
});
