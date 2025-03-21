import Database from 'better-sqlite3';
import path from 'path';

// Initialize database
const db = new Database(path.join(process.cwd(), 'blobverse.db'));

// Create tables if they don't exist
db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
        userId TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        lastActive INTEGER NOT NULL,
    );

    CREATE TABLE IF NOT EXISTS battles (
        id TEXT PRIMARY KEY,
        player1 TEXT NOT NULL,
        player2 TEXT NOT NULL,
        winner TEXT,
        date INTEGER NOT NULL,
        moves TEXT NOT NULL,
        FOREIGN KEY (player1) REFERENCES profiles(userId),
        FOREIGN KEY (player2) REFERENCES profiles(userId),
        FOREIGN KEY (winner) REFERENCES profiles(userId)
    );
`);

// Prepare statements
const getProfile = db.prepare('SELECT * FROM profiles WHERE userId = ?');
const updateProfile = db.prepare(`
    INSERT INTO profiles (userId, username, wins, losses, lastActive)
    VALUES (@userId, @username, @wins, @losses, @lastActive)
    ON CONFLICT(userId) DO UPDATE SET
        username = @username,
        wins = @wins,
        losses = @losses,
        lastActive = @lastActive
`);

const insertBattle = db.prepare(`
    INSERT INTO battles (id, player1, player2, winner, date, moves)
    VALUES (@id, @player1, @player2, @winner, @date, @moves)
`);

const getRecentBattles = db.prepare(`
    SELECT * FROM battles
    ORDER BY date DESC
    LIMIT 10
`);

export interface BlobProfile {
    userId: string;
    username: string;
    wins: number;
    losses: number;
    lastActive: number;
}

export interface BlobBattleRecord {
    id: string;
    player1: string;
    player2: string;
    winner?: string;
    date: number;
}

export const database = {
    getProfile: (userId: string): BlobProfile | undefined => {
        return getProfile.get(userId) as BlobProfile | undefined;
    },

    saveProfile: (profile: BlobProfile) => {
        updateProfile.run({
            ...profile,
            lastActive: Date.now()
        });
    },

    recordBattle: (battle: BlobBattleRecord) => {
        insertBattle.run({
            ...battle,
        });
        return battle.id;
    },

    getRecentBattles: (): BlobBattleRecord[] => {
        return getRecentBattles.all() as BlobBattleRecord[];
    }
}; 