export function parseCookies(cookieHeader: string | null): Record<string,string> {
  const cookies: Record<string,string> = {}
  if (!cookieHeader) return cookies
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.split('=')
    if (!k) continue
    cookies[k.trim()] = decodeURIComponent(v.join('=').trim())
  }
  return cookies
}

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c as keyof any])
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let s = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    s += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes.subarray(i, i + chunkSize)))
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  const bin = atob(str)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export async function hmacSha256(keyStr: string, msg: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg))
  return base64UrlEncode(new Uint8Array(sig))
}

export function todayISO(): string {
  const d = new Date()
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function yesterdayISO(): string {
  const d = new Date(Date.now() - 24 * 3600 * 1000)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
