import { base64UrlEncode, hmacSha256, todayISO, yesterdayISO } from './utils.js'

export const COOKIE_NAME = 'pw_gate'
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 2 // 2 days

export async function signTokenForDate(baseSecret: string, dateStr: string, token: string): Promise<string> {
  const key = `${baseSecret}:${dateStr}`
  return await hmacSha256(key, token)
}

export async function generateTokenAndCookie(baseSecret: string): Promise<{ token: string, cookieVal: string }> {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(16))
  const token = base64UrlEncode(tokenBytes)
  const date = todayISO()
  const sig = await signTokenForDate(baseSecret, date, token)
  const cookieVal = `${token}.${sig}`
  return { token, cookieVal }
}

export async function validateCookie(cookieVal: string | undefined, baseSecret: string): Promise<{ status: string, token?: string, newCookie?: string }> {
  if (!cookieVal) return { status: 'invalid' }
  const [token, sig] = cookieVal.split('.')
  if (!token || !sig) return { status: 'invalid' }
  const date0 = todayISO()
  const date1 = yesterdayISO()
  const expectedSigToday = await signTokenForDate(baseSecret, date0, token).catch(()=>null)
  const expectedSigYesterday = await signTokenForDate(baseSecret, date1, token).catch(()=>null)
  if (sig === expectedSigToday) return { status: 'today', token }
  if (sig === expectedSigYesterday) {
    const newSig = await signTokenForDate(baseSecret, date0, token)
    const newCookie = `${token}.${newSig}`
    return { status: 'yesterday', token, newCookie }
  }
  return { status: 'invalid' }
}
