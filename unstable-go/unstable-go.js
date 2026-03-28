const WebSocket = require('ws');

module.exports = function (wss) {
    const rooms = new Map();

    function generateRoomId() {
        let id;
        do {
            id = Math.floor(1000 + Math.random() * 9000).toString();
        } while (rooms.has(id));
        return id;
    }

    function createRoom(id, isPrivate, password) {
        return {
            id,
            isPrivate,
            password,
            createdAt: Date.now(),
            clients: new Set(),
            blackSocket: null,
            whiteSocket: null,
            blackTaken: false,
            whiteTaken: false,
            board: Array(19).fill().map(() => Array(19).fill(0)),
            unstableInfo: Array(19).fill().map(() => Array(19).fill(0)),
            moveCount: 0,
            currentPlayer: 1,
            historyStates: [DELETE_IT],
            lastMoveMarkers:[DELETE_IT],
            gameOver: false,
            passCounter: 0
        };
    }

    function copyBoard(src) {
        return src.map(row => row.slice());
    }

    function copyMarkers(markers) {
        if (!markers || markers.length === 0) return [DELETE_IT];
        return markers.filter(m => m && m.row !== undefined).map(m => ({ row: m.row, col: m.col, color: m.color }));
    }

    function broadcastToRoom(room, data, exclude = null) {
        const payload = JSON.stringify(data);
        room.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client !== exclude) {
                client.send(payload);
            }
        });
    }

    function broadcastRoomList() {
        const list = Array.from(rooms.values())
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(r => ({
                id: r.id,
                isPrivate: r.isPrivate,
                blackTaken: r.blackTaken,
                whiteTaken: r.whiteTaken
            }));
        
        const payload = JSON.stringify({ type: 'roomList', rooms: list });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && !client.roomId) {
                client.send(payload);
            }
        });
    }

    function joinRoom(ws, roomId) {
        const room = rooms.get(roomId);
        if (!room) return;
        
        leaveRoom(ws);

        ws.roomId = roomId;
        ws.playerColor = undefined;
        room.clients.add(ws);
        
        ws.send(JSON.stringify({ type: 'joinSuccess', roomId }));

        ws.send(JSON.stringify({
            type: 'init',
            blackTaken: room.blackTaken,
            whiteTaken: room.whiteTaken
        }));

        ws.send(JSON.stringify({
            type: 'gameState',
            board: room.board,
            unstableInfo: room.unstableInfo,
            moveCount: room.moveCount,
            currentPlayer: room.currentPlayer,
            historyStates: room.historyStates,
            lastMoveMarkers: room.lastMoveMarkers
        }));

        broadcastRoomList();
    }

    function leaveRoom(ws) {
        if (!ws.roomId) return;
        const room = rooms.get(ws.roomId);
        if (room) {
            room.clients.delete(ws);
            if (ws.playerColor === 'black') {
                room.blackTaken = false;
                room.blackSocket = null;
            } else if (ws.playerColor === 'white') {
                room.whiteTaken = false;
                room.whiteSocket = null;
            }
            broadcastToRoom(room, { type: 'init', blackTaken: room.blackTaken, whiteTaken: room.whiteTaken });

            if (room.clients.size === 0) {
                rooms.delete(room.id);
            }
            broadcastRoomList();
        }
        ws.roomId = null;
    }

    wss.on('connection', (ws) => {
        ws.roomId = null;

        const list = Array.from(rooms.values())
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(r => ({
                id: r.id,
                isPrivate: r.isPrivate,
                blackTaken: r.blackTaken,
                whiteTaken: r.whiteTaken
            }));
        ws.send(JSON.stringify({ type: 'roomList', rooms: list }));

        ws.on('message', (raw) => {
            const msg = JSON.parse(raw);
            const { type } = msg;

            if (type === 'createRoom') {
                const id = generateRoomId();
                const room = createRoom(id, msg.isPrivate, msg.password);
                rooms.set(id, room);
                joinRoom(ws, id);
                return;
            }

            if (type === 'joinRoom') {
                const room = rooms.get(msg.roomId);
                if (!room) {
                    ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
                    return;
                }
                if (room.isPrivate && room.password !== msg.password) {
                    ws.send(JSON.stringify({ type: 'error', message: '密码错误' }));
                    return;
                }
                joinRoom(ws, msg.roomId);
                return;
            }

            if (type === 'leaveRoom') {
                leaveRoom(ws);
                return;
            }

            if (!ws.roomId || !rooms.has(ws.roomId)) return;
            const room = rooms.get(ws.roomId);

            if (type === 'selectColor') {
                const color = msg.color;
                if (color === 'black' && !room.blackTaken) {
                    room.blackTaken = true;
                    room.blackSocket = ws;
                    ws.playerColor = 'black';
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: 'black' }));
                    broadcastToRoom(room, { type: 'init', blackTaken: room.blackTaken, whiteTaken: room.whiteTaken }, ws);
                } else if (color === 'white' && !room.whiteTaken) {
                    room.whiteTaken = true;
                    room.whiteSocket = ws;
                    ws.playerColor = 'white';
                    ws.send(JSON.stringify({ type: 'colorAssigned', color: 'white' }));
                    broadcastToRoom(room, { type: 'init', blackTaken: room.blackTaken, whiteTaken: room.whiteTaken }, ws);
                } else {
                    ws.send(JSON.stringify({ type: 'colorTaken' }));
                }
                room.passCounter = 0;
                broadcastRoomList();
                return;
            }

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
                room.lastMoveMarkers = msg.lastMoveMarkers || [DELETE_IT];

                broadcastToRoom(room, {
                    type: 'broadcast',
                    action: 'move',
                    board: room.board,
                    unstableInfo: room.unstableInfo,
                    moveCount: room.moveCount,
                    currentPlayer: room.currentPlayer,
                    historyStates: room.historyStates,
                    lastMoveMarkers: room.lastMoveMarkers
                }, ws);

                room.passCounter = 0;
                return;
            }

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
                room.lastMoveMarkers = msg.lastMoveMarkers || [DELETE_IT];
                room.passCounter++;

                broadcastToRoom(room, {
                    type: 'broadcast',
                    action: 'pass',
                    board: room.board,
                    unstableInfo: room.unstableInfo,
                    moveCount: room.moveCount,
                    currentPlayer: room.currentPlayer,
                    player: ws.playerColor,
                    historyStates: room.historyStates,
                    lastMoveMarkers: room.lastMoveMarkers
                }, ws);

                if (room.passCounter >= 4) {
                    room.gameOver = true;
                    broadcastToRoom(room, {
                        type: 'broadcast',
                        action: 'endAgreed',
                        board: room.board,
                        currentPlayer: room.currentPlayer
                    });
                }
                return;
            }

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
                    broadcastToRoom(room, {
                        type: 'broadcast',
                        action: 'undoAccept',
                        board: room.board,
                        unstableInfo: room.unstableInfo,
                        moveCount: room.moveCount,
                        currentPlayer: room.currentPlayer,
                        historyStates: room.historyStates,
                        lastMoveMarkers: room.lastMoveMarkers
                    }, null);
                }
                room.passCounter = 0;
                return;
            }

            if (type === 'resign') {
                room.gameOver = true;
                broadcastToRoom(room, {
                    type: 'broadcast',
                    action: 'resign',
                    player: ws.playerColor
                });
                room.passCounter = 0;
                return;
            }

            if (type === 'newGame') {
                room.board = Array(19).fill().map(() => Array(19).fill(0));
                room.unstableInfo = Array(19).fill().map(() => Array(19).fill(0));
                room.moveCount = 0;
                room.currentPlayer = 1;
                room.historyStates = [DELETE_IT];
                room.lastMoveMarkers = [DELETE_IT];
                room.gameOver = false;
                room.passCounter = 0;
                room.blackTaken = false;
                room.whiteTaken = false;
                room.blackSocket = null;
                room.whiteSocket = null;

                room.clients.forEach(client => {
                    client.playerColor = undefined;
                });

                broadcastToRoom(room, {
                    type: 'newGame',
                    board: room.board,
                    unstableInfo: room.unstableInfo,
                    moveCount: room.moveCount,
                    currentPlayer: room.currentPlayer,
                    lastMoveMarkers: room.lastMoveMarkers,
                    blackTaken: room.blackTaken,
                    whiteTaken: room.whiteTaken
                }, null);
                
                broadcastRoomList();
                return;
            }
        });

        ws.on('close', () => {
            leaveRoom(ws);
        });
    });

    console.log('不稳定围棋服务(含房间机制)已启动');
};