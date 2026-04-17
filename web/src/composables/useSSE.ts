import { ref, onUnmounted } from 'vue';

export function useSSE(url: string, onEvent: (event: any) => void) {
  const connected = ref(false);
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    // Append _t to prevent caching
    const sep = url.includes('?') ? '&' : '?';
    source = new EventSource(`${url}${sep}_t=${Date.now()}`);

    source.onopen = () => { connected.value = true; };

    source.addEventListener('event', (e) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch { /* ignore */ }
    });

    source.addEventListener('end', () => {
      source?.close();
      connected.value = false;
    });

    source.onerror = () => {
      connected.value = false;
      source?.close();
      // Reconnect after 3s
      reconnectTimer = setTimeout(connect, 3000);
    };
  }

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    source?.close();
    source = null;
    connected.value = false;
  }

  onUnmounted(disconnect);

  return { connected, connect, disconnect };
}
