export function apiFetch(path: string, options: RequestInit = {}) {
  return fetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'X-Jarvis-Client': 'web', ...options.headers } });
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Richiesta non riuscita.');
  return body;
}
export async function consumeEvents(response: Response, onEvent: (event: any) => void) {
  if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Errore di connessione.'); }
  if (!response.body) throw new Error('Streaming non disponibile.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        if (line.startsWith('data: ')) {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'error') throw new Error(event.error);
          if (event.type === 'done') completed = true;
          onEvent(event);
        }
      }
      if (done) break;
    }
    if (!completed) throw new Error('Risposta interrotta.');
  } finally { reader.releaseLock(); }
}
