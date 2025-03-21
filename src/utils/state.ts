import { WebSocket } from "ws"

export type Socket = WebSocket & {
	isAlive: boolean
}

export interface User {
	socket: Socket
	pseudo: string
}

export interface State {
	ws: Socket
	status: "ROOM" | "NICKNAME" | "CONNECTED" | "MATCHMAKING"
	room?: string
	nickname?: string
}

export function newState(ws: Socket): State {
	return {
		ws,
		status: "ROOM",
	}
}

export const rooms = new Map<string, Set<User>>()
