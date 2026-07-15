import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import cookieParser from 'cookie-parser'
import express, { type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { load } from 'cheerio'
import { WebSocketServer, WebSocket } from 'ws'
import { parseCookie } from 'cookie'
import { closeDatabase, db } from './db.js'

const scrypt = promisify(scryptCallback)
const app = express()
const server = createServer(app)
const port = Number(process.env.PORT ?? 3001)
const production = process.env.NODE_ENV === 'production'
const secureSessionCookies = process.env.SESSION_COOKIE_SECURE === undefined
  ? production
  : process.env.SESSION_COOKIE_SECURE.toLowerCase() === 'true'
const sessionCookie = 'webos_session'
const sessionLifetime = 7 * 24 * 60 * 60 * 1000
const proxyTicketLifetime = 15 * 60 * 1000
const proxyTicketSecret = randomBytes(32)
const maxFileBytes = 16_000_000_000
const maxProxyBytes = 50_000_000
const inviteCode = process.env.INVITE_CODE?.trim()

interface User {
  id: number
  username: string
  display_name: string
}

declare global {
  namespace Express {
    interface Request {
      user?: User
    }
  }
}

app.disable('x-powered-by')
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}))
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const matchesInviteCode = (candidate: string) => {
  if (!inviteCode) return false
  const supplied = createHash('sha256').update(candidate).digest()
  const expected = createHash('sha256').update(inviteCode).digest()
  return timingSafeEqual(supplied, expected)
}
const publicUser = (user: User) => ({
  id: user.id,
  username: user.username,
  displayName: user.display_name,
})

async function hashPassword(password: string, salt: string) {
  return (await scrypt(password, salt, 64) as Buffer).toString('hex')
}

function getUserByToken(token?: string): User | undefined {
  if (!token) return undefined
  return db.prepare(`
    SELECT users.id, users.username, users.display_name
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), Date.now()) as User | undefined
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = typeof req.cookies?.[sessionCookie] === 'string'
    ? req.cookies[sessionCookie] as string
    : undefined
  const user = getUserByToken(token)
  if (!user) {
    res.status(401).json({ error: '请先登录' })
    return
  }
  req.user = user
  next()
}

function createSession(res: Response, userId: number) {
  const token = randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, Date.now() + sessionLifetime)
  res.cookie(sessionCookie, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: secureSessionCookies,
    maxAge: sessionLifetime,
    path: '/',
    priority: 'high',
  })
}

function createProxyTicket(userId: number) {
  const expiresAt = Date.now() + proxyTicketLifetime
  const payload = `${userId}.${expiresAt}`
  const signature = createHmac('sha256', proxyTicketSecret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function isValidProxyTicket(value: unknown) {
  if (typeof value !== 'string') return false
  const [userId, expiresAtValue, signature, ...rest] = value.split('.')
  if (rest.length || !/^[1-9]\d*$/.test(userId) || !/^\d+$/.test(expiresAtValue)) return false
  const expiresAt = Number(expiresAtValue)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false
  const expected = createHmac('sha256', proxyTicketSecret)
    .update(`${userId}.${expiresAtValue}`)
    .digest()
  let supplied: Buffer
  try {
    supplied = Buffer.from(signature, 'base64url')
  } catch {
    return false
  }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function clearSessionCookie(res: Response) {
  res.clearCookie(sessionCookie, {
    httpOnly: true,
    sameSite: 'strict',
    secure: secureSessionCookies,
    path: '/',
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(body: unknown, field: string): string | undefined {
  if (!isRecord(body)) return undefined
  const value = body[field]
  return typeof value === 'string' ? value : undefined
}

function parseFileId(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  if (!/^[1-9]\d*$/.test(value)) return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : undefined
}

function validateFileName(rawName: string) {
  const name = rawName.trim()
  const hasControlCharacter = [...name].some((character) => {
    const code = character.codePointAt(0)!
    return code <= 31 || code === 127
  })
  if (
    !name
    || [...name].length > 120
    || /[\\/:*?"<>|]/.test(name)
    || hasControlCharacter
    || name === '.'
    || name === '..'
    || /[. ]$/.test(name)
  ) return undefined
  return name
}

function validateFileInput(body: unknown):
  | { ok: true; name: string; content: string }
  | { ok: false; error: string; status: 400 | 413 } {
  const rawName = stringField(body, 'name')
  const content = stringField(body, 'content')
  if (rawName === undefined || content === undefined) {
    return { ok: false, error: '文件名和内容必须是字符串', status: 400 }
  }
  const name = validateFileName(rawName)
  if (!name) {
    return { ok: false, error: '文件名无效', status: 400 }
  }
  if (Buffer.byteLength(content, 'utf8') > maxFileBytes) {
    return { ok: false, error: '文件不能超过 16 GB', status: 413 }
  }
  return { ok: true, name, content }
}

function isUniqueConstraint(error: unknown) {
  return error instanceof Error
    && ('code' in error ? String(error.code).startsWith('SQLITE_CONSTRAINT') : error.message.includes('UNIQUE constraint failed'))
}

function getFile(userId: number, id: number) {
  return db.prepare(`
    SELECT id, name, content, mime_type AS mimeType, encoding,
      size_bytes AS sizeBytes, updated_at AS updatedAt
    FROM files WHERE id = ? AND user_id = ?
  `).get(id, userId)
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'Nebula WebOS' })
})

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  try {
    if (!inviteCode) {
      res.status(503).json({ error: '注册功能尚未配置邀请码' })
      return
    }
    const username = (stringField(req.body, 'username') ?? '').trim().toLowerCase()
    const displayName = (stringField(req.body, 'displayName') ?? '').trim()
    const password = stringField(req.body, 'password') ?? ''
    const invitation = stringField(req.body, 'inviteCode') ?? ''
    if (invitation.length > 256 || !matchesInviteCode(invitation)) {
      res.status(403).json({ error: '邀请码无效' })
      return
    }
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      res.status(400).json({ error: '用户名需为 3-24 位字母、数字或下划线' })
      return
    }
    if (displayName.length < 1 || displayName.length > 40) {
      res.status(400).json({ error: '昵称需为 1-40 个字符' })
      return
    }
    if (password.length < 8 || password.length > 128) {
      res.status(400).json({ error: '密码需为 8-128 个字符' })
      return
    }

    const salt = randomBytes(16).toString('hex')
    const passwordHash = await hashPassword(password, salt)
    const transaction = db.transaction(() => {
      const result = db.prepare(
        'INSERT INTO users (username, display_name, password_hash, salt) VALUES (?, ?, ?, ?)',
      ).run(username, displayName, passwordHash, salt)
      const userId = Number(result.lastInsertRowid)
      db.prepare('INSERT INTO preferences (user_id) VALUES (?)').run(userId)
      db.prepare(
        "INSERT INTO files (user_id, name, content) VALUES (?, '欢迎.txt', ?)",
      ).run(userId, `欢迎使用 Nebula WebOS，${displayName}！\n\n你可以在记事本中编辑文档，文件会自动保存到云端。`)
      return userId
    })
    const userId = transaction()
    createSession(res, userId)
    res.status(201).json({ user: { id: userId, username, displayName } })
  } catch (error) {
    if (isUniqueConstraint(error)) {
      res.status(409).json({ error: '用户名已存在' })
      return
    }
    next(error)
  }
})

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const username = (stringField(req.body, 'username') ?? '').trim().toLowerCase()
    const password = stringField(req.body, 'password') ?? ''
    if (!/^[a-z0-9_]{3,24}$/.test(username) || password.length < 1 || password.length > 128) {
      res.status(401).json({ error: '用户名或密码错误' })
      return
    }
    const row = db.prepare(
      'SELECT id, username, display_name, password_hash, salt FROM users WHERE username = ?',
    ).get(username) as (User & { password_hash: string; salt: string }) | undefined
    if (!row) {
      res.status(401).json({ error: '用户名或密码错误' })
      return
    }
    const candidate = Buffer.from(await hashPassword(password, row.salt), 'hex')
    const expected = Buffer.from(row.password_hash, 'hex')
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      res.status(401).json({ error: '用户名或密码错误' })
      return
    }
    createSession(res, row.id)
    res.json({ user: publicUser(row) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) })
})

app.post('/api/browser/ticket', requireAuth, (req, res) => {
  res.json({
    ticket: createProxyTicket(req.user!.id),
    expiresIn: proxyTicketLifetime,
  })
})

app.post('/api/auth/logout', (req, res) => {
  const token = typeof req.cookies?.[sessionCookie] === 'string'
    ? req.cookies[sessionCookie] as string
    : undefined
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
  clearSessionCookie(res)
  res.status(204).end()
})

app.get('/api/files', requireAuth, (req, res) => {
  const files = db.prepare(
    `SELECT id, name, mime_type AS mimeType,
      size_bytes AS sizeBytes, updated_at AS updatedAt
    FROM files WHERE user_id = ? ORDER BY name`,
  ).all(req.user!.id)
  res.json({ files })
})

app.post('/api/files/upload', requireAuth, (req, res) => {
  const rawName = stringField(req.body, 'name')
  const data = stringField(req.body, 'data')
  const mimeType = stringField(req.body, 'mimeType')?.slice(0, 255) || 'application/octet-stream'
  const name = rawName === undefined ? undefined : validateFileName(rawName)
  if (!name || data === undefined || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    res.status(400).json({ error: '上传文件数据无效' })
    return
  }
  const sizeBytes = Buffer.byteLength(data, 'base64')
  if (sizeBytes > maxFileBytes) {
    res.status(413).json({ error: '文件不能超过 16 GB' })
    return
  }
  try {
    const result = db.prepare(
      `INSERT INTO files (user_id, name, content, mime_type, encoding, size_bytes)
      VALUES (?, ?, ?, ?, 'base64', ?)`,
    ).run(req.user!.id, name, data, mimeType, sizeBytes)
    const file = getFile(req.user!.id, Number(result.lastInsertRowid))
    broadcast(req.user!.id, { type: 'file:changed', message: `已上传 ${name}` })
    res.status(201).json({ file })
  } catch (error) {
    if (isUniqueConstraint(error)) {
      res.status(409).json({ error: '同名文件已存在' })
      return
    }
    throw error
  }
})

app.get('/api/files/:id', requireAuth, (req, res) => {
  const id = parseFileId(req.params.id)
  if (!id) {
    res.status(400).json({ error: '文件 ID 无效' })
    return
  }
  const file = getFile(req.user!.id, id)
  if (!file) {
    res.status(404).json({ error: '文件不存在' })
    return
  }
  res.json({ file })
})

app.get('/api/files/:id/download', requireAuth, (req, res) => {
  const id = parseFileId(req.params.id)
  if (!id) {
    res.status(400).json({ error: '文件 ID 无效' })
    return
  }
  const file = db.prepare(`
    SELECT name, content, mime_type AS mimeType, encoding
    FROM files WHERE id = ? AND user_id = ?
  `).get(id, req.user!.id) as { name: string; content: string; mimeType: string; encoding: string } | undefined
  if (!file) {
    res.status(404).json({ error: '文件不存在' })
    return
  }
  const body = Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8')
  res.attachment(file.name)
  res.type(file.mimeType || 'application/octet-stream')
  res.set('content-length', String(body.length))
  res.send(body)
})

app.post('/api/files', requireAuth, (req, res) => {
  const input = validateFileInput(req.body)
  if (!input.ok) {
    res.status(input.status).json({ error: input.error })
    return
  }
  const { name, content } = input
  const sizeBytes = Buffer.byteLength(content, 'utf8')
  try {
    const duplicate = db.prepare(
      'SELECT 1 FROM files WHERE user_id = ? AND name = ? COLLATE NOCASE',
    ).get(req.user!.id, name)
    if (duplicate) {
      res.status(409).json({ error: '同名文件已存在' })
      return
    }
    const result = db.prepare(
      'INSERT INTO files (user_id, name, content, size_bytes) VALUES (?, ?, ?, ?)',
    ).run(req.user!.id, name, content, sizeBytes)
    const file = getFile(req.user!.id, Number(result.lastInsertRowid))
    broadcast(req.user!.id, { type: 'file:changed', message: `已创建 ${name}` })
    res.status(201).json({ file })
  } catch (error) {
    if (isUniqueConstraint(error)) {
      res.status(409).json({ error: '同名文件已存在' })
      return
    }
    throw error
  }
})

app.put('/api/files/:id', requireAuth, (req, res) => {
  const id = parseFileId(req.params.id)
  if (!id) {
    res.status(400).json({ error: '文件 ID 无效' })
    return
  }
  const input = validateFileInput(req.body)
  if (!input.ok) {
    res.status(input.status).json({ error: input.error })
    return
  }
  const { name, content } = input
  const sizeBytes = Buffer.byteLength(content, 'utf8')
  try {
    const duplicate = db.prepare(
      'SELECT 1 FROM files WHERE user_id = ? AND name = ? COLLATE NOCASE AND id <> ?',
    ).get(req.user!.id, name, id)
    if (duplicate) {
      res.status(409).json({ error: '同名文件已存在' })
      return
    }
    const result = db.prepare(
      "UPDATE files SET name = ?, content = ?, encoding = 'utf8', size_bytes = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ? AND user_id = ?",
    ).run(name, content, sizeBytes, id, req.user!.id)
    if (!result.changes) {
      res.status(404).json({ error: '文件不存在' })
      return
    }
    const file = getFile(req.user!.id, id)
    broadcast(req.user!.id, { type: 'file:changed', message: `已保存 ${name}` })
    res.json({ file })
  } catch (error) {
    if (isUniqueConstraint(error)) {
      res.status(409).json({ error: '同名文件已存在' })
      return
    }
    throw error
  }
})

app.delete('/api/files/:id', requireAuth, (req, res) => {
  const id = parseFileId(req.params.id)
  if (!id) {
    res.status(400).json({ error: '文件 ID 无效' })
    return
  }
  const file = db.prepare('SELECT name FROM files WHERE id = ? AND user_id = ?')
    .get(id, req.user!.id) as { name: string } | undefined
  if (!file) {
    res.status(404).json({ error: '文件不存在' })
    return
  }
  db.prepare('DELETE FROM files WHERE id = ? AND user_id = ?').run(id, req.user!.id)
  broadcast(req.user!.id, { type: 'file:changed', message: `已删除 ${file.name}` })
  res.status(204).end()
})

app.get('/api/preferences', requireAuth, (req, res) => {
  db.prepare('INSERT INTO preferences (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING')
    .run(req.user!.id)
  const preferences = db.prepare(
    'SELECT wallpaper, accent FROM preferences WHERE user_id = ?',
  ).get(req.user!.id)
  res.json({ preferences })
})

app.put('/api/preferences', requireAuth, (req, res) => {
  const wallpaper = stringField(req.body, 'wallpaper') ?? ''
  const accent = stringField(req.body, 'accent') ?? ''
  if (!['aurora', 'sunset', 'midnight'].includes(wallpaper) || !/^#[0-9a-f]{6}$/i.test(accent)) {
    res.status(400).json({ error: '主题设置无效' })
    return
  }
  db.prepare(`
    INSERT INTO preferences (user_id, wallpaper, accent) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET wallpaper = excluded.wallpaper, accent = excluded.accent
  `).run(req.user!.id, wallpaper, accent)
  broadcast(req.user!.id, { type: 'settings:changed', message: '外观设置已同步' })
  res.json({ preferences: { wallpaper, accent } })
})

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '')
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51)
      || (a === 203 && b === 0)
  }
  return isIP(normalized) !== 6 || normalized === '::1' || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd') || normalized.startsWith('fe8')
    || normalized.startsWith('fe9') || normalized.startsWith('fea')
    || normalized.startsWith('feb') || normalized.startsWith('::ffff:')
    || normalized.startsWith('ff') || normalized.startsWith('2001:db8:')
}

async function validatePublicUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ProxyError('URL 格式无效', 400)
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ProxyError('仅支持公开的 HTTP/HTTPS 地址', 400)
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new ProxyError('不允许访问本地网络', 400)
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new ProxyError('不允许访问私有网络', 400)
  }
  return { url, address: addresses[0] }
}

interface ProxyResponse {
  body: Buffer
  finalUrl: URL
  headers: IncomingHttpHeaders
  status: number
}

class ProxyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function requestPublicUrl(url: URL, target: LookupAddress): Promise<Omit<ProxyResponse, 'finalUrl'>> {
  return new Promise((resolveRequest, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)({
      protocol: url.protocol,
      hostname: target.address,
      family: target.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      servername: url.hostname.replace(/^\[|\]$/g, ''),
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-encoding': 'identity',
        host: url.host,
        'user-agent': 'Nebula-WebOS/1.0',
      },
    }, (response) => {
      const declaredLength = Number(response.headers['content-length'] ?? 0)
      if (Number.isFinite(declaredLength) && declaredLength > maxProxyBytes) {
        response.destroy()
        reject(new ProxyError('页面内容过大', 413))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > maxProxyBytes) {
          response.destroy(new ProxyError('页面内容过大', 413))
          return
        }
        chunks.push(buffer)
      })
      response.on('end', () => resolveRequest({
        body: Buffer.concat(chunks),
        headers: response.headers,
        status: response.statusCode ?? 502,
      }))
      response.on('error', reject)
    })
    request.setTimeout(12_000, () => request.destroy(new ProxyError('网页请求超时', 504)))
    request.on('error', reject)
    request.end()
  })
}

async function fetchPublicUrl(initialUrl: string): Promise<ProxyResponse> {
  let target = await validatePublicUrl(initialUrl)
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await requestPublicUrl(target.url, target.address)
    if (response.status >= 300 && response.status < 400) {
      const rawLocation = response.headers.location
      const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation
      if (!location || redirects === 5) throw new Error('重定向次数过多')
      target = await validatePublicUrl(new URL(location, target.url).toString())
      continue
    }
    return { ...response, finalUrl: target.url }
  }
  throw new Error('无法加载网页')
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

const proxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
})

app.get('/api/proxy', proxyLimiter, async (req, res) => {
  if (!isValidProxyTicket(req.query.ticket)) {
    res.status(401).type('html').send(
      '<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui;padding:40px;color:#334155}</style><h2>浏览器会话已失效</h2><p>请关闭并重新打开浏览器应用。</p>',
    )
    return
  }
  try {
    if (typeof req.query.url !== 'string' || req.query.url.length > 4_096) {
      throw new ProxyError('URL 格式无效', 400)
    }
    const { body, finalUrl, headers, status } = await fetchPublicUrl(req.query.url)
    const contentType = String(headers['content-type'] ?? '')
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      res.status(415).json({ error: '浏览器当前仅支持 HTML 页面' })
      return
    }
    const html = body.toString('utf8')
    const $ = load(html)
    $('base').remove()
    $('head').prepend('<base>')
    $('head base').first().attr('href', finalUrl.toString())
    $('head').prepend(`
      <script>
        function navigateInNebula(value) {
          try {
            var url = new URL(String(value), document.baseURI);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
            parent.postMessage({ type: 'nebula:navigate', url: url.href }, '*');
            return true;
          } catch (_) {
            return false;
          }
        }
        window.open = function (url) {
          if (url) navigateInNebula(url);
          return null;
        };
        addEventListener('click', function (event) {
          var link = event.target.closest && event.target.closest('a[href]');
          if (!link) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          navigateInNebula(link.href);
        }, true);
        addEventListener('auxclick', function (event) {
          var link = event.target.closest && event.target.closest('a[href]');
          if (!link) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          navigateInNebula(link.href);
        }, true);
        addEventListener('submit', function (event) {
          var form = event.target;
          if (!form || String(form.method || 'get').toLowerCase() !== 'get') return;
          event.preventDefault();
          event.stopImmediatePropagation();
          var url = new URL(form.action || document.baseURI);
          new FormData(form).forEach(function (value, key) { url.searchParams.append(key, String(value)); });
          navigateInNebula(url.href);
        }, true);
      </script>
    `)
    res.status(status)
    res.set({
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src * data: blob: 'unsafe-inline' 'unsafe-eval';",
    })
    res.send($.html())
  } catch (error) {
    const message = error instanceof Error ? error.message : '网页加载失败'
    const status = error instanceof ProxyError ? error.status
      : error instanceof TypeError ? 400 : 502
    res.status(status).set('cache-control', 'no-store').type('html').send(
      `<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui;padding:40px;color:#334155}</style><h2>无法打开页面</h2><p>${escapeHtml(message)}</p>`,
    )
  }
})

interface AuthenticatedSocket extends WebSocket {
  isAlive: boolean
  sessionToken: string
}

const sockets = new Map<number, Set<AuthenticatedSocket>>()
const wss = new WebSocketServer({ noServer: true, maxPayload: 16_384 })

function broadcast(userId: number, payload: object) {
  const message = JSON.stringify({ ...payload, at: new Date().toISOString() })
  sockets.get(userId)?.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(message)
  })
}

server.on('upgrade', (request, socket, head) => {
  let pathname: string
  try {
    pathname = new URL(request.url ?? '', 'http://localhost').pathname
  } catch {
    socket.destroy()
    return
  }
  if (pathname !== '/ws') {
    socket.destroy()
    return
  }
  const cookies = parseCookie(request.headers.cookie ?? '')
  const token = cookies[sessionCookie]
  const user = getUserByToken(token)
  if (!user || !token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(request, socket, head, (webSocket) => {
    connectWebSocket(webSocket as AuthenticatedSocket, request, user, token)
  })
})

function connectWebSocket(
  socket: AuthenticatedSocket,
  _request: IncomingMessage,
  user: User,
  token: string,
) {
  socket.isAlive = true
  socket.sessionToken = token
  const userSockets = sockets.get(user.id) ?? new Set<AuthenticatedSocket>()
  userSockets.add(socket)
  sockets.set(user.id, userSockets)
  socket.send(JSON.stringify({
    type: 'system:ready',
    message: `欢迎回来，${user.display_name}`,
    at: new Date().toISOString(),
  }))
  socket.on('pong', () => {
    socket.isAlive = true
  })
  const removeSocket = () => {
    userSockets.delete(socket)
    if (!userSockets.size) sockets.delete(user.id)
  }
  socket.on('close', removeSocket)
  socket.on('error', removeSocket)
}

const heartbeat = setInterval(() => {
  wss.clients.forEach((client) => {
    const socket = client as AuthenticatedSocket
    if (!socket.isAlive || !getUserByToken(socket.sessionToken)) {
      socket.terminate()
      return
    }
    socket.isAlive = false
    socket.ping()
  })
}, 30_000)
heartbeat.unref()

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API 不存在' })
})

if (production) {
  const dist = resolve('dist')
  app.use(express.static(dist))
  app.get('*path', (req, res, next) => {
    if (!req.accepts('html')) {
      next()
      return
    }
    res.sendFile(resolve(dist, 'index.html'))
  })
}

app.use((_req, res) => {
  res.status(404).json({ error: '资源不存在' })
})

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error)
  const status = isRecord(error) && typeof error.status === 'number'
    && error.status >= 400 && error.status < 500 ? error.status : 500
  res.status(status).json({ error: status === 400 ? '请求格式无效' : '服务器发生错误' })
})

server.listen(port, () => {
  console.log(`Nebula WebOS server listening on http://localhost:${port}`)
})

let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received, shutting down`)
  clearInterval(heartbeat)
  wss.clients.forEach((socket) => socket.close(1001, 'Server shutting down'))
  server.close(() => {
    wss.close()
    closeDatabase()
    process.exitCode = 0
  })
  server.closeIdleConnections()
  const forceShutdown = setTimeout(() => {
    wss.clients.forEach((socket) => socket.terminate())
    closeDatabase()
    process.exit(1)
  }, 10_000)
  forceShutdown.unref()
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
