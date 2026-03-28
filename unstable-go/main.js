const PADDING = 25;
const BOARD_SIZE = 19;
const KOMI = 3.25;
const CELL_SIZE = (600 - 2 * PADDING) / (BOARD_SIZE - 1);
const UNSTABLE_LIFETIME = 40;

const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
const isMouseDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
document.body.classList.add(isTouchDevice ? 'touch-device' : 'no-touch');

let board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
let unstableInfo = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
let moveCount = 0;
let bornAtMove = [];
let currentPlayer = 1;
let myColor = null;
let isMyTurn = false;
let hoverRow = -1, hoverCol = -1;
let isHoverValid = false;
let historyStates = [];
let lastMoveMarkers =[];
let currentRooms = [];

let ws;

const canvas = document.getElementById('goBoard');
const ctx = canvas.getContext('2d');
const turnDisplay = document.getElementById('turnDisplay');
const colorStatus = document.getElementById('colorStatus');
const radioBlack = document.getElementById('radioBlack');
const radioWhite = document.getElementById('radioWhite');
const roomIdDisplay = document.getElementById('roomIdDisplay');

function formatScore(num) {
    let str = num.toFixed(2);
    str = str.replace(/\.?0+$/, '');
    return str;
}

function copyState() {
    return {
        board: board.map(row => row.slice()),
        unstableInfo: unstableInfo.map(row => row.slice()),
        moveCount: moveCount,
        // 确保数组正确复制，规避空数组解构异常导致的污染
        lastMoveMarkers: (lastMoveMarkers && lastMoveMarkers.length > 0) ? lastMoveMarkers.map(m => ({ ...m })) : []
    };
}

function restoreState(state) {
    board = state.board.map(row => row.slice());
    unstableInfo = state.unstableInfo.map(row => row.slice());
    moveCount = state.moveCount;
    lastMoveMarkers = (state.lastMoveMarkers && state.lastMoveMarkers.length > 0) ? state.lastMoveMarkers.map(m => ({ ...m })) : [];
}

function stateToString(board, unstableInfo) {
    let rows = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        let row =[];
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (board[r][c] === 0) row.push('0');
            else {
                let colorChar = board[r][c] === 1 ? 'B' : 'W';
                if (unstableInfo[r][c] === 0) row.push(colorChar + 'S');
                else row.push(colorChar + 'U' + unstableInfo[r][c]);
            }
        }
        rows.push(row.join(','));
    }
    return rows.join(';');
}

function isRepeatBoard(newBoard, newUnstableInfo) {
    let newStr = stateToString(newBoard, newUnstableInfo);
    return historyStates.some(state => stateToString(state.board, state.unstableInfo) === newStr);
}

function removeGroup(board, unstableInfo, row, col, color) {
    let queue = [[row, col]];
    board[row][col] = 0;
    unstableInfo[row][col] = 0;
    while (queue.length) {
        let [r, c] = queue.shift();
        const dirs = [[-1, 0], [1, 0], [0, -1],[0, 1]];
        for (let [dr, dc] of dirs) {
            let nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === color) {
                board[nr][nc] = 0;
                unstableInfo[nr][nc] = 0;
                queue.push([nr, nc]);
            }
        }
    }
}

function hasLiberty(board, row, col) {
    let color = board[row][col];
    if (color === 0) return false;
    let visited = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(false));
    let queue = [[row, col]];
    visited[row][col] = true;
    const dirs = [[-1, 0], [1, 0],[0, -1], [0, 1]];
    while (queue.length) {
        let[r, c] = queue.shift();
        for (let [dr, dc] of dirs) {
            let nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
            if (board[nr][nc] === 0) return true;
            if (board[nr][nc] === color && !visited[nr][nc]) {
                visited[nr][nc] = true;
                queue.push([nr, nc]);
            }
        }
    }
    return false;
}

function tryPlaceStone(row, col) {
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return false;
    const playerVal = myColor === 'black' ? 1 : 2;

    if (board[row][col] !== 0) {
        if (unstableInfo[row][col] === 0) return false;
        if (board[row][col] !== playerVal) return false;
    }

    let currentState = copyState();
    historyStates.push(currentState);
    let newMoveCount = moveCount + 1;

    let wasUnstable = (unstableInfo[row][col] !== 0);
    if (wasUnstable) {
        let born = unstableInfo[row][col];
        if (bornAtMove[born] && bornAtMove[born][0] === row && bornAtMove[born][1] === col) {
            bornAtMove[born] = null;
        }
        board[row][col] = 0;
        unstableInfo[row][col] = 0;
    }

    board[row][col] = playerVal;
    if (!wasUnstable) {
        unstableInfo[row][col] = newMoveCount;
        bornAtMove[newMoveCount] = [row, col];
    } else {
        unstableInfo[row][col] = 0;
    }

    for (let i = 0; i < BOARD_SIZE; i++) {
        for (let j = 0; j < BOARD_SIZE; j++) {
            if (board[i][j] === 3 - playerVal && !hasLiberty(board, i, j)) removeGroup(board, unstableInfo, i, j, 3 - playerVal);
        }
    }
    for (let i = 0; i < BOARD_SIZE; i++) {
        for (let j = 0; j < BOARD_SIZE; j++) {
            if (board[i][j] === playerVal && !hasLiberty(board, i, j)) removeGroup(board, unstableInfo, i, j, playerVal);
        }
    }

    let toDieBorn = newMoveCount - UNSTABLE_LIFETIME;
    if (toDieBorn >= 0 && bornAtMove[toDieBorn]) {
        let [r, c] = bornAtMove[toDieBorn];
        if (r !== undefined && c !== undefined && board[r][c] !== 0 && unstableInfo[r][c] === toDieBorn) {
            board[r][c] = 0;
            unstableInfo[r][c] = 0;
            bornAtMove[toDieBorn] = null;
        }
    }

    moveCount = newMoveCount;
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    lastMoveMarkers =[{ row, col, color: playerVal }];

    if (isRepeatBoard(board, unstableInfo)) {
        restoreState(currentState);
        historyStates.pop();
        return false;
    }
    return true;
}

function pass() {
    let currentState = copyState();
    historyStates.push(currentState);

    moveCount++;
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    lastMoveMarkers =[];

    let toDieBorn = moveCount - UNSTABLE_LIFETIME;
    if (toDieBorn >= 0 && bornAtMove[toDieBorn]) {
        let [r, c] = bornAtMove[toDieBorn];
        if (r !== undefined && c !== undefined && board[r][c] !== 0 && unstableInfo[r][c] === toDieBorn) {
            board[r][c] = 0;
            unstableInfo[r][c] = 0;
            bornAtMove[toDieBorn] = null;
        }
    }
    return true;
}

function drawBoard() {
    ctx.clearRect(0, 0, 600, 600);
    const cellSize = CELL_SIZE;

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#3a281c';
    for (let i = 0; i < BOARD_SIZE; i++) {
        ctx.beginPath();
        ctx.moveTo(PADDING + i * cellSize, PADDING);
        ctx.lineTo(PADDING + i * cellSize, 600 - PADDING);
        ctx.stroke();
        ctx.moveTo(PADDING, PADDING + i * cellSize);
        ctx.lineTo(600 - PADDING, PADDING + i * cellSize);
        ctx.stroke();
    }

    const stars = [3, 9, 15];
    ctx.fillStyle = '#3a281c';
    stars.forEach(r => stars.forEach(c => {
        ctx.beginPath();
        ctx.arc(PADDING + c * cellSize, PADDING + r * cellSize, cellSize * 0.12, 0, 2 * Math.PI);
        ctx.fill();
    }));

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (board[r][c] === 0) continue;
            const x = PADDING + c * cellSize;
            const y = PADDING + r * cellSize;
            const radius = cellSize * 0.44;

            ctx.shadowBlur = 6;
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowOffsetY = 2;

            const gradient = ctx.createRadialGradient(x - 3, y - 3, radius * 0.2, x, y, radius * 1.2);
            if (board[r][c] === 1) {
                gradient.addColorStop(0, '#444'); gradient.addColorStop(0.6, '#222'); gradient.addColorStop(1, '#111');
            } else {
                gradient.addColorStop(0, '#fff'); gradient.addColorStop(0.5, '#eee'); gradient.addColorStop(1, '#aaa');
            }
            ctx.beginPath(); ctx.arc(x, y, radius, 0, 2 * Math.PI); ctx.fillStyle = gradient; ctx.fill();

            ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
            ctx.beginPath(); ctx.arc(x - 3, y - 3, radius * 0.15, 0, 2 * Math.PI);
            ctx.fillStyle = board[r][c] === 1 ? '#444' : '#fff'; ctx.fill();

            if (unstableInfo[r][c] !== 0) {
                let remaining = unstableInfo[r][c] + UNSTABLE_LIFETIME - moveCount;
                if (remaining < 5) ctx.strokeStyle = '#ff0000';
                else if (board[r][c] === 1) ctx.strokeStyle = '#ff9900';
                else ctx.strokeStyle = '#0099ff';
                ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, radius + 1, 0, 2 * Math.PI); ctx.stroke();

                ctx.font = 'bold 10px Arial'; ctx.textBaseline = 'top';
                if (remaining < 5) ctx.fillStyle = '#ff0000';
                else if (board[r][c] === 1) ctx.fillStyle = '#ff9900';
                else ctx.fillStyle = '#0099ff';
                ctx.fillText(remaining, x - radius + 10, y - radius + 4);
            }
        }
    }

    const markLen = cellSize * 0.352;
    // 增加数据完整性校验，防止在特殊情况下 NaN 毒化 Canvas 绘制路径引起重绘冻结
    if (lastMoveMarkers && lastMoveMarkers.length > 0) {
        lastMoveMarkers.forEach((m) => {
            if (!m || m.row === undefined) return;
            const x = PADDING + m.col * cellSize; const y = PADDING + m.row * cellSize;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + markLen, y); ctx.lineTo(x, y + markLen); ctx.closePath();
            if (m.color === 1) ctx.fillStyle = '#ffffff'; else if (m.color === 2) ctx.fillStyle = '#222222'; else ctx.fillStyle = '#ff4444';
            ctx.fill();
        });
    }

    ctx.font = 'bold 14px Arial'; ctx.fillStyle = '#3a281c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let c = 0; c < BOARD_SIZE; c++) {
        ctx.fillText(String.fromCharCode(65 + c), PADDING + c * cellSize, 0.6 * PADDING);
    }
    for (let r = 0; r < BOARD_SIZE; r++) {
        ctx.fillText((r + 1).toString(), PADDING / 2, PADDING + r * cellSize);
    }

    if (isMyTurn && isHoverValid && hoverRow >= 0 && hoverCol >= 0) {
        let hoverVal = myColor === 'black' ? 1 : 2;
        if (board[hoverRow][hoverCol] === 0 || (unstableInfo[hoverRow][hoverCol] !== 0 && board[hoverRow][hoverCol] === hoverVal)) {
            ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.arc(PADDING + hoverCol * cellSize, PADDING + hoverRow * cellSize, cellSize * 0.44, 0, 2 * Math.PI);
            ctx.fillStyle = myColor === 'black' ? '#222' : '#ddd'; ctx.fill(); ctx.globalAlpha = 1.0;
        }
    }
}

function isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor) {
    const dirs = [[-1, 0], [1, 0],[0, -1], [0, 1]];
    for (let [dr, dc] of dirs) {
        let nr = libertyRow + dr, nc = libertyCol + dc;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
        if (board[nr][nc] === opponentColor) return true;
    }
    return false;
}

function removeDeadAndDying(srcBoard) {
    let boardCopy = srcBoard.map(row => row.slice());
    let changed = true;
    while (changed) {
        changed = false;
        let visited = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(false));
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (boardCopy[r][c] !== 0 && !visited[r][c]) {
                    let color = boardCopy[r][c];
                    let queue = [[r, c]]; visited[r][c] = true; let stones = [[r, c]]; let liberties = new Set();
                    let idx = 0;
                    while (idx < queue.length) {
                        let [rr, cc] = queue[idx++]; const dirs = [[-1, 0], [1, 0], [0, -1],[0, 1]];
                        for (let [dr, dc] of dirs) {
                            let nr = rr + dr, nc = cc + dc;
                            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
                            if (boardCopy[nr][nc] === 0) liberties.add(nr + ',' + nc);
                            else if (boardCopy[nr][nc] === color && !visited[nr][nc]) { visited[nr][nc] = true; queue.push([nr, nc]); stones.push([nr, nc]); }
                        }
                    }
                    if (liberties.size === 0) { for (let [rr, cc] of stones) boardCopy[rr][cc] = 0; changed = true; continue; }
                    if (liberties.size <= 2) {
                        let allLibertiesControlled = true;
                        for (let lib of liberties) {
                            let [lr, lc] = lib.split(',').map(Number);
                            if (!isLibertySurroundedByOpponent(boardCopy, lr, lc, 3 - color)) { allLibertiesControlled = false; break; }
                        }
                        if (allLibertiesControlled) { for (let [rr, cc] of stones) boardCopy[rr][cc] = 0; changed = true; }
                    }
                }
            }
        }
    }
    return boardCopy;
}

