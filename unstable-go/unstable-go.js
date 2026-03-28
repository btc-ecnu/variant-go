**Refining Undo Handling**

I'm now implementing the undo mechanism and related communication. The game now handles `undoRequest` and `undoResponse` actions between players. An undo request message is sent to the opponent, and acceptance restores the board state to the previous turn. I've focused on ensuring the player state is consistent with the history.


**Implementing Resign and Reset**

I'm now integrating the resign action, and the new game features, into the Go game.  I'm handling game over and reseting the room's state. I'm focusing on ensuring accurate board updates on resign, along with a `newGame` scenario for clean restarts.


**Finalizing Reset Logic**

My focus is currently on the complete reset flow after a game ends, integrating the server's response to the new game request. I've reset room parameters like `board`, `unstableInfo`, `moveCount`, `currentPlayer`, `gameOver`, and `passCounter`. Player colors are cleared, the client is notified, and a new game starts in the room. I will ensure this works for all users.


**Finalizing Broadcasts**

I'm now implementing the final logic for broadcasting the entire game state, including `board`, `unstableInfo`, and related variables, after each move or pass action. I'm broadcasting the current room state after validation, including the new values for `lastMoveMarkers`, `blackTaken`, and `whiteTaken`. The logic ensures the current player and board are synced.


**Finalizing Client Integration**

I'm now integrating the final pieces for seamless client-server interaction within the Go game, finalizing the client-side handlers for `resign`, `undo`, `newGame`. The client now updates the game display to show an updated room list, and is fully reacting to these new actions. I'm focusing on handling `broadcast` messages to the client correctly, and ensuring the `leaveRoom` logic works correctly.


**Finalizing Testing and Deployment**

I'm now completing the final testing and preparing for deployment. I'm verifying all game states, especially the `broadcast` updates from the server, client-side actions, and handling any client-side inconsistencies. I'm making certain the server and client seamlessly manage `resign`, `undo`, and `newGame` scenarios, as well as ensure the lobby displays room information accurately. I'm focusing on ensuring everything is working and fully integrated.


**Refining the UI**

I'm now implementing the CSS changes to refine the Lobby display. I'm focusing on the room display's appearance using CSS, specifically applying new styles and classes to make it look nicer. I've been making sure the UI works and looks great!


**Updating the Lobby Display**

I'm now integrating the updated room list display with the new CSS. I'm focusing on ensuring it looks and functions according to design. I've been making sure the UI works and looks great! Specifically, I'm refactoring CSS and JS to make sure the lobby is visually appealing.


**Implementing Lobby Interactions**

I'm now integrating the lobby's user interactions and UI updates. I've added event listeners for room creation (public/private) and joining, handling prompt inputs and WebSocket messages.  The leave room button, now functional, correctly hides the game area and redisplays the lobby. I'm focusing on responsiveness and smooth lobby transitions.


**Finalizing Error Handling**

I'm now implementing robust error handling for user interactions. I'm focusing on the `joinRoom` and `createRoom` processes, and displaying clear, informative error messages to the user. I'm handling invalid room IDs, incorrect passwords, and room full situations. I am now refining the UI to clearly show these errors.


**Finalizing User Experience**

I'm now putting the finishing touches on the user experience. I am making updates to ensure robust error handling for user interactions, displaying clear error messages for invalid room IDs, incorrect passwords, or full rooms. The UI now reflects these scenarios clearly. I'm ensuring a smooth and intuitive flow through the lobby and game.


**Refining HTML and UI**

I'm now implementing the changes for the HTML, by removing and adding elements. I'm focusing on the CSS styling of the lobby and implementing the UI logic to make the CSS work as expected. I need to ensure the HTML and JavaScript work seamlessly with the changes.


**Finalizing Gameplay Logic**

I'm now fully ensuring that the gameplay actions - moves and passes - are working in the new UI and functionality. I've integrated all of the recent updates and actions, and ensured that the server and client are in sync. I will make sure the UI matches the new gameplay as expected.


**Validating Score Calculation**

I'm now confirming the scoring logic after removing estimate and request features. I've retained the core score calculation, ensuring it functions correctly post four consecutive passes. This includes the end-game score display. I'm verifying the `computeScoreFromBoard` and related methods accurately reflect game results. I've cleaned up the UI elements to only display the score at the automated game end.


**Refining UI Cleanup**

I've decided to remove the score box from the HTML, which simplifies the UI and aligns with removing all estimate and end-request features. I'll also add room ID information to the top panel to provide more context. My plan is now to ensure that the scoring is only shown as an alert.


**Refining Display Integration**

My current focus is on integrating the new room ID display in the top panel and refining the overall UI for a more polished look and consistent scoring. I'm now making sure the room ID is displaying correctly in the top panel. I'm removing the score box element in the HTML.


