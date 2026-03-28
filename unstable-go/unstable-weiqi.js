const WebSocket = require('ws');

module.exports = function (wss) {
    let blackSocket = null;
    let whiteSocket = null;
    let blackTaken = false;
    let whiteTaken = false;

    let board = Array(19).fill().map(() => Array(19).fill(0));
    let unstableInfo = Array(19).fill().map(() => Array(19).fill(0));
    let moveCount = 0;
    let currentPlayer = 1;        // 1:黑, 2:白
    let historyStates = [];       // 历史状态数组，每个元素是 {board, unstableInfo, moveCount, lastMoveMarkers}
    let lastMoveMarkers = [];
    let gameOver = false;
    let passCounter = 0;          // 连续虚着计数器，达到4自动终局

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
            unstableInfo: unstableInfo,
            moveCount: moveCount,
            currentPlayer: currentPlayer,
            historyStates: historyStates,
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

                // 保存当前状态到历史
                historyStates.push({
                    board: copyBoard(board),
                    unstableInfo: copyBoard(unstableInfo),
                    moveCount: moveCount,
                    lastMoveMarkers: copyMarkers(lastMoveMarkers)
                });

                // 更新状态
                board = msg.board;
                unstableInfo = msg.unstableInfo;
                moveCount = msg.moveCount;
                currentPlayer = msg.nextPlayer;
                lastMoveMarkers = msg.lastMoveMarkers || [];

                // 广播给除发送者外的所有客户端
                broadcast({
                    type: 'broadcast',
                    action: 'move',
                    board: board,
                    unstableInfo: unstableInfo,
                    moveCount: moveCount,
                    currentPlayer: currentPlayer,
                    lastMoveMarkers: lastMoveMarkers
                }, ws);

                passCounter = 0;
                return;
            }

            // ----- 虚着 -----
            if (type === 'pass') {
                if (gameOver) return;
                if (ws.playerColor !== (currentPlayer === 1 ? 'black' : 'white')) return;

                // 保存历史
                historyStates.push({
                    board: copyBoard(board),
                    unstableInfo: copyBoard(unstableInfo),
                    moveCount: moveCount,
                    lastMoveMarkers: copyMarkers(lastMoveMarkers)
                });

                board = msg.board;
                unstableInfo = msg.unstableInfo;
                moveCount = msg.moveCount;
                currentPlayer = msg.nextPlayer;
                lastMoveMarkers = msg.lastMoveMarkers || [];
                passCounter++;

                broadcast({
                    type: 'broadcast',
                    action: 'pass',
                    board: board,
                    unstableInfo: unstableInfo,
                    moveCount: moveCount,
                    currentPlayer: currentPlayer,
                    player: ws.playerColor,
                    lastMoveMarkers: lastMoveMarkers
                }, ws);

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
                // 【修复】：增加 readyState 检查，防止向已断开的 socket 写入导致进程崩溃
                if (target && target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify({ type: 'undoRequest' }));
                }
                return;
            }

            if (type === 'undoResponse') {
                if (msg.accept) {
                    if (historyStates.length > 0) {
                        let prev = historyStates.pop();
                        board = prev.board;
                        unstableInfo = prev.unstableInfo;
                        moveCount = prev.moveCount;
                        lastMoveMarkers = prev.lastMoveMarkers;
                        currentPlayer = currentPlayer === 1 ? 2 : 1; // 切换玩家（因为悔棋后轮到对方）
                    }
                    broadcast({
                        type: 'broadcast',
                        action: 'undoAccept',
                        board: board,
                        unstableInfo: unstableInfo,
                        moveCount: moveCount,
                        currentPlayer: currentPlayer,
                        historyStates: historyStates, // 发送完整历史，以便客户端重建
                        lastMoveMarkers: lastMoveMarkers
                    }, null);
                }
                passCounter = 0;
                return;
            }

            // ----- 终局申请 -----
            if (type === 'endRequest') {
                const target = (ws.playerColor === 'black' ? whiteSocket : blackSocket);
                // 【修复】：同上
                if (target && target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify({ type: 'endRequest' }));
                }
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
                unstableInfo = Array(19).fill().map(() => Array(19).fill(0));
                moveCount = 0;
                currentPlayer = 1;
                historyStates = [];
                lastMoveMarkers = [];
                gameOver = false;
                passCounter = 0;
                blackTaken = false;
                whiteTaken = false;
                blackSocket = null;
                whiteSocket = null;

                wss.clients.forEach(client => {
                    client.playerColor = undefined;
                });

                broadcast({
                    type: 'newGame',
                    board: board,
                    unstableInfo: unstableInfo,
                    moveCount: moveCount,
                    currentPlayer: currentPlayer,
                    lastMoveMarkers: lastMoveMarkers,
                    blackTaken: blackTaken,
                    whiteTaken: whiteTaken
                }, null);
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

    console.log('不稳定围棋服务已启动');
};
