// unstable-weiqi.js
const WebSocket = require('ws');

module.exports = function (wss) {
    // 【修改】使用 Map 存储所有房间状态，键为 roomId
    const rooms = new Map();

    function copyBoard(src) {
        return src.map(row => row.slice());
    }

    function copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    // 【修改】广播函数增加 room 参数，只对该房间内的客户端广播
    function broadcast(room, data, exclude = null) {
        room.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client !== exclude) {
                client.send(JSON.stringify(data));
            }
        });
    }

    function createRoom(roomId, password) {
        return {
            roomId: roomId,
            password: password, // 如果为空字符串则表示无密码
            clients: new Set(),
            blackSocket: null,
            whiteSocket: null,
            blackTaken: false,
            whiteTaken: false,
            board: Array(19).fill().map(() => Array(19).fill(0)),
            unstableInfo: Array(19).fill().map(() => Array(19).fill(0)),
            moveCount: 0,
            currentPlayer: 1,        // 1:黑, 2:白
            historyStates: [],       // 历史状态数组
            lastMoveMarkers:[],
            gameOver: false,
            passCounter: 0
        };
    }

    wss.on('connection', (ws) => {
        // 【修改】客户端刚连接时不发送任何游戏数据，等待其发送 joinRoom 消息

        ws.on('message', (raw) => {
            const msg = JSON.parse(raw);
            const { type } = msg;

            // ----- 房间逻辑 -----
            if (type === 'joinRoom') {
                const roomId = msg.roomId;
                const password = msg.password || '';

                let room = rooms.get(roomId);

                if (!room) {
                    // 创建新房间
                    room = createRoom(roomId, password);
                    rooms.set(roomId, room);
                } else {
                    // 房间已存在，校验密码
                    if (room.password !== password) {
                        ws.send(JSON.stringify({ type: 'roomError', message: '房间密码错误' }));
                        return;
                    }
                }

                // 加入房间
                room.clients.add(ws);
                ws.roomId = roomId;

                // 发送成功加入房间的状态同步
                ws.send(JSON.stringify({
                    type: 'roomJoined',
                    roomId: roomId,
                    gameState: {
                        board: room.board,
                        unstableInfo: room.unstableInfo,
                        moveCount: room.moveCount,
                        currentPlayer: room.currentPlayer,
                        historyStates: room.historyStates,
                        lastMoveMarkers: room.lastMoveMarkers
                    },
                    blackTaken: room.blackTaken,
                    whiteTaken: room.whiteTaken
                }));
                return;
            }

            // 以下所有游戏逻辑，必须确保用户已经在一个房间内
            if (!ws.roomId) return;
            const room = rooms.get(ws.roomId);
            if (!room) return;

            // ----- 选色 -----
            if (type === 'selectColor') {
                const color = msg.color;
                if (color === 'black' && !room.blackTaken) {
                    // 如果原先选了白，释放白
                    if (ws.playerColor === 'white') {
                        room.whiteTaken = false;
                        room.whiteSocket = null;
                    }
                    room.blackTaken = true;
                    room.blackSocket = ws;
                    ws.playerColor = 'black';
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: 'black' }));
                    broadcast(room, { type: 'init', blackTaken: room.blackTaken, whiteTaken: room.whiteTaken });
                } else if (color === 'white' && !room.whiteTaken) {
                    // 如果原先选了黑，释放黑
                    if (ws.playerColor === 'black') {
                        room.blackTaken = false;
                        room.blackSocket = null;
                    }
                    room.whiteTaken = true;
                    room.whiteSocket = ws;
                    ws.playerColor = 'white';
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: 'white' }));
                    broadcast(room, { type: 'init', blackTaken: room.blackTaken, whiteTaken: room.whiteTaken });
                } else {
                    ws.send(JSON.stringify({ type: 'colorTaken' }));
                }
                room.passCounter = 0;
                return;
            }

            // ----- 走子 -----
            if (type === 'move') {
                if (room.gameOver) return;
                const playerVal = (ws.playerColor === 'black' ? 1 : 2);
                if (playerVal !== room.currentPlayer) return;

                room.historyStates.push({
                    board: copyBoard(room.board),
                    unstableInfo: copyBoard(room.unstableInfo),
                    moveCount: room.moveCount,
                    lastMoveMarkers: copyMarkers(room.lastMoveMarkers)
                });

                room.board = msg.board;
                room.unstableInfo = msg.unstableInfo;
                room.moveCount = msg.moveCount;
                room.currentPlayer = msg.nextPlayer;
                room.lastMoveMarkers = msg.lastMoveMarkers ||[];

                broadcast(room, {
                    type: 'broadcast', action: 'move',
                    board: room.board, unstableInfo: room.unstableInfo,
                    moveCount: room.moveCount, currentPlayer: room.currentPlayer,
                    historyStates: room.historyStates, lastMoveMarkers: room.lastMoveMarkers
                }, ws);

                room.passCounter = 0;
                return;
            }

            // ----- 虚着 -----
            if (type === 'pass') {
                if (room.gameOver) return;
                if (ws.playerColor !== (room.currentPlayer === 1 ? 'black' : 'white')) return;

                room.historyStates.push({
                    board: copyBoard(room.board),
                    unstableInfo: copyBoard(room.unstableInfo),
                    moveCount: room.moveCount,
                    lastMoveMarkers: copyMarkers(room.lastMoveMarkers)
                });

                room.board = msg.board;
                room.unstableInfo = msg.unstableInfo;
                room.moveCount = msg.moveCount;
                room.currentPlayer = msg.nextPlayer;
                room.lastMoveMarkers = msg.lastMoveMarkers ||[];
                room.passCounter++;

                broadcast(room, {
                    type: 'broadcast', action: 'pass',
                    board: room.board, unstableInfo: room.unstableInfo,
                    moveCount: room.moveCount, currentPlayer: room.currentPlayer,
                    player: ws.playerColor, historyStates: room.historyStates,
                    lastMoveMarkers: room.lastMoveMarkers
                }, ws);

                if (room.passCounter >= 4) {
                    room.gameOver = true;
                    broadcast(room, {
                        type: 'broadcast', action: 'endAgreed',
                        board: room.board, currentPlayer: room.currentPlayer
                    });
                }
                return;
            }

            // ----- 悔棋请求 -----
            if (type === 'undoRequest') {
                const target = (ws.playerColor === 'black' ? room.whiteSocket : room.blackSocket);
                if (target && target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify({ type: 'undoRequest' }));
                }
                return;
            }

            if (type === 'undoResponse') {
                if (msg.accept) {
                    if (room.historyStates.length > 0) {
                        let prev = room.historyStates.pop();
                        room.board = prev.board;
                        room.unstableInfo = prev.unstableInfo;
                        room.moveCount = prev.moveCount;
                        room.lastMoveMarkers = prev.lastMoveMarkers;
                        room.currentPlayer = room.currentPlayer === 1 ? 2 : 1;
                    }
                    broadcast(room, {
                        type: 'broadcast', action: 'undoAccept',
                        board: room.board, unstableInfo: room.unstableInfo,
                        moveCount: room.moveCount, currentPlayer: room.currentPlayer,
                        historyStates: room.historyStates, lastMoveMarkers: room.lastMoveMarkers
                    }, null);
                }
                room.passCounter = 0;
                return;
            }

            // ----- 终局申请 -----
            if (type === 'endRequest') {
                const target = (ws.playerColor === 'black' ? room.whiteSocket : room.blackSocket);
                if (target && target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify({ type: 'endRequest' }));
                }
                room.passCounter = 0;
                return;
            }
            if (type === 'endResponse') {
                if (msg.accept) {
                    room.gameOver = true;
                    broadcast(room, {
                        type: 'broadcast', action: 'endAgreed',
                        board: room.board, currentPlayer: room.currentPlayer
                    });
                }
                room.passCounter = 0;
                return;
            }

            // ----- 认输 -----
            if (type === 'resign') {
                room.gameOver = true;
                broadcast(room, { type: 'broadcast', action: 'resign', player: ws.playerColor });
                room.passCounter = 0;
                return;
            }

            // ----- 新局 -----
            if (type === 'newGame') {
                room.board = Array(19).fill().map(() => Array(19).fill(0));
                room.unstableInfo = Array(19).fill().map(() => Array(19).fill(0));
                room.moveCount = 0;
                room.currentPlayer = 1;
                room.historyStates =[];
                room.lastMoveMarkers =[];
                room.gameOver = false;
                room.passCounter = 0;
                room.blackTaken = false;
                room.whiteTaken = false;
                room.blackSocket = null;
                room.whiteSocket = null;

                room.clients.forEach(client => {
                    client.playerColor = undefined;
                });

                broadcast(room, {
                    type: 'newGame',
                    board: room.board,
                    unstableInfo: room.unstableInfo,
                    moveCount: room.moveCount,
                    currentPlayer: room.currentPlayer,
                    lastMoveMarkers: room.lastMoveMarkers,
                    blackTaken: room.blackTaken,
                    whiteTaken: room.whiteTaken
                }, null);
                return;
            }
        });

        ws.on('close', () => {
            // 【新增】清理内存与断线处理
            if (ws.roomId) {
                const room = rooms.get(ws.roomId);
                if (room) {
                    room.clients.delete(ws);
                    if (ws.playerColor === 'black') {
                        room.blackTaken = false;
                        room.blackSocket = null;
                    }
                    if (ws.playerColor === 'white') {
                        room.whiteTaken = false;
                        room.whiteSocket = null;
                    }

                    // 如果房间空了，销毁房间释放内存
                    if (room.clients.size === 0) {
                        rooms.delete(ws.roomId);
                    } else {
                        // 否则通知房间内其他人该颜色已空出
                        broadcast(room, { type: 'init', blackTaken: room.blackTaken, whiteTaken: room.whiteTaken });
                    }
                }
            }
        });
    });

    console.log('不稳定围棋服务已启动 (支持多房间机制)');
};