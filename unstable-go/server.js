const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const unstableGo = require('./unstable-go');

const app = express();
const server = http.createServer(app);

app.use(express.static(__dirname));

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    if (request.url === '/unstable-go') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

unstableGo(wss);

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`不稳定围棋服务已启动，监听端口: ${PORT}`);
});