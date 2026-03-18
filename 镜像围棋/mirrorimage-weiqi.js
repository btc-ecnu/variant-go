const WebSocket = require('ws');

module.exports = function (wss) {
    let blackSocket = null;
    let whiteSocket = null;
    let blackTaken = false;
    let whiteTaken = false;

    let board = Array(19).fill().map(() => Array(19).fill(0));
    let currentPlayer = 1;
    let historyBoards = [];
    let historyMarkers = [];
    let historyMirrorAxis = [];
    let gameOver = false;
    let passCounter = 0;
    let lastMoveMarkers = [];

    let mirrorAxis = 'diag1';

    function copyBoard(src) {
        return src.map(row => row.slice());
    }

    function copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    function getMirrorAxisForHand(hand) {
        if (hand === 1) return 'diag1';
        if (hand === 2) return 'diag2';
        const axes = ['horizontal', 'vertical', 'diag1', 'diag2'];
        return axes[Math.floor(Math.random() * axes.length)];
    }

    function broadcast(data, exclude = null) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client !== exclude) {
                client.send(JSON.stringify(data));
            }
        });
    }

    wss.on('connection', (ws) => {
        ws.send(JSON.stringify({
            type: 'init',
            blackTaken,
            whiteTaken
        }));

        ws.send(JSON.stringify({
            type: 'gameState',
            board: board,
            currentPlayer: currentPlayer,
            historyBoards: historyBoards,
            lastMoveMarkers: lastMoveMarkers,
            mirrorAxis: mirrorAxis
        }));

        ws.on('message', (raw) => {
            const msg = JSON.parse(raw);
            const { type } = msg;

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

            if (type === 'move') {
                if (gameOver) return;
                const playerVal = (ws.playerColor === 'black' ? 1 : 2);
                if (playerVal !== currentPlayer) return;
                if (msg.mirrorAxis !== mirrorAxis) {
                    console.warn('镜面不匹配');
                    return;
                }
                if (!msg.board || !msg.nextPlayer) return;

                // 保存当前状态到历史
                historyBoards.push(copyBoard(board));
                historyMarkers.push(copyMarkers(lastMoveMarkers));
                historyMirrorAxis.push(mirrorAxis); // 保存当前镜面

                board = msg.board;
                currentPlayer = msg.nextPlayer;
                lastMoveMarkers = msg.lastMoveMarkers || [];

                // 计算下一手镜面
                const nextHand = historyBoards.length + 1;
                mirrorAxis = getMirrorAxisForHand(nextHand);

                broadcast({
                    type: 'broadcast',
                    action: 'move',
                    board: board,
                    currentPlayer: currentPlayer,
                    lastMoveMarkers: lastMoveMarkers,
                    mirrorAxis: mirrorAxis
                }, null);

                passCounter = 0;
                return;
            }

            if (type === 'pass') {
                if (gameOver) return;
                if (ws.playerColor !== (currentPlayer === 1 ? 'black' : 'white')) return;

                historyBoards.push(copyBoard(board));
                historyMarkers.push(copyMarkers(lastMoveMarkers));
                historyMirrorAxis.push(mirrorAxis);

                currentPlayer = currentPlayer === 1 ? 2 : 1;
                passCounter++;
                lastMoveMarkers = [];

                const nextHand = historyBoards.length + 1;
                mirrorAxis = getMirrorAxisForHand(nextHand);

                broadcast({
                    type: 'broadcast',
                    action: 'pass',
                    board: board,
                    currentPlayer: currentPlayer,
                    player: ws.playerColor,
                    lastMoveMarkers: lastMoveMarkers,
                    mirrorAxis: mirrorAxis
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

            if (type === 'undoRequest') {
                const target = (ws.playerColor === 'black' ? whiteSocket : blackSocket);
                if (target) target.send(JSON.stringify({ type: 'undoRequest' }));
                return;
            }
            if (type === 'undoResponse') {
                if (msg.accept) {
                    if (historyBoards.length > 0) {
                        board = copyBoard(historyBoards.pop());
                        lastMoveMarkers = historyMarkers.length > 0 ? copyMarkers(historyMarkers.pop()) : [];
                        mirrorAxis = historyMirrorAxis.pop(); // 恢复上一手镜面
                        currentPlayer = currentPlayer === 1 ? 2 : 1;
                    }

                    broadcast({
                        type: 'broadcast',
                        action: 'undoAccept',
                        board: board,
                        currentPlayer: currentPlayer,
                        historyBoards: historyBoards,
                        lastMoveMarkers: lastMoveMarkers,
                        mirrorAxis: mirrorAxis
                    }, null);
                }
                passCounter = 0;
                return;
            }

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

            if (type === 'newGame') {
                board = Array(19).fill().map(() => Array(19).fill(0));
                currentPlayer = 1;
                historyBoards = [];
                historyMarkers = [];
                historyMirrorAxis = []; // 清空历史镜面
                lastMoveMarkers = [];
                gameOver = false;
                passCounter = 0;
                blackTaken = false;
                whiteTaken = false;
                blackSocket = null;
                whiteSocket = null;
                mirrorAxis = 'diag1';

                wss.clients.forEach(client => {
                    client.playerColor = undefined;
                });

                broadcast({
                    type: 'newGame',
                    board: board,
                    currentPlayer: currentPlayer,
                    lastMoveMarkers: lastMoveMarkers,
                    blackTaken: blackTaken,
                    whiteTaken: whiteTaken,
                    mirrorAxis: mirrorAxis
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

    console.log('镜像围棋服务已启动');
};
