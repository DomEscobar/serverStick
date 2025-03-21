import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { randomUUID } from 'crypto';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
	cors: {
		origin: '*', // In production, specify your client's origin
		methods: ['GET', 'POST']
	}
});

// Enable CORS
app.use(cors({
	origin: '*',
	methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// Port configuration
const PORT = process.env.PORT || 3001;

// Game state
let matchmakingQueue: Array<{
	userId: string;
	username: string;
	socketId: string;
	appearance: any;
}> = [];

let battles: Record<string, {
	battleId: string;
	code: string;
	player1: { userId: string; username: string; socketId: string; appearance: any; wins: number };
	player2?: { userId: string; username: string; socketId: string; appearance: any; wins: number };
	started: boolean;
}> = {};

// Generate a 6-character battle code
const generateBattleCode = (): string => {
	// Generate a simple 6-character code
	return Math.random().toString(36).substring(2, 8).toUpperCase();
};

// Broadcast the current queue to all connected clients
const broadcastQueueUpdate = () => {
	io.emit('QUEUE_UPDATE', { queue: matchmakingQueue });
};

// Process the matchmaking queue
const processMatchmaking = () => {
	// Need at least 2 players to make a match
	if (matchmakingQueue.length < 2) return;

	// Take the first two players in the queue
	const player1 = matchmakingQueue.shift();
	const player2 = matchmakingQueue.shift();

	if (!player1 || !player2) return;

	console.log(`Creating match between ${player1.username} and ${player2.username}`);

	// Create a battle ID
	const battleId = randomUUID();

	// Create a new battle
	battles[battleId] = {
		battleId,
		code: generateBattleCode(),
		player1: {
			...player1,
			wins: 0
		},
		player2: {
			...player2,
			wins: 0
		},
		started: true
	};

	// Notify both players with appearance data
	io.to(player1.socketId).emit('MATCH_FOUND', {
		battleId,
		opponentName: player2.username,
		opponentAppearance: player2.appearance,
	});

	io.to(player2.socketId).emit('MATCH_FOUND', {
		battleId,
		opponentName: player1.username,
		opponentAppearance: player1.appearance,
	});

	// Broadcast the updated queue
	broadcastQueueUpdate();
};

// Socket.IO connection handler
io.on('connection', (socket) => {
	console.log(`New client connected: ${socket.id}`);

	// Store userIds mapped to socket IDs for consistent tracking
	const userSocketMap = new Map<string, string>();

	// Send connection confirmation
	socket.emit('CONNECTED');

	// Handle messages from clients
	socket.on('message', (message) => {
		if (message.type !== 'GET_QUEUE' && message.type !== 'PING') {
			console.log('Received message:', message.type, 'from user:', message.userId);
		}

		// Keep track of user ID to socket ID mapping
		if (message.userId) {
			userSocketMap.set(message.userId, socket.id);
			console.log(`Mapped user ${message.userId} to socket ${socket.id}`);
		}

		switch (message.type) {
			case 'JOIN_QUEUE':
				// Add the player to the matchmaking queue
				const playerInfo = {
					userId: message.userId,
					username: message.username || 'Anonymous',
					socketId: socket.id,
					appearance: message.appearance || {}
				};

				console.log(`Player appearance data:`,
					JSON.stringify(message.appearance ?
						{ type: message.appearance.type } :
						'None')
				);

				// Remove any existing entries for this user
				matchmakingQueue = matchmakingQueue.filter(p => p.userId !== message.userId);

				// Add to queue
				matchmakingQueue.push(playerInfo);
				console.log(`${playerInfo.username} (${playerInfo.userId}) joined the matchmaking queue`);

				// Broadcast queue update
				broadcastQueueUpdate();

				// Try to match players
				processMatchmaking();
				break;

			case 'LEAVE_QUEUE':
				// Remove player from queue
				matchmakingQueue = matchmakingQueue.filter(p => p.userId !== message.userId);
				console.log(`User ${message.userId} left the matchmaking queue`);

				// Broadcast queue update
				broadcastQueueUpdate();
				break;

			case 'GET_QUEUE':
				// Send the current queue to the requesting client
				socket.emit('QUEUE_UPDATE', { queue: matchmakingQueue });
				break;

			case 'CREATE_BATTLE':
				// Create a new battle with a unique code
				const battleId = message.battleId;
				const battleCode =  message.battleId;

				console.log(`Creating battle for user ${message.userId} (${message.username}) === ${battleId} ${battleCode}`);

				battles[battleId] = {
					battleId,
					code: battleCode,
					player1: {
						userId: message.userId,
						username: message.username || 'Anonymous',
						socketId: socket.id,
						appearance: message.appearance || {},
						wins: 0
					},
					started: false
				};

				console.log(`Battle created with code: ${battleCode}`);

				// Send the battle code to the creator
				socket.emit('BATTLE_CODE_GENERATED', { code: battleCode });
				break;

			case 'JOIN_BATTLE':
				// Find the battle with the given code
				console.log('Joining battle ==> ', message.battleId);
				const battleToJoin = Object.values(battles).find(b =>
					b.battleId === message.battleId && !b.started
				);

				if (!battleToJoin) {
					socket.emit('ERROR', { error: 'Invalid battle code or battle already started' });
					return;
				}

				console.log(`Player ${message.userId} (${message.username}) joining battle ${battleToJoin.battleId}`);

				// Add player 2 to the battle
				battleToJoin.player2 = {
					userId: message.userId,
					username: message.username || 'Anonymous',
					socketId: socket.id,
					appearance: message.appearance || {},
					wins: 0
				};

				battleToJoin.started = true;

				console.log(`Player ${message.username} joined battle ${battleToJoin.battleId}`);

				// Notify both players with opponent appearance data
				io.to(battleToJoin.player1.socketId).emit('MATCH_FOUND', {
					battleId: battleToJoin.battleId,
					opponentName: battleToJoin.player2.username,
					opponentAppearance: battleToJoin.player2.appearance,
				});

				socket.emit('MATCH_FOUND', {
					battleId: battleToJoin.battleId,
					opponentName: battleToJoin.player1.username,
					opponentAppearance: battleToJoin.player1.appearance,
				});
				break;

			case 'SEND_BATTLE_MESSAGE':
				// Find the battle
				const currentBattleId = message.battleId;
				const battle = battles[currentBattleId];

				if (!battle) {
					socket.emit('ERROR', { error: 'Battle not found' });
					return;
				}

				// Check for game end and update win counts
				if (message.message?.gameOver && message.message?.syncData?.winner) {
					const winner = message.message.syncData.winner;

					// Update win counts based on the winner
					if (winner === 1 && message.userId === battle.player1.userId) {
						battle.player1.wins += 1;
						console.log(`Battle ${currentBattleId} - Player 1 (${battle.player1.username}) won a round. Total wins: ${battle.player1.wins}`);
					} else if (winner === 2 && message.userId === battle.player2?.userId) {
						if (battle.player2) {
							battle.player2.wins += 1;
							console.log(`Battle ${currentBattleId} - Player 2 (${battle.player2.username}) won a round. Total wins: ${battle.player2.wins}`);
						}
					}

					// Send updated win counts to both players
					const winState = {
						player1Wins: battle.player1.wins,
						player2Wins: battle.player2 ? battle.player2.wins : 0
					};

					io.to(battle.player1.socketId).emit('BATTLE_WIN_STATE', winState);
					if (battle.player2) {
						io.to(battle.player2.socketId).emit('BATTLE_WIN_STATE', winState);
					}
				}

				// Determine the recipient
				let recipientSocketId: string | undefined;

				if (battle.player1.userId === message.userId) {
					recipientSocketId = battle.player2?.socketId;
				} else if (battle.player2?.userId === message.userId) {
					recipientSocketId = battle.player1.socketId;
				}

				if (recipientSocketId) {
					// Forward the message to the opponent
					// Include sender information to help with identification
					io.to(recipientSocketId).emit('BATTLE_MESSAGE', {
						message: message.message,
						senderId: message.userId
					});

					// Log sync data if present (but not too frequently)
					if (message.message.syncData && !message.message.syncTime) {
						console.log(`Battle ${currentBattleId} - Sync data sent from ${message.userId}`);
					}

					// Log play again requests
					if (message.message.playAgainRequest) {
						console.log(`Battle ${currentBattleId} - Play again request from ${message.userId}`);
					}

					// Log countdown start
					if (message.message.startCountdown) {
						console.log(`Battle ${currentBattleId} - Countdown started by ${message.userId}`);
					}
				}
				break;

			case 'LEAVE_BATTLE':
				// Find the battle
				const battleToLeave = battles[message.battleId];

				if (battleToLeave) {
					// Determine if the leaving player is player1 or player2
					let opponentSocketId: string | undefined;

					if (battleToLeave.player1.userId === message.userId) {
						opponentSocketId = battleToLeave.player2?.socketId;
					} else if (battleToLeave.player2?.userId === message.userId) {
						opponentSocketId = battleToLeave.player1.socketId;
					}

					// Notify the opponent
					if (opponentSocketId) {
						io.to(opponentSocketId).emit('OPPONENT_DISCONNECTED');
					}

					// Remove the battle
					delete battles[message.battleId];
					console.log(`Battle ${message.battleId} ended due to player leaving`);
				}
				break;

			case 'PING':
				// Respond with a pong
				socket.emit('PONG');
				break;
		}
	});

	// Handle disconnections
	socket.on('disconnect', () => {
		console.log(`Client disconnected: ${socket.id}`);

		// Remove from matchmaking queue
		const queuedPlayer = matchmakingQueue.find(p => p.socketId === socket.id);
		if (queuedPlayer) {
			matchmakingQueue = matchmakingQueue.filter(p => p.socketId !== socket.id);
			broadcastQueueUpdate();
		}

		// Handle active battles
		Object.entries(battles).forEach(([id, battle]) => {
			if (battle.player1.socketId === socket.id) {
				// Player 1 disconnected
				if (battle.player2?.socketId) {
					io.to(battle.player2.socketId).emit('OPPONENT_DISCONNECTED');
				}
				delete battles[id];
			} else if (battle.player2?.socketId === socket.id) {
				// Player 2 disconnected
				io.to(battle.player1.socketId).emit('OPPONENT_DISCONNECTED');
				delete battles[id];
			}
		});
	});
});

// Start the server
server.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});

// Process matchmaking periodically to handle edge cases
setInterval(processMatchmaking, 5000);

// Log active connections and battles periodically
setInterval(() => {
	console.log(`Active connections: ${io.engine.clientsCount}`);
	console.log(`Players in queue: ${matchmakingQueue.length}`);
	console.log(`Active battles: ${Object.keys(battles).length}`);
}, 30000);