function assignTerritoryWithRange(liveBoard) {
    let blackStones = [], whiteStones = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (liveBoard[r][c] === 1) blackStones.push([r, c]);
            else if (liveBoard[r][c] === 2) whiteStones.push([r, c]);
        }
    }
    let territory = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (liveBoard[r][c] !== 0) continue;
            let minDistBlack = Infinity, minDistWhite = Infinity;
            for (let [br, bc] of blackStones) {
                let dist = Math.abs(r - br) + Math.abs(c - bc);
                if (dist < minDistBlack) minDistBlack = dist;
            }
            for (let [wr, wc] of whiteStones) {
                let dist = Math.abs(r - wr) + Math.abs(c - wc);
                if (dist < minDistWhite) minDistWhite = dist;
            }
            let range = (r <= 1 || r >= BOARD_SIZE - 2 || c <= 1 || c >= BOARD_SIZE - 2) ? 5 : 4;
            let blackInRange = minDistBlack <= range, whiteInRange = minDistWhite <= range;
            if (!blackInRange && !whiteInRange) territory[r][c] = 3;
            else if (blackInRange && !whiteInRange) territory[r][c] = 1;
            else if (!blackInRange && whiteInRange) territory[r][c] = 2;
            else {
                if (minDistBlack < minDistWhite) territory[r][c] = 1;
                else if (minDistWhite < minDistBlack) territory[r][c] = 2;
                else territory[r][c] = 3;
            }
        }
    }
    return territory;
}

function computeScoreFromBoard(srcBoard) {
    let liveBoard = removeDeadAndDying(srcBoard);
    let territory = assignTerritoryWithRange(liveBoard);
    let blackStones = 0, whiteStones = 0, blackTerritory = 0, whiteTerritory = 0, publicTerritory = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (liveBoard[r][c] === 1) blackStones++;
            else if (liveBoard[r][c] === 2) whiteStones++;
            else {
                if (territory[r][c] === 1) blackTerritory++;
                else if (territory[r][c] === 2) whiteTerritory++;
                else if (territory[r][c] === 3) publicTerritory++;
            }
        }
    }
    return {
        blackTotal: blackStones + blackTerritory + publicTerritory / 2,
        whiteTotal: whiteStones + whiteTerritory + publicTerritory / 2
    };
}

