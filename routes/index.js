// server/index.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, {
  cors: { origin: ['https://kundensdomän.se', 'https://portal.dindomän.se'], credentials: false }
});



app.use(cors({ origin: true })); // justera för er domänlista
app.use(express.json({ limit: '50kb' }));

// Socket.IO: lägg på app så routern kan nå io
app.set('io', io);



// Tillåt portalen att ansluta i en "site-room"
io.on('connection', (socket) => {
  socket.on('join_site', (siteId) => {
    socket.join(`site:${siteId || 'default'}`);
  });
});

app.use('/api/pageviews', require('./pageviews'));

server.listen(process.env.PORT || 3000);
