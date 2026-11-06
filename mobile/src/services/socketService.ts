import { io, Socket } from 'socket.io-client';

class SocketService {
  private socket: Socket | null = null;
  private url: string = '';

  connect(serverUrl: string, onConnect?: () => void, onError?: (err: any) => void) {
    if (this.socket) {
      this.socket.disconnect();
    }

    this.url = serverUrl.replace(/\/$/, '');
    this.socket = io(this.url, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      timeout: 10000
    });

    this.socket.on('connect', () => {
      console.log('[SocketService] Connected to LushCake Server:', this.url);
      if (onConnect) onConnect();
    });

    this.socket.on('connect_error', (error) => {
      console.error('[SocketService] Connect error:', error);
      if (onError) onError(error);
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  emit(event: string, data?: any) {
    if (this.socket && this.socket.connected) {
      this.socket.emit(event, data);
    }
  }
}

export const socketService = new SocketService();

