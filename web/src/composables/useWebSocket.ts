import { ref, onUnmounted } from 'vue';

export function useWebSocket(url: string, onMessage: (data: any) => void) {
  const connected = ref(false);
  const reconnecting = ref(false);
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_DELAY = 30000;

  function connect() {
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      connected.value = true;
      reconnecting.value = false;
      reconnectAttempts = 0;
      // Heartbeat
      pingTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 30000);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') return;
        onMessage(data);
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      connected.value = false;
      if (pingTimer) clearInterval(pingTimer);
      scheduleReconnect();
    };

    ws.onerror = () => {
      connected.value = false;
    };
  }

  function scheduleReconnect() {
    if (reconnecting.value) return;
    reconnecting.value = true;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      reconnecting.value = false;
      connect();
    }, delay);
  }

  function send(data: any) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    reconnecting.value = false;
    ws?.close();
    ws = null;
    connected.value = false;
  }

  onUnmounted(disconnect);

  return { connected, reconnecting, send, connect, disconnect };
}
