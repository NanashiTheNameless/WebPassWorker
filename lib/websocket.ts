export function isWebSocketUpgrade(request: Request): boolean {
  const upgrade = request.headers.get('Upgrade') || ''
  const connection = request.headers.get('Connection') || ''
  return upgrade.toLowerCase() === 'websocket' && connection.toLowerCase().includes('upgrade')
}