function updateTurn() {
    let totalHand = moveCount + 1;
    turnDisplay.innerText = currentPlayer === 1 ? '⚫ 第' + totalHand + '手' : '⚪ 第' + totalHand + '手';
    isMyTurn = (myColor === 'black' && currentPlayer === 1) || (myColor === 'white' && currentPlayer === 2);
    drawBoard();
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/unstable-go`;
    ws = new WebSocket(wsUrl);
    ws.onopen = () => console.log('已连接对弈服务器');
    ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
    ws.onclose = () => { colorStatus.innerText = '连接断开，重连中...'; setTimeout(connectWebSocket, 2000); };
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'roomList':
            currentRooms = msg.rooms;
            renderRoomList();
            break;
        case 'joinSuccess':
            roomIdDisplay.innerText = `房间: ${msg.roomId}`;
            document.getElementById('lobbyContainer').style.display = 'none';
            document.getElementById('gameContainer').style.display = 'block';
            drawBoard();
            break;
        case 'error':
            alert(msg.message);
            break;

        case 'init':
            radioBlack.disabled = msg.blackTaken;
            radioWhite.disabled = msg.whiteTaken;
            break;
        case 'colorAssigned':
            myColor = msg.color;
            colorStatus.innerText = `已选择: ${myColor === 'black' ? '黑方' : '白方'}`;
            if (myColor === 'black') radioBlack.checked = true; else radioWhite.checked = true;
            updateTurn();
            break;
        case 'colorTaken':
            alert('该颜色已被占用');
            break;
        case 'gameState':
            board = msg.board; unstableInfo = msg.unstableInfo; moveCount = msg.moveCount;
            currentPlayer = msg.currentPlayer; historyStates = msg.historyStates || [];
            lastMoveMarkers = msg.lastMoveMarkers || [];
            bornAtMove = [];
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    if (unstableInfo[r][c] !== 0) bornAtMove[unstableInfo[r][c]] = [r, c];
                }
            }
            drawBoard(); updateTurn();
            break;
        case 'broadcast':
            if (msg.action === 'move' || msg.action === 'pass' || msg.action === 'undoAccept') {
                board = msg.board; unstableInfo = msg.unstableInfo; moveCount = msg.moveCount;
                currentPlayer = msg.currentPlayer;
                if (msg.historyStates) historyStates = msg.historyStates;
                lastMoveMarkers = msg.lastMoveMarkers || [];
                bornAtMove = [];
                for (let r = 0; r < BOARD_SIZE; r++) {
                    for (let c = 0; c < BOARD_SIZE; c++) {
                        if (unstableInfo[r][c] !== 0) bornAtMove[unstableInfo[r][c]] = [r, c];
                    }
                }
                drawBoard(); updateTurn();
            } else if (msg.action === 'endAgreed') {
                let { blackTotal, whiteTotal } = computeScoreFromBoard(board);
                let lead = blackTotal - whiteTotal - 2 * KOMI;
                let winner = lead > 0 ? '黑胜' : '白胜';
                alert(`连续四次虚着，对局结束！\n黑: ${formatScore(blackTotal)} 白: ${formatScore(whiteTotal)} (贴${KOMI})\n${winner}`);
            } else if (msg.action === 'resign') {
                alert(`${msg.player} 认输，对局结束`);
                lastMoveMarkers = []; drawBoard();
            }
            break;
        case 'newGame':
            board = msg.board; unstableInfo = msg.unstableInfo || Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
            moveCount = msg.moveCount || 0; currentPlayer = msg.currentPlayer || 1;
            lastMoveMarkers = msg.lastMoveMarkers || [];
            historyStates = [];
            bornAtMove = [];
            myColor = null;
            radioBlack.checked = false;
            radioWhite.checked = false;
            radioBlack.disabled = msg.blackTaken;
            radioWhite.disabled = msg.whiteTaken;
            colorStatus.innerText = '未选择阵营';
            drawBoard();
            updateTurn();
            break;

        case 'undoRequest':
            if (confirm('对方请求悔棋，是否同意？')) {
                ws.send(JSON.stringify({ type: 'undoResponse', accept: true }));
            } else {
                ws.send(JSON.stringify({ type: 'undoResponse', accept: false }));
            }
            break;
    }
}

function renderRoomList() {
    const listContainer = document.getElementById('roomList');
    listContainer.innerHTML = '';

    if (currentRooms.length === 0) {
        listContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">暂无房间，去创建一个吧！</div>';
        return;
    }

    currentRooms.forEach(room => {
        const item = document.createElement('div');
        item.className = 'room-item';

        let statusText = '';
        if (room.blackTaken && room.whiteTaken) statusText = '对局中 (满员)';
        else if (room.blackTaken || room.whiteTaken) statusText = '等待中 (1/2)';
        else statusText = '空闲 (0/2)';

        const lockIcon = room.isPrivate ? ' 🔒' : '';

        item.innerHTML = `
            <div class="room-info">房间: ${room.id}${lockIcon} <span class="room-status">[${statusText}]</span></div>
            <button class="room-btn">加入房间</button>
        `;

        item.querySelector('.room-btn').addEventListener('click', () => {
            joinRoom(room.id, room.isPrivate);
        });

        listContainer.appendChild(item);
    });
}

function joinRoom(id, isPrivate) {
    let password = undefined;
    if (isPrivate) {
        password = prompt('请输入房间密码:');
        if (password === null) return;
    }
    ws.send(JSON.stringify({ type: 'joinRoom', roomId: id, password: password }));
}

document.getElementById('createPublicBtn').addEventListener('click', () => {
    ws.send(JSON.stringify({ type: 'createRoom', isPrivate: false }));
});

document.getElementById('createPrivateBtn').addEventListener('click', () => {
    const pwd = prompt('请设置四位及以上密码:');
    if (pwd !== null) {
        if (pwd.length >= 4) {
            ws.send(JSON.stringify({ type: 'createRoom', isPrivate: true, password: pwd }));
        } else {
            alert('密码长度过短，请至少输入4位！');
        }
    }
});

document.getElementById('joinRoomBtn').addEventListener('click', () => {
    const id = prompt('请输入4位房间号:');
    if (!id) return;
    // [修复] 此处将有误的转义 `\\d` 纠正为了正确的正则转义 `\d`
    if (!/^\d{4}$/.test(id)) {
        alert('请输入正确的房间号（4位纯数字）');
        return;
    }

    const room = currentRooms.find(r => r.id === id);
    if (!room) {
        alert('房间不存在');
        return;
    }

    joinRoom(id, room.isPrivate);
});

function commitMove(row, col) {
    if (!isMyTurn) return false;
    if (tryPlaceStone(row, col)) {
        ws.send(JSON.stringify({
            type: 'move',
            board: board,
            unstableInfo: unstableInfo,
            moveCount: moveCount,
            nextPlayer: currentPlayer,
            lastMoveMarkers: lastMoveMarkers
        }));
        updateTurn();
        return true;
    } else {
        alert('落子非法或禁全同');
        return false;
    }
}

function getClosestIntersection(x, y) {
    let minDist = Infinity;
    let closestRow = -1, closestCol = -1;
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const ix = PADDING + c * CELL_SIZE;
            const iy = PADDING + r * CELL_SIZE;
            const dist = Math.hypot(x - ix, y - iy);
            if (dist < minDist) {
                minDist = dist;
                closestRow = r;
                closestCol = c;
            }
        }
    }
    return { row: closestRow, col: closestCol };
}

canvas.addEventListener('click', (e) => {
    if (!isMyTurn) return;
    const rect = canvas.getBoundingClientRect();
    const scale = 600 / rect.width;
    const x = (e.clientX - rect.left) * scale;
    const y = (e.clientY - rect.top) * scale;
    const { row, col } = getClosestIntersection(x, y);
    commitMove(row, col);
});

if (isMouseDevice) {
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const scale = 600 / rect.width;
        const x = (e.clientX - rect.left) * scale;
        const y = (e.clientY - rect.top) * scale;
        const { row, col } = getClosestIntersection(x, y);
        hoverRow = row;
        hoverCol = col;
        isHoverValid = true;
        drawBoard();
    });
    canvas.addEventListener('mouseleave', () => {
        isHoverValid = false;
        hoverRow = -1; hoverCol = -1;
        drawBoard();
    });
}

document.getElementById('newGameBtn').addEventListener('click', () => {
    if (confirm('确定开始新的一局吗？')) {
        ws.send(JSON.stringify({ type: 'newGame' }));
    }
});

document.getElementById('passBtn').addEventListener('click', () => {
    if (!isMyTurn) return;
    if (pass()) {
        ws.send(JSON.stringify({
            type: 'pass',
            board: board,
            unstableInfo: unstableInfo,
            moveCount: moveCount,
            nextPlayer: currentPlayer,
            lastMoveMarkers: lastMoveMarkers,
            player: myColor
        }));
        updateTurn();
    }
});

document.getElementById('undoBtn').addEventListener('click', () => {
    ws.send(JSON.stringify({ type: 'undoRequest' }));
});

document.getElementById('resignBtn').addEventListener('click', () => {
    if (confirm('确定认输吗？')) ws.send(JSON.stringify({ type: 'resign', player: myColor }));
});

document.getElementById('leaveRoomBtn').addEventListener('click', () => {
    if (confirm('确定要离开房间返回大厅吗？（如果是对局中建议先认输）')) {
        ws.send(JSON.stringify({ type: 'leaveRoom' }));
        document.getElementById('gameContainer').style.display = 'none';
        document.getElementById('lobbyContainer').style.display = 'block';

        board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
        unstableInfo = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
        lastMoveMarkers = [];
        historyStates =[];
        bornAtMove = [];
        myColor = null;
        isMyTurn = false;
        roomIdDisplay.innerText = "房间: ----";
    }
});

radioBlack.addEventListener('change', function () {
    if (this.checked && !this.disabled) ws.send(JSON.stringify({ type: 'selectColor', color: 'black' }));
});

radioWhite.addEventListener('change', function () {
    if (this.checked && !this.disabled) ws.send(JSON.stringify({ type: 'selectColor', color: 'white' }));
});

connectWebSocket();