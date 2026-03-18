const WebSocket = require('ws');

function generateHexBoardData() {
    const R = 2;
    const sqrt3 = Math.sqrt(3);
    const layers = [
        { L: 1, count: 1 },
        { L: 1.5, count: 2 },
        { L: 2, count: 3 },
        { L: 2.5, count: 4 },
        { L: 3, count: 5 },
        { L: 3.5, count: 6 },
        { L: 4, count: 7 },
        { L: 4.5, count: 8 },
        { L: 5, count: 7 },
        { L: 5.5, count: 8 },
        { L: 6, count: 7 },
        { L: 6.5, count: 8 },
        { L: 7, count: 7 },
        { L: 7.5, count: 8 },
        { L: 8, count: 7 },
        { L: 8.5, count: 8 },
        { L: 9, count: 7 },
        { L: 9.5, count: 8 },
        { L: 10, count: 7 },
        { L: 10.5, count: 8 },
        { L: 11, count: 7 },
        { L: 11.5, count: 8 },
        { L: 12, count: 7 },
        { L: 12.5, count: 6 },
        { L: 13, count: 5 },
        { L: 13.5, count: 4 },
        { L: 14, count: 3 },
        { L: 14.5, count: 2 },
        { L: 15, count: 1 }
    ];

    const vertexMap = new Map(); // key: "x,y" -> id
    const vertices = [];         // 每个元素 { x, y }
    const hexagons = [];         // 每个六边形存储其6个顶点ID

    // 顶点偏移（顺时针：右、右下、左下、左、左上、右上）
    const dx = [R, R / 2, -R / 2, -R, -R / 2, R / 2];
    const dy = [0, R * sqrt3 / 2, R * sqrt3 / 2, 0, -R * sqrt3 / 2, -R * sqrt3 / 2];

    for (let layer of layers) {
        const L = layer.L;
        const n = layer.count;
        // 中心y坐标：y = (L-1) * R * sqrt3   (y向下为正)
        const cy = (L - 1) * R * sqrt3;
        // 中心x坐标：从 -3*(n-1) 到 3*(n-1)，步长6
        for (let i = 0; i < n; i++) {
            const cx = 3 * (- (n - 1) + 2 * i); // 即 -3*(n-1) + 6*i
            const hexVtxIds = [];
            for (let j = 0; j < 6; j++) {
                const x = cx + dx[j];
                const y = cy + dy[j];
                const key = `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
                if (!vertexMap.has(key)) {
                    const id = vertices.length;
                    vertexMap.set(key, id);
                    vertices.push({ x, y });
                    hexVtxIds.push(id);
                } else {
                    hexVtxIds.push(vertexMap.get(key));
                }
            }
            hexagons.push(hexVtxIds);
        }
    }

    const V = vertices.length;
    console.log(`总顶点数: ${V}`); // 应为384

    // 构建邻居关系（无向图）
    const neighbors = Array.from({ length: V }, () => new Set());
    for (let hex of hexagons) {
        for (let i = 0; i < 6; i++) {
            const a = hex[i];
            const b = hex[(i + 1) % 6];
            if (a !== b) {
                neighbors[a].add(b);
                neighbors[b].add(a);
            }
        }
    }

    const neighborList = neighbors.map(set => Array.from(set));
    return { vertexCount: V, neighbors: neighborList };
}

const { vertexCount, neighbors } = generateHexBoardData();

// ==================== 服务端状态 ====================
let blackSocket = null;
let whiteSocket = null;
let blackTaken = false;
let whiteTaken = false;

let board = Array(vertexCount).fill(0);      // 0空 1黑 2白
let currentPlayer = 1;
let historyBoards = [];                       // 历史棋盘深拷贝数组
let historyMarkers = [];                       // 历史落子标记（顶点ID）
let gameOver = false;
let passCounter = 0;

let lastMoveMarkers = [];                      // 当前最后一步的顶点ID数组（通常只有一个）

function copyBoard(src) {
    return src.slice();
}

function boardsEqual(b1, b2) {
    for (let i = 0; i < vertexCount; i++) {
        if (b1[i] !== b2[i]) return false;
    }
    return true;
}

// 判断一组棋子是否有气
function hasLiberty(boardState, start, visited = null) {
    const color = boardState[start];
    if (color === 0) return false;
    const queue = [start];
    const visitedLocal = visited || new Array(vertexCount).fill(false);
    visitedLocal[start] = true;
    let idx = 0;
    while (idx < queue.length) {
        const v = queue[idx++];
        for (let nb of neighbors[v]) {
            if (boardState[nb] === 0) return true;
            if (boardState[nb] === color && !visitedLocal[nb]) {
                visitedLocal[nb] = true;
                queue.push(nb);
            }
        }
    }
    return false;
}

// 移除无气的棋子（整个组）
function removeGroup(boardState, start) {
    const color = boardState[start];
    if (color === 0) return;
    const queue = [start];
    boardState[start] = 0;
    let idx = 0;
    while (idx < queue.length) {
        const v = queue[idx++];
        for (let nb of neighbors[v]) {
            if (boardState[nb] === color) {
                boardState[nb] = 0;
                queue.push(nb);
            }
        }
    }
}

// 尝试落子，返回新棋盘或null
function tryPlaceStone(boardBefore, vertex, playerVal) {
    if (boardBefore[vertex] !== 0) return null;
    let newBoard = copyBoard(boardBefore);
    newBoard[vertex] = playerVal;

    // 先检查并移除对方无气棋子
    for (let v = 0; v < vertexCount; v++) {
        if (newBoard[v] === 3 - playerVal && !hasLiberty(newBoard, v)) {
            removeGroup(newBoard, v);
        }
    }

    // 检查己方刚落子的棋子是否有气（如果无气，则自杀禁止）
    if (!hasLiberty(newBoard, vertex)) {
        return null; // 自杀
    }

    return newBoard;
}

function copyMarkers(markers) {
    return markers.map(m => ({ vertex: m.vertex, color: m.color }));
}

// WebSocket服务器
module.exports = function (wss) {

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
            lastMoveMarkers: lastMoveMarkers
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
            }

            else if (type === 'move') {
                if (gameOver) return;
                const playerVal = (ws.playerColor === 'black' ? 1 : 2);
                if (playerVal !== currentPlayer) return;
                if (!msg.board || !msg.nextPlayer) return;

                historyBoards.push(copyBoard(board));
                historyMarkers.push(copyMarkers(lastMoveMarkers));

                board = msg.board;
                currentPlayer = msg.nextPlayer;
                lastMoveMarkers = msg.lastMoveMarkers || [];

                broadcast({
                    type: 'broadcast',
                    action: 'move',
                    board: board,
                    currentPlayer: currentPlayer,
                    historyBoards: historyBoards,
                    lastMoveMarkers: lastMoveMarkers
                }, null);

                passCounter = 0;
            }

            else if (type === 'pass') {
                if (gameOver) return;
                if (ws.playerColor !== (currentPlayer === 1 ? 'black' : 'white')) return;

                historyBoards.push(copyBoard(board));
                historyMarkers.push(copyMarkers(lastMoveMarkers));

                currentPlayer = currentPlayer === 1 ? 2 : 1;
                passCounter++;
                lastMoveMarkers = [];

                broadcast({
                    type: 'broadcast',
                    action: 'pass',
                    board: board,
                    currentPlayer: currentPlayer,
                    historyBoards: historyBoards,
                    lastMoveMarkers: lastMoveMarkers,
                    player: ws.playerColor
                }, null);

                if (passCounter >= 4) {
                    gameOver = true;
                    broadcast({ type: 'broadcast', action: 'endAgreed', board: board, currentPlayer: currentPlayer });
                }
            }

            else if (type === 'undoRequest') {
                const target = (ws.playerColor === 'black' ? whiteSocket : blackSocket);
                if (target) target.send(JSON.stringify({ type: 'undoRequest' }));
            }

            else if (type === 'undoResponse') {
                if (msg.accept) {
                    if (historyBoards.length > 0) {
                        board = copyBoard(historyBoards.pop());
                        lastMoveMarkers = historyMarkers.length > 0 ? copyMarkers(historyMarkers.pop()) : [];
                        currentPlayer = currentPlayer === 1 ? 2 : 1;
                    }
                    broadcast({
                        type: 'broadcast',
                        action: 'undoAccept',
                        board: board,
                        currentPlayer: currentPlayer,
                        historyBoards: historyBoards,
                        lastMoveMarkers: lastMoveMarkers
                    });
                }
                passCounter = 0;
            }

            else if (type === 'endRequest') {
                const target = (ws.playerColor === 'black' ? whiteSocket : blackSocket);
                if (target) target.send(JSON.stringify({ type: 'endRequest' }));
                passCounter = 0;
            }

            else if (type === 'endResponse') {
                if (msg.accept) {
                    gameOver = true;
                    broadcast({ type: 'broadcast', action: 'endAgreed', board: board, currentPlayer: currentPlayer });
                }
                passCounter = 0;
            }

            else if (type === 'resign') {
                gameOver = true;
                broadcast({ type: 'broadcast', action: 'resign', player: ws.playerColor });
                passCounter = 0;
            }

            // ----- 新局 -----
            else if (type === 'newGame') {
                // 重置所有状态
                board = Array(vertexCount).fill(0);
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

    console.log('六角围棋服务已启动');
};
