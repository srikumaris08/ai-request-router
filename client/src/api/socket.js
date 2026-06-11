/**
 * Socket.io client singleton.
 * Connects to the same origin — Vite proxies /socket.io to the backend.
 */
import { io } from 'socket.io-client';

const socket = io('/', {
  autoConnect: false,       // connect only after login
  transports: ['websocket', 'polling'],
  path: '/socket.io',
});

export default socket;
