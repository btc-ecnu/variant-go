const WebSocket = require('ws');

module.exports = function (wss) {
    // 单房间状态
    let blackSocket = null;
    let whiteSocket = null;
    let blackTaken = false;
    let whiteTaken = false;

    // 权威棋盘 & 对局状态
    let board = Array(19).fill().map(() => Array(19).fill(0));
    let currentPlayer = 1;        // 1:黑, 2:白
    let historyBoards = [];       // 历史棋盘深拷贝数组
    let gameOver = false;
    let passCounter = 0;         // 连续虚着计数器，达到4自动终局

    let lastUsedShapeByColor = { 1: -1, 2: -1 };
    let historyLastUsed = [];    // 存储每一步后的lastUsedShapeByColor深拷贝
    let lastMoveMarkers = [];    // 当前落子标记

    function copyBoard(src) {
        return src.map(row => row.slice());
    }

    function copyLastUsed(obj) {
        return { 1: obj[1], 2: obj[2] };
    }

    function broadcast(data, exclude = null) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client !== exclude) {
                client.send(JSON.stringify(data));
            }
        });
    }

    wss.on('connection', (ws) => {
        // 发送初始占用状态
        ws.send(JSON.stringify({
            type: 'init',
            blackTaken,
            whiteTaken
        }));

        // 同步当前完整状态（包含禁用形状和落子标记）
        ws.send(JSON.stringify({
            type: 'gameState',
            board: board,
            currentPlayer: currentPlayer,
            historyBoards: historyBoards,
            lastUsedShapeByColor: lastUsedShapeByColor,
            lastMoveMarkers: lastMoveMarkers
        }));

        ws.on('message', (raw) => {
            const msg = JSON.parse(raw);
            const { type } = msg;

            // ----- 选色 -----
            if (type === 'selectColor') {
                const color = msg.color;
                if (color === 'black' && !blackTaken) {
                    blackTaken = true;
                    blackSocket = ws;
                    ws.playerColor = 'black';
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: 'black' }));
                    broadcast({ type: 'init', blackTaken, whiteTaken }, ws);
                } else if (color === 'white' && !whiteTaken) {
                    whiteTaken = true;
                    whiteSocket = ws;
                    ws.playerColor = 'white';
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: 'white' }));
                    broadcast({ type: 'init', blackTaken, whiteTaken }, ws);
                } else {
                    ws.send(JSON.stringify({ type: 'colorTaken' }));
                }
                passCounter = 0;
                return;
            }

            // ----- 走子（携带完整状态）-----
            if (type === 'move') {
                if (gameOver) return;
                const playerVal = (ws.playerColor === 'black' ? 1 : 2);
                if (playerVal !== currentPlayer) return;
                if (!msg.board || !msg.nextPlayer) return;

                // 保存当前状态到历史
                historyBoards.push(copyBoard(board));
                historyLastUsed.push(copyLastUsed(lastUsedShapeByColor));

                // 更新服务器状态
                board = msg.board;
                currentPlayer = msg.nextPlayer;
                lastUsedShapeByColor = msg.lastUsedShapeByColor || { 1: -1, 2: -1 };
                lastMoveMarkers = msg.lastMoveMarkers || [];

                // 广播给所有人
                broadcast({
                    type: 'broadcast',
                    action: 'move',
                    board: board,
                    currentPlayer: currentPlayer,
                    historyBoards: historyBoards,
                    lastUsedShapeByColor: lastUsedShapeByColor,
                    lastMoveMarkers: lastMoveMarkers
                }, null);

                passCounter = 0;
                return;
            }

            // ----- 虚着-----
            if (type === 'pass') {
                if (gameOver) return;
                if (ws.playerColor !== (currentPlayer === 1 ? 'black' : 'white')) return;

                // 虚着清除当前玩家的禁用形状（客户端会发来更新后的状态）
                // 我们期望客户端在pass时发送最新的lastUsedShapeByColor
                if (msg.lastUsedShapeByColor) {
                    lastUsedShapeByColor = msg.lastUsedShapeByColor;
                } else {
                    // 降级处理：清除当前玩家的禁用
                    const player = currentPlayer === 1 ? 1 : 2; // 注意：虚着时当前玩家是即将切换的？我们应清除发起者的禁用
                    const clearer = (currentPlayer === 1 ? 1 : 2); // 发起者
                    lastUsedShapeByColor[clearer] = -1;
                }

                // 保存历史（虚着也作为一步？我们决定虚着也入历史，以便悔棋回退）
                historyBoards.push(copyBoard(board));
                historyLastUsed.push(copyLastUsed(lastUsedShapeByColor));

                // 切换玩家
                currentPlayer = currentPlayer === 1 ? 2 : 1;
                passCounter++;

                // 虚着后清除落子标记
                lastMoveMarkers = [];

                broadcast({
                    type: 'broadcast',
                    action: 'pass',
                    board: board,
                    currentPlayer: currentPlayer,
                    historyBoards: historyBoards,
                    lastUsedShapeByColor: lastUsedShapeByColor,
                    player: ws.playerColor
                }, null);

                if (passCounter >= 4) {
                    gameOver = true;
                    broadcast({
                        type: 'broadcast',
                        action: 'endAgreed',
                        board: board,
                        currentPlayer: currentPlayer
                    });
                }
                return;
            }

            // ----- 悔棋请求 -----
            if (type === 'undoRequest') {
                const target = (ws.playerColor === 'black' ? whiteSocket : blackSocket);
                if (target) target.send(JSON.stringify({ type: 'undoRequest' }));
                return;
            }
            if (type === 'undoResponse') {
                if (msg.accept) {
                    // 从历史中恢复上一步
                    if (historyBoards.length > 0) {
                        board = copyBoard(historyBoards.pop());
                        // 恢复禁用状态
                        if (historyLastUsed.length > 0) {
                            lastUsedShapeByColor = copyLastUsed(historyLastUsed.pop());
                        } else {
                            lastUsedShapeByColor = { 1: -1, 2: -1 };
                        }
                        // 切换玩家
                        currentPlayer = currentPlayer === 1 ? 2 : 1;
                        // 悔棋后应清除当前落子标记，或者恢复上一步的标记？我们恢复上一步的标记较为合理，但为了简单，清除标记
                        lastMoveMarkers = [];
                    }
                    broadcast({
                        type: 'broadcast',
                        action: 'undoAccept',
                        board: board,
                        currentPlayer: currentPlayer,
                        historyBoards: historyBoards,
                        lastUsedShapeByColor: lastUsedShapeByColor,
                        lastMoveMarkers: lastMoveMarkers
                    });
                }
                passCounter = 0;
                return;
            }

            // ----- 终局申请 -----
            if (type === 'endRequest') {
                const target = (ws.playerColor === 'black' ? whiteSocket : blackSocket);
                if (target) target.send(JSON.stringify({ type: 'endRequest' }));
                passCounter = 0;
                return;
            }

            if (type === 'endResponse') {
                if (msg.accept) {
                    gameOver = true;
                    broadcast({
                        type: 'broadcast',
                        action: 'endAgreed',
                        board: board,
                        currentPlayer: currentPlayer
                    });
                }
                passCounter = 0;
                return;
            }

            // ----- 认输 -----
            if (type === 'resign') {
                gameOver = true;
                broadcast({
                    type: 'broadcast',
                    action: 'resign',
                    player: ws.playerColor
                });
                passCounter = 0;
                return;
            }

            // ----- 新局 -----
            if (type === 'newGame') {
                // 重置所有状态
                board = Array(19).fill().map(() => Array(19).fill(0));
                currentPlayer = 1;
                historyBoards = [];
                historyMarkers = [];
                lastMoveMarkers = [];
                gameOver = false;
                passCounter = 0;
                blackTaken = false;
                whiteTaken = false;
                blackSocket = null;
                whiteSocket = null;
                lastUsedShapeByColor = { 1: -1, 2: -1 };

                // 清除所有客户端的颜色标记
                wss.clients.forEach(client => {
                    client.playerColor = undefined;
                });

                // 广播新局消息
                broadcast({
                    type: 'newGame',
                    board: board,
                    currentPlayer: currentPlayer,
                    lastMoveMarkers: lastMoveMarkers,
                    blackTaken: blackTaken,
                    whiteTaken: whiteTaken
                }, null); // 发给所有人
                return;
            }

        });

        // 连接关闭，释放颜色
        ws.on('close', () => {
            if (ws.playerColor === 'black') {
                blackTaken = false;
                blackSocket = null;
            }
            if (ws.playerColor === 'white') {
                whiteTaken = false;
                whiteSocket = null;
            }
            broadcast({ type: 'init', blackTaken, whiteTaken });
        });
    });

    console.log('乌克兰围棋服务已启动');
};
