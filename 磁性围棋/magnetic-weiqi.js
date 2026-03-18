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
    let historyMarkers = [];      // 历史落子标记数组
    let gameOver = false;
    let passCounter = 0;         // 连续虚着计数器，达到4自动终局

    // 状态记录（用于悔棋回退）
    let lastUsedShapeByColor = { 1: -1, 2: -1 }; // 标准围棋无用，但保留以兼容
    let lastMoveMarkers = [];

    function copyBoard(src) {
        return src.map(row => row.slice());
    }

    function copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
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

        // 同步当前完整状态
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

            // ----- 走子 -----
            if (type === 'move') {
                if (gameOver) return;
                const playerVal = (ws.playerColor === 'black' ? 1 : 2);
                if (playerVal !== currentPlayer) return;
                if (!msg.board || !msg.nextPlayer) return;

                // 保存当前状态到历史
                historyBoards.push(copyBoard(board));
                historyMarkers.push(copyMarkers(lastMoveMarkers));

                board = msg.board;
                currentPlayer = msg.nextPlayer;
                lastUsedShapeByColor = msg.lastUsedShapeByColor || { 1: -1, 2: -1 };
                lastMoveMarkers = msg.lastMoveMarkers || [];

                // 广播给除发送者外的所有客户端（对方）
                broadcast({
                    type: 'broadcast',
                    action: 'move',
                    board: board,
                    currentPlayer: currentPlayer,
                    lastUsedShapeByColor: lastUsedShapeByColor,
                    lastMoveMarkers: lastMoveMarkers
                }, ws); // 排除自己

                passCounter = 0;
                return;
            }

            // ----- 虚着 -----
            if (type === 'pass') {
                if (gameOver) return;
                if (ws.playerColor !== (currentPlayer === 1 ? 'black' : 'white')) return;

                if (msg.lastUsedShapeByColor) {
                    lastUsedShapeByColor = msg.lastUsedShapeByColor;
                } else {
                    const clearer = (currentPlayer === 1 ? 1 : 2);
                    lastUsedShapeByColor[clearer] = -1;
                }

                // 虚着也作为一步，保存历史
                historyBoards.push(copyBoard(board));
                historyMarkers.push(copyMarkers(lastMoveMarkers));

                currentPlayer = currentPlayer === 1 ? 2 : 1;
                passCounter++;
                lastMoveMarkers = []; // 虚着后无落子标记

                broadcast({
                    type: 'broadcast',
                    action: 'pass',
                    board: board,
                    currentPlayer: currentPlayer,
                    lastUsedShapeByColor: lastUsedShapeByColor,
                    player: ws.playerColor,
                    lastMoveMarkers: lastMoveMarkers
                }, ws); // 排除自己

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
                    if (historyBoards.length > 0) {
                        board = copyBoard(historyBoards.pop());
                        // 恢复对应的落子标记
                        lastMoveMarkers = historyMarkers.length > 0 ? copyMarkers(historyMarkers.pop()) : [];
                        // 切换玩家
                        currentPlayer = currentPlayer === 1 ? 2 : 1;
                    }
                    broadcast({
                        type: 'broadcast',
                        action: 'undoAccept',
                        board: board,
                        currentPlayer: currentPlayer,
                        historyBoards: historyBoards, // 悔棋时需下发完整历史
                        lastUsedShapeByColor: lastUsedShapeByColor,
                        lastMoveMarkers: lastMoveMarkers
                    }, null); // 发给所有人
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

                // 清除所有客户端的颜色标记
                wss.clients.forEach(client => {
                    client.playerColor = undefined;
                });

                // 广播新局消息（包含棋盘、当前玩家、空标记及颜色占用状态）
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

    console.log('磁性围棋服务已启动');
};