**Finalizing Code Cleanup**

I'm now putting the finishing touches on removing the old features and cleaning the codebase. I'm focusing on ensuring the client UI correctly hides the game area and displays the lobby after `leaveRoom`. I've also refactored and simplified the HTML, CSS, and JavaScript. I'm making sure all game containers are set to `display: none;` by default.


**Refining UI Display**

I'm now restructuring the HTML to improve the layout. I've introduced a `game-wrapper` class to manage container alignment, and updated the visibility for `lobbyContainer` and `gameContainer`. I'm removing the old features such as `drawEstimateOverlay`, and now using `clearEstimate` and more. I am keeping `computeScoreFromBoard` for the `endAgreed` alert.


**Validating Scoring Display**

I'm now confirming the integration and display of the game end alert, including scoring, after four passes. I've verified the `computeScoreFromBoard` is triggered correctly, and the alert shows appropriate results. Additionally, I've confirmed room list order updates. I've validated that the UI updates correctly after a player joins and leaves a room.


为满足你的需求，我针对原代码的单例模式（所有连接共享同一棋盘）进行了全方位的重构。这需要将服务器从管理“全局单一状态”转变为管理“以 `roomId` 为键的房间 Map”。

### 逻辑与架构变更说明
1. **彻底移除 `形势判断` 和 `申请终局`：**
   前端删除了相关按钮、事件绑定以及用于“形势判断”所绘制的遮罩层；后端的 WebSocket 通信中移除了对应的 `endRequest` 和 `undoRequest/undoResponse`（这部分原封不动保留了悔棋，但移除了终局申请）。只保留了在双方“连续四次虚着”时自动触发底层数子以判断胜负的逻辑。
2. **状态隔离设计：**
   将所有棋盘、颜色占用、历史记录等状态封装在一个 Room 对象中。通过生成 4 位随机数字作为唯一标识。
3. **大厅交互闭环：**
   - 玩家连接后，默认下发当前的房间列表缓存，并进入大厅。
   - 当点击加入/创建时，如果成功，服务器响应 `joinSuccess` 以使客户端切换到棋盘 UI。同时会在游戏顶栏额外显示当前所在的“房间号”。
   - 补充了**“返回大厅”**的功能以保证体验闭环。离开房间时会注销对应的座位。如果房间内的人数为 0，系统将自动销毁该房间。

下面是修改后的两个核心文件（`server.js` 保持原样即可）：

### 1. `unstable-weiqi.js` (服务端逻辑修改)

```javascript
const WebSocket = require('ws');

module.exports = function (wss) {
    // 使用 Map 管理多个房间，key 为 4位字符串 roomId
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
            historyStates: [],
            lastMoveMarkers:[],
            gameOver: false,
            passCounter: 0
        };
    }

    function copyBoard(src) {
        return src.map(row => row.slice());
    }

    function copyMarkers(markers) {
        return markers.map(m => ({ row: m.row, col: m.col, color: m.color }));
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
        // 按创建时间从新到旧排序
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
            // 只向未加入房间的玩家广播大厅列表
            if (client.readyState === WebSocket.OPEN && !client.roomId) {
                client.send(payload);
            }
        });
    }

    function joinRoom(ws, roomId) {
        const room = rooms.get(roomId);
        if (!room) return;
        
        // 如果此前在别的房间，先退出
        leaveRoom(ws);

        ws.roomId = roomId;
        ws.playerColor = undefined;
        room.clients.add(ws);
        
        // 告知客户端加入成功并进入房间UI
        ws.send(JSON.stringify({ type: 'joinSuccess', roomId }));

        // 下发房间初始信息与状态
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

        // 更新大厅状态
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
            // 通知房间内其他人座位已空出
            broadcastToRoom(room, { type: 'init', blackTaken: room.blackTaken, whiteTaken: room.whiteTaken });

            // 房间为空时自动销毁
            if (room.clients.size === 0) {
                rooms.delete(room.id);
            }
            broadcastRoomList();
        }
        ws.roomId = null;
    }

    wss.on('connection', (ws) => {
        ws.roomId = null;

        // 连接建立立刻发送当前房间列表
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

            // ===== 大厅专属逻辑 =====
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

            // ===== 房间内游戏逻辑 =====
            // 下列操作必须依赖合法的 roomId 才能执行
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
                broadcastRoomList(); // 状态改变需同步给大厅
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
                room.lastMoveMarkers = msg.lastMoveMarkers ||[];

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
                room.lastMoveMarkers = msg.lastMoveMarkers ||[];
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
                room.historyStates = [];
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
                
                broadcastRoomList(); // 颜色清空，通知大厅刷新UI
                return;
            }
        });

        ws.on('close', () => {
            leaveRoom(ws);
        });
    });

    console.log('不稳定围棋服务(含房间机制)已启动');
};