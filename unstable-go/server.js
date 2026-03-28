// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const unstableWeiqi = require('./unstable-weiqi');

const app = express();
const server = http.createServer(app);

// 静态文件服务：提供前端 HTML 和可能的其他资源
// 建议将“不稳定围棋.html”重命名为“index.html”以方便默认访问
app.use(express.static(__dirname));

// 创建独立的 WebSocket Server，不直接绑定端口，而是挂载到 HTTP 服务器上
const wss = new WebSocket.Server({ noServer: true });

// 处理 WebSocket 的协议升级
server.on('upgrade', (request, socket, head) => {
    // 这里的路径必须与你 HTML 中的 wsUrl 路径一致
    if (request.url === '/unstable-weiqi') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// 将 WebSocket 实例传入你的业务逻辑模块
unstableWeiqi(wss);

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`不稳定围棋服务已启动，监听端口: ${PORT}`);
});