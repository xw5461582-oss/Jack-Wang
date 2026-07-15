import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import './App.css'
import { api, type CloudFile, type Preferences, type User } from './api'

type AppId = 'browser' | 'notes' | 'files' | 'settings' | 'calculator' | 'code'

interface WindowState {
  id: AppId
  title: string
  x: number
  y: number
  width: number
  height: number
  z: number
  minimized: boolean
  maximized: boolean
}

interface Notice {
  id: number
  message: string
  kind?: 'error' | 'success'
}

const APPS: Array<{ id: AppId; title: string; icon: string; hint: string }> = [
  { id: 'browser', title: '星云浏览器', icon: '◉', hint: '访问互联网' },
  { id: 'notes', title: '云记事本', icon: '▤', hint: '随时记录灵感' },
  { id: 'files', title: '文件管理器', icon: '◆', hint: '管理云端文件' },
  { id: 'code', title: '代码编辑器', icon: '</>', hint: '编写与预览网页' },
  { id: 'calculator', title: '计算器', icon: '⌗', hint: '快速计算' },
  { id: 'settings', title: '设置', icon: '⚙', hint: '个性化工作台' },
]

const DEFAULT_PREFERENCES: Preferences = { wallpaper: 'aurora', accent: '#7c6cf2' }

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取文件'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const separator = result.indexOf(',')
      if (separator >= 0) resolve(result.slice(separator + 1))
      else reject(new Error('文件数据无效'))
    }
    reader.readAsDataURL(file)
  })
}

function isEditableCloudFile(file: CloudFile) {
  return file.mimeType?.startsWith('text/')
    || /\.(?:txt|md|json|csv|xml|ya?ml|log|html?|css|js|jsx|ts|tsx|py|java|c|cpp|h|cs|go|rs|php|vue|svelte|sql|sh)$/i.test(file.name)
}

function cloudFileContent(file: CloudFile) {
  if (file.encoding !== 'base64') return file.content ?? ''
  const binary = atob(file.content ?? '')
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = mode === 'login'
        ? await api.login(username, password)
        : await api.register(username, displayName, password, inviteCode)
      onAuthenticated(result.user)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-orb auth-orb-one" />
      <div className="auth-orb auth-orb-two" />
      <section className="auth-brand">
        <div className="brand-mark">N</div>
        <p className="eyebrow">YOUR SPACE · ANYWHERE</p>
        <h1>让工作，发生在<br />任何一块屏幕。</h1>
        <p className="brand-copy">一个轻盈、专注且随时在线的云端工作台。</p>
        <div className="brand-features">
          <span>✦ 云端同步</span><span>✦ 多任务窗口</span><span>✦ 隐私优先</span>
        </div>
      </section>
      <section className="auth-card">
        <div className="mobile-brand"><span className="brand-mark small">N</span> Nebula</div>
        <p className="eyebrow">WELCOME TO NEBULA</p>
        <h2>{mode === 'login' ? '欢迎回来' : '创建你的空间'}</h2>
        <p className="auth-subtitle">{mode === 'login' ? '登录并继续你的工作' : '几秒钟即可开始云端工作'}</p>
        <form onSubmit={submit}>
          <label>
            用户名
            <span className="input-wrap"><span>◎</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="字母、数字或下划线" required minLength={3} /></span>
          </label>
          {mode === 'register' && (
            <label>
              昵称
              <span className="input-wrap"><span>◇</span><input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="怎么称呼你？" required /></span>
            </label>
          )}
          <label>
            密码
            <span className="input-wrap"><span>⌁</span><input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'register' ? '至少 8 个字符' : '输入密码'} required minLength={8} /></span>
          </label>
          {mode === 'register' && (
            <label>
              邀请码
              <span className="input-wrap"><span>✦</span><input type="password" autoComplete="off" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="输入注册邀请码" required maxLength={256} /></span>
            </label>
          )}
          {error && <div className="form-error" role="alert">! {error}</div>}
          <button className="primary-button" disabled={loading}>{loading ? <><span className="spinner" /> 正在连接</> : mode === 'login' ? '进入工作台  →' : '创建账户  →'}</button>
        </form>
        <p className="auth-switch">
          {mode === 'login' ? '还没有账户？' : '已经拥有账户？'}
          <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setInviteCode(''); setError('') }}>{mode === 'login' ? '立即注册' : '返回登录'}</button>
        </p>
        <p className="auth-foot">登录即表示你同意以安全方式保存工作数据</p>
      </section>
    </main>
  )
}

function BrowserApp() {
  const home = 'https://example.com'
  const [address, setAddress] = useState(home)
  const [history, setHistory] = useState([home])
  const [index, setIndex] = useState(0)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [ticket, setTicket] = useState('')
  const [ticketError, setTicketError] = useState('')
  const frame = useRef<HTMLIFrameElement>(null)
  const currentUrl = history[index]

  useEffect(() => {
    api.browserTicket()
      .then((result) => setTicket(result.ticket))
      .catch((cause) => setTicketError(cause instanceof Error ? cause.message : '浏览器启动失败'))
  }, [])

  const navigate = useCallback((value: string) => {
    let url = value.trim()
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    setHistory((items) => [...items.slice(0, index + 1), url])
    setIndex((current) => current + 1)
    setAddress(url)
    setLoading(true)
  }, [index])

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return
      const data = event.data as { type?: string; url?: string }
      if (data.type === 'nebula:navigate' && typeof data.url === 'string') navigate(data.url)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [navigate])

  return (
    <div className="browser-app">
      <form className="browser-bar" onSubmit={(event) => { event.preventDefault(); navigate(address) }}>
        <button type="button" title="后退" disabled={index === 0} onClick={() => { setIndex(index - 1); setAddress(history[index - 1]); setLoading(true) }}>←</button>
        <button type="button" title="前进" disabled={index === history.length - 1} onClick={() => { setIndex(index + 1); setAddress(history[index + 1]); setLoading(true) }}>→</button>
        <button type="button" title="刷新" onClick={() => { setReload(reload + 1); setLoading(true) }}>↻</button>
        <div className="address-field"><span>⌕</span><input aria-label="网页地址" value={address} onChange={(event) => setAddress(event.target.value)} /></div>
        <button type="submit" className="go-button">前往</button>
      </form>
      {loading && <div className="browser-progress" />}
      {ticketError
        ? <div className="state-panel"><strong>无法启动浏览器</strong><p>{ticketError}</p></div>
        : ticket
          ? <iframe
              key={`${currentUrl}-${reload}`}
              ref={frame}
              title="网页内容"
              src={`/api/proxy?url=${encodeURIComponent(currentUrl)}&ticket=${encodeURIComponent(ticket)}`}
              onLoad={() => setLoading(false)}
              sandbox="allow-forms allow-modals allow-scripts"
            />
          : <div className="state-panel"><span className="spinner dark" /><p>正在启动安全浏览器...</p></div>}
    </div>
  )
}

function NotesApp({ notify }: { notify: (message: string, kind?: Notice['kind']) => void }) {
  const [files, setFiles] = useState<CloudFile[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const loadFile = useCallback(async (id: number) => {
    setLoading(true)
    setError('')
    try {
      const { file } = await api.file(id)
      setSelected(file.id)
      setName(file.name)
      setContent(cloudFileContent(file))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(async (preferred?: number) => {
    setLoading(true)
    try {
      const result = await api.files()
      setFiles(result.files)
      const next = preferred ?? selected ?? result.files[0]?.id
      if (next) await loadFile(next)
      else setLoading(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件列表加载失败')
      setLoading(false)
    }
  }, [loadFile, selected])

  useEffect(() => { void refresh() }, []) // oxlint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const open = (event: Event) => void loadFile((event as CustomEvent<number>).detail)
    window.addEventListener('nebula:open-file', open)
    return () => window.removeEventListener('nebula:open-file', open)
  }, [loadFile])

  async function create() {
    const fileName = newName.trim().endsWith('.txt') ? newName.trim() : `${newName.trim()}.txt`
    if (!newName.trim()) return
    setSaving(true)
    try {
      const { file } = await api.createFile(fileName)
      setFiles((items) => [...items, file].sort((a, b) => a.name.localeCompare(b.name)))
      setCreating(false)
      setNewName('')
      await loadFile(file.id)
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '创建失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function save() {
    if (!selected) return
    setSaving(true)
    try {
      await api.updateFile({ id: selected, name, content })
      setFiles((items) => items.map((file) => file.id === selected ? { ...file, name, updatedAt: new Date().toISOString() } : file))
      notify('文档已保存到云端', 'success')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!selected) return
    setSaving(true)
    try {
      await api.deleteFile(selected)
      const remaining = files.filter((file) => file.id !== selected)
      setFiles(remaining)
      setSelected(null)
      setName('')
      setContent('')
      if (remaining[0]) await loadFile(remaining[0].id)
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '删除失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="notes-app">
      <aside className="file-sidebar">
        <div className="sidebar-heading"><div><strong>我的文档</strong><small>{files.length} 个文件</small></div><button title="新建文档" onClick={() => setCreating(true)}>＋</button></div>
        {creating && <form className="new-file-form" onSubmit={(event) => { event.preventDefault(); void create() }}><input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="文件名" /><button>创建</button></form>}
        <div className="sidebar-files">
          {files.map((file) => <button key={file.id} className={selected === file.id ? 'active' : ''} onClick={() => void loadFile(file.id)}><span className="file-glyph">▤</span><span><strong>{file.name}</strong><small>{file.updatedAt ? new Date(file.updatedAt).toLocaleDateString('zh-CN') : '云端文档'}</small></span></button>)}
          {!loading && !files.length && <div className="empty-mini">还没有文档<br />点击 ＋ 开始记录</div>}
        </div>
      </aside>
      <section className="editor-pane">
        <div className="editor-toolbar">
          <input aria-label="文件名" value={name} onChange={(event) => setName(event.target.value)} disabled={!selected} />
          <span className="cloud-status">{saving ? '同步中…' : '☁ 已连接'}</span>
          <button className="danger-button" onClick={() => void remove()} disabled={!selected || saving}>删除</button>
          <button className="accent-button" onClick={() => void save()} disabled={!selected || saving}>保存</button>
        </div>
        {error ? <div className="state-panel"><strong>加载失败</strong><p>{error}</p><button onClick={() => void refresh()}>重试</button></div>
          : loading ? <div className="state-panel"><span className="spinner dark" /> 正在加载文档</div>
            : selected ? <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="在这里开始记录…" />
              : <div className="state-panel"><strong>保持好奇，随手记录</strong><p>从左侧新建一个云端文档。</p></div>}
        <div className="editor-footer"><span>纯文本</span><span>{content.length} 个字符</span></div>
      </section>
    </div>
  )
}

function FilesApp({ openFile, notify }: { openFile: (id: number) => void; notify: (message: string, kind?: Notice['kind']) => void }) {
  const [files, setFiles] = useState<CloudFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState<number | null>(null)
  const [error, setError] = useState('')
  const uploadInput = useRef<HTMLInputElement>(null)
  const totalBytes = files.reduce((total, file) => total + (file.sizeBytes ?? 0), 0)
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setFiles((await api.files()).files) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function remove(id: number) {
    try {
      await api.deleteFile(id)
      setFiles((items) => items.filter((file) => file.id !== id))
      notify('文件已移入回收站', 'success')
    } catch (cause) { notify(cause instanceof Error ? cause.message : '删除失败', 'error') }
  }

  async function upload(file: File) {
    setUploading(true)
    try {
      if (file.size > 16_000_000_000) throw new Error('文件不能超过 16 GB')
      const data = await readFileAsBase64(file)
      await api.uploadFile(file.name, file.type || 'application/octet-stream', data)
      await load()
      notify(`已上传 ${file.name}`, 'success')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '上传失败', 'error')
    } finally {
      setUploading(false)
      if (uploadInput.current) uploadInput.current.value = ''
    }
  }

  async function download(file: CloudFile) {
    setDownloading(file.id)
    try {
      const blob = await api.downloadFile(file.id)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = file.name
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      notify(`已下载 ${file.name}`, 'success')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '下载失败', 'error')
    } finally { setDownloading(null) }
  }

  return (
    <div className="files-app">
      <aside className="places">
        <strong>位置</strong>
        <button className="active">◇ 我的云盘</button>
        <button>☆ 最近使用</button>
        <button>▱ 文档</button>
        <div className="storage"><span>已有文件总容量</span><strong title={`${totalBytes} 字节`}>{formatBytes(totalBytes)}</strong><small>{files.length} 个项目</small></div>
      </aside>
      <section className="file-main">
        <div className="file-top">
          <div><h3>我的云盘</h3><p>所有文件都安全保存在云端</p></div>
          <div className="file-top-actions">
            <input
              ref={uploadInput}
              type="file"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void upload(file)
              }}
            />
            <button className="upload-button" disabled={uploading} onClick={() => uploadInput.current?.click()}>
              {uploading ? '上传中…' : '↑ 上传文件'}
            </button>
            <button onClick={() => void load()}>↻ 刷新</button>
          </div>
        </div>
        {loading ? <div className="state-panel"><span className="spinner dark" /> 正在读取云盘</div>
          : error ? <div className="state-panel"><strong>无法打开云盘</strong><p>{error}</p><button onClick={() => void load()}>重试</button></div>
            : <div className="file-grid">{files.map((file) => (
              <article key={file.id} onDoubleClick={() => isEditableCloudFile(file) ? openFile(file.id) : void download(file)}>
                <div className="big-file">▤</div><strong>{file.name}</strong>
                <small>{file.sizeBytes !== undefined ? formatBytes(file.sizeBytes) : file.updatedAt ? new Date(file.updatedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric' }) : '云端文件'}</small>
                <div className="file-actions">{isEditableCloudFile(file) && <button onClick={() => openFile(file.id)}>打开</button>}<button disabled={downloading === file.id} onClick={() => void download(file)}>{downloading === file.id ? '下载中' : '下载'}</button><button aria-label={`删除 ${file.name}`} onClick={() => void remove(file.id)}>×</button></div>
              </article>
            ))}{!files.length && <div className="state-panel"><strong>云盘空空如也</strong><p>在记事本中创建第一个文件吧。</p></div>}</div>}
      </section>
    </div>
  )
}

function SettingsApp({ preferences, onSave, notify }: { preferences: Preferences; onSave: (value: Preferences) => void; notify: (message: string, kind?: Notice['kind']) => void }) {
  const [draft, setDraft] = useState(preferences)
  const [saving, setSaving] = useState(false)
  const wallpapers: Array<{ id: Preferences['wallpaper']; label: string }> = [
    { id: 'aurora', label: '极光' }, { id: 'sunset', label: '暮色' }, { id: 'midnight', label: '午夜' },
  ]
  const accents = ['#7c6cf2', '#00a8a8', '#e05d8b', '#e67e22', '#2775ca']
  async function save() {
    setSaving(true)
    try {
      const { preferences: result } = await api.updatePreferences(draft)
      onSave(result)
      notify('外观设置已同步', 'success')
    } catch (cause) { notify(cause instanceof Error ? cause.message : '设置保存失败', 'error') }
    finally { setSaving(false) }
  }
  return (
    <div className="settings-app">
      <header><span className="settings-icon">✦</span><div><h3>个性化</h3><p>打造属于你的工作空间</p></div></header>
      <section><h4>桌面壁纸</h4><div className="wallpaper-list">{wallpapers.map((item) => <button key={item.id} className={`${item.id} ${draft.wallpaper === item.id ? 'selected' : ''}`} onClick={() => setDraft({ ...draft, wallpaper: item.id })}><span /><strong>{item.label}</strong><i>✓</i></button>)}</div></section>
      <section><h4>强调色</h4><div className="accent-list">{accents.map((color) => <button key={color} aria-label={`选择 ${color}`} className={draft.accent === color ? 'selected' : ''} style={{ backgroundColor: color }} onClick={() => setDraft({ ...draft, accent: color })}>{draft.accent === color && '✓'}</button>)}<label className="custom-color">自定义 <input type="color" value={draft.accent} onChange={(event) => setDraft({ ...draft, accent: event.target.value })} /></label></div></section>
      <div className="settings-preview" style={{ '--preview-accent': draft.accent } as React.CSSProperties}><span>实时预览</span><button>强调色按钮</button></div>
      <footer><span>设置会同步到你的所有设备</span><button className="accent-button" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '应用设置'}</button></footer>
    </div>
  )
}

function CalculatorApp() {
  const [display, setDisplay] = useState('0')
  const [stored, setStored] = useState<number | null>(null)
  const [operator, setOperator] = useState<string | null>(null)
  const [fresh, setFresh] = useState(true)
  function input(value: string) {
    if (value === 'C') { setDisplay('0'); setStored(null); setOperator(null); setFresh(true); return }
    if (value === '±') { setDisplay(String(-Number(display))); return }
    if (value === '%') { setDisplay(String(Number(display) / 100)); return }
    if (['+', '−', '×', '÷'].includes(value)) {
      setStored(Number(display)); setOperator(value); setFresh(true); return
    }
    if (value === '=') {
      if (stored === null || !operator) return
      const current = Number(display)
      const result = operator === '+' ? stored + current : operator === '−' ? stored - current : operator === '×' ? stored * current : current === 0 ? NaN : stored / current
      setDisplay(Number.isFinite(result) ? String(Number(result.toFixed(10))) : '错误')
      setStored(null); setOperator(null); setFresh(true); return
    }
    setDisplay(fresh || display === '0' || display === '错误' ? value : `${display}${value}`)
    setFresh(false)
  }
  return <div className="calculator"><div className="calc-meta"><span>标准</span><small>{operator ? `${stored} ${operator}` : 'NEBULA CALC'}</small></div><output>{display}</output><div className="calc-grid">{['C', '±', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '='].map((key) => <button key={key} className={['÷', '×', '−', '+', '='].includes(key) ? 'operator' : ''} onClick={() => input(key)}>{key}</button>)}</div></div>
}

interface ProgramFile {
  id: number | null
  name: string
  content: string
}

const PROGRAM_FILE_PATTERN = /\.(?:html?|css|js|jsx|ts|tsx|json|md|py|java|c|cpp|h|cs|go|rs|php|vue|svelte|sql|sh|ya?ml|xml)$/i

const EMPTY_PROGRAM_FILE: ProgramFile = { id: null, name: '', content: '' }

function programFileKey(file: ProgramFile) {
  return file.id === null ? `local:${file.name}` : `cloud:${file.id}`
}

function fileExtension(name: string) {
  return name.split('.').pop()?.toLowerCase() || 'txt'
}

function CodeEditorApp({ notify }: { notify: (message: string, kind?: Notice['kind']) => void }) {
  const [tabs, setTabs] = useState<ProgramFile[]>([])
  const [activeKey, setActiveKey] = useState('')
  const [cloudFiles, setCloudFiles] = useState<CloudFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState('')
  const [previewTitle, setPreviewTitle] = useState('实时预览')
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const editor = useRef<HTMLTextAreaElement>(null)
  const active = tabs.find((file) => programFileKey(file) === activeKey) ?? tabs[0] ?? EMPTY_PROGRAM_FILE

  const refreshFiles = useCallback(async () => {
    setLoadingFiles(true)
    try {
      const result = await api.files()
      setCloudFiles(result.files.filter((file) => PROGRAM_FILE_PATTERN.test(file.name)))
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '程序文件加载失败', 'error')
    } finally { setLoadingFiles(false) }
  }, [notify])

  useEffect(() => { void refreshFiles() }, [refreshFiles])

  const run = useCallback(() => {
    if (fileExtension(active.name) === 'py') {
      const pythonCode = JSON.stringify(active.content).replace(/<\/script/gi, '<\\/script')
      setPreviewTitle('Python 输出')
      setPreview(`<!doctype html><html><head><meta charset="UTF-8"><style>
        * { box-sizing: border-box; }
        body { min-height: 100vh; margin: 0; padding: 22px; color: #dce5ef; background: #111722; font: 13px/1.7 "Cascadia Code", Consolas, monospace; }
        header { display: flex; align-items: center; gap: 8px; padding-bottom: 14px; color: #8290a3; border-bottom: 1px solid #293342; font-size: 11px; }
        i { width: 8px; height: 8px; border-radius: 50%; background: #f0d266; box-shadow: 0 0 8px #f0d266; }
        pre { margin: 16px 0 0; white-space: pre-wrap; word-break: break-word; }
        .error { color: #ff8896; }
        .done { color: #6ee7c6; }
      </style></head><body><header><i></i><span id="status">正在加载 Python 运行环境...</span></header><pre id="output"></pre>
      <script src="https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js"></script><script>
        const output = document.querySelector('#output');
        const status = document.querySelector('#status');
        const write = (text, className = '') => { const line = document.createElement('div'); line.className = className; line.textContent = text; output.append(line); };
        (async () => {
          try {
            const pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/' });
            pyodide.setStdout({ batched: (text) => write(text) });
            pyodide.setStderr({ batched: (text) => write(text, 'error') });
            status.textContent = 'Python 3 · Pyodide';
            await pyodide.runPythonAsync(${pythonCode});
            write('进程已完成', 'done');
          } catch (error) {
            status.textContent = '运行失败';
            write(error instanceof Error ? error.message : String(error), 'error');
          }
        })();
      </script></body></html>`)
      return
    }
    const source = (extension: string) => [...tabs].reverse().find((file) => fileExtension(file.name) === extension)?.content ?? ''
    const script = source('js').replace(/<\/script/gi, '<\\/script')
    setPreviewTitle('实时预览')
    setPreview(`<!doctype html><html><head><meta charset="UTF-8"><style>${source('css')}</style></head><body>${source('html')}<script>${script}</script></body></html>`)
  }, [active, tabs])

  async function openFile(file: CloudFile) {
    const key = `cloud:${file.id}`
    if (tabs.some((tab) => programFileKey(tab) === key)) { setActiveKey(key); return }
    try {
      const result = await api.file(file.id)
      const opened = { id: result.file.id, name: result.file.name, content: cloudFileContent(result.file) }
      setTabs((items) => [...items, opened])
      setActiveKey(programFileKey(opened))
    } catch (cause) { notify(cause instanceof Error ? cause.message : '文件打开失败', 'error') }
  }

  async function createFile() {
    const name = newName.trim()
    if (!name || !PROGRAM_FILE_PATTERN.test(name)) {
      notify('请输入带程序扩展名的文件名，例如 app.js 或 main.py', 'error')
      return
    }
    setSaving(true)
    try {
      const result = await api.createFile(name)
      const created = { id: result.file.id, name: result.file.name, content: '' }
      setTabs((items) => [...items, created])
      setCloudFiles((items) => [...items, result.file].sort((a, b) => a.name.localeCompare(b.name)))
      setActiveKey(programFileKey(created))
      setNewName('')
      setCreating(false)
      notify(`已创建 ${name}`, 'success')
    } catch (cause) { notify(cause instanceof Error ? cause.message : '文件创建失败', 'error') }
    finally { setSaving(false) }
  }

  async function save() {
    if (!active) return
    setSaving(true)
    try {
      const result = active.id === null
        ? await api.createFile(active.name, active.content)
        : await api.updateFile({ id: active.id, name: active.name, content: active.content })
      const saved = { id: result.file.id, name: result.file.name, content: result.file.content ?? active.content }
      setTabs((items) => items.map((file) => programFileKey(file) === activeKey ? saved : file))
      setActiveKey(programFileKey(saved))
      await refreshFiles()
      notify(`已保存 ${saved.name}`, 'success')
    } catch (cause) { notify(cause instanceof Error ? cause.message : '文件保存失败', 'error') }
    finally { setSaving(false) }
  }

  async function remove() {
    if (!active?.id || !window.confirm(`确定删除 ${active.name}？`)) return
    setSaving(true)
    try {
      await api.deleteFile(active.id)
      const remaining = tabs.filter((file) => programFileKey(file) !== activeKey)
      setTabs(remaining)
      setActiveKey(remaining[0] ? programFileKey(remaining[0]) : '')
      await refreshFiles()
      notify(`已删除 ${active.name}`, 'success')
    } catch (cause) { notify(cause instanceof Error ? cause.message : '文件删除失败', 'error') }
    finally { setSaving(false) }
  }

  function closeFile(file: ProgramFile) {
    const key = programFileKey(file)
    const index = tabs.findIndex((item) => programFileKey(item) === key)
    const remaining = tabs.filter((item) => programFileKey(item) !== key)
    setTabs(remaining)
    if (activeKey === key) {
      const next = remaining[Math.min(index, remaining.length - 1)]
      setActiveKey(next ? programFileKey(next) : '')
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      save()
      return
    }
    if (event.key !== 'Tab') return
    event.preventDefault()
    const target = event.currentTarget
    const start = target.selectionStart
    const end = target.selectionEnd
    const next = `${active.content.slice(0, start)}  ${active.content.slice(end)}`
    setTabs((items) => items.map((file) => programFileKey(file) === activeKey ? { ...file, content: next } : file))
    requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = start + 2 })
  }

  const lineCount = active.content.split('\n').length
  const lineNumbers = Array.from({ length: lineCount }, (_, index) => index + 1).join('\n')

  return (
    <div className={`code-app ${previewExpanded ? 'preview-expanded' : ''}`}>
      <header className="code-toolbar">
        <div className="code-brand"><span>⌘</span><div><strong>Nebula Studio</strong><small>网页项目</small></div></div>
        <div className="code-actions">
          <button title="新建程序文件" onClick={() => setCreating(true)}>＋</button>
          <button title="保存文件 (Ctrl+S)" disabled={!active.name || saving} onClick={() => void save()}>▣</button>
          <button className="delete-code-button" title="删除当前云端文件" disabled={!active.id || saving} onClick={() => void remove()}>×</button>
          <button className="run-button" disabled={!active.name} onClick={run}>▶ <span>运行</span></button>
        </div>
      </header>
      <div className="code-workspace">
        <aside className="code-file-panel">
          <header><strong>云端程序文件</strong><button title="新建程序文件" onClick={() => setCreating(true)}>＋</button></header>
          {creating && <form onSubmit={(event) => { event.preventDefault(); void createFile() }}><input autoFocus aria-label="新程序文件名" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="app.js / main.py" /><button disabled={saving}>创建</button></form>}
          <div className="code-file-list">
            {cloudFiles.map((file) => <button key={file.id} className={active.id === file.id ? 'active' : ''} onClick={() => void openFile(file)}><i>{fileExtension(file.name).slice(0, 2).toUpperCase()}</i><span>{file.name}</span></button>)}
            {!loadingFiles && !cloudFiles.length && <p>暂无程序文件</p>}
          </div>
        </aside>
        <div className="code-main">
          <section className="code-source">
            <nav className="code-tabs" aria-label="已打开文件">
              {tabs.map((file) => { const extension = fileExtension(file.name); const key = programFileKey(file); return <div key={key} className={`code-tab ${activeKey === key ? 'active' : ''}`}><button className="code-tab-select" onClick={() => setActiveKey(key)}><i className={extension}>{extension.slice(0, 2).toUpperCase()}</i><span>{file.name}</span>{file.id === null && <small>●</small>}</button><button className="code-tab-close" title={`关闭 ${file.name}`} aria-label={`关闭 ${file.name}`} onClick={() => closeFile(file)}>×</button></div> })}
            </nav>
            {active.name ? <div className="code-editor-wrap">
              <pre aria-hidden="true">{lineNumbers}</pre>
              <textarea ref={editor} aria-label={`${active.name} 代码`} spellCheck={false} value={active.content} onKeyDown={handleKeyDown} onChange={(event) => setTabs((items) => items.map((file) => programFileKey(file) === activeKey ? { ...file, content: event.target.value } : file))} />
            </div> : <div className="code-empty"><strong>没有打开的文件</strong><p>从左侧打开云端文件，或新建一个程序文件。</p></div>}
            <footer className="code-status">{active.name && <><span>Ln {active.content.slice(0, editor.current?.selectionStart ?? 0).split('\n').length}</span><span>{active.id ? '☁ 云端文件' : '本地示例'}</span><span>UTF-8</span><span>{fileExtension(active.name).toUpperCase()}</span></>}</footer>
          </section>
          <section className="code-preview">
            <header><div><span className="preview-dot" /><strong>{previewTitle}</strong></div><div className="preview-actions"><button title={previewExpanded ? '还原预览' : '展开预览'} onClick={() => setPreviewExpanded(!previewExpanded)}>{previewExpanded ? '❐' : '□'}</button></div></header>
            <iframe key={preview} title="代码运行预览" sandbox="allow-scripts" srcDoc={preview} />
          </section>
        </div>
      </div>
    </div>
  )
}

function Desktop({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES)
  const [windows, setWindows] = useState<WindowState[]>([])
  const [startOpen, setStartOpen] = useState(false)
  const [appQuery, setAppQuery] = useState('')
  const [notices, setNotices] = useState<Notice[]>([])
  const [time, setTime] = useState(new Date())
  const zRef = useRef(1)

  const notify = useCallback((message: string, kind?: Notice['kind']) => {
    const id = Date.now() + Math.random()
    setNotices((items) => [...items.slice(-3), { id, message, kind }])
    window.setTimeout(() => setNotices((items) => items.filter((item) => item.id !== id)), 4200)
  }, [])

  useEffect(() => {
    api.preferences().then(({ preferences: value }) => setPreferences(value)).catch(() => notify('外观设置加载失败', 'error'))
    const timer = window.setInterval(() => setTime(new Date()), 1000)
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${location.host}/ws`)
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as { message?: string }
        if (payload.message) notify(payload.message)
      } catch { /* Ignore malformed server messages. */ }
    }
    socket.onerror = () => notify('实时通知暂时离线', 'error')
    return () => { window.clearInterval(timer); socket.close() }
  }, [notify])

  useEffect(() => {
    const keepWindowsOnScreen = () => {
      setWindows((items) => items.map((item) => item.maximized ? item : {
        ...item,
        x: Math.max(0, Math.min(item.x, window.innerWidth - 180)),
        y: Math.max(0, Math.min(item.y, window.innerHeight - 100)),
        width: Math.min(item.width, window.innerWidth),
        height: Math.min(item.height, window.innerHeight - 52),
      }))
    }
    window.addEventListener('resize', keepWindowsOnScreen)
    return () => window.removeEventListener('resize', keepWindowsOnScreen)
  }, [])

  const focus = useCallback((id: AppId) => {
    const z = ++zRef.current
    setWindows((items) => items.map((item) => item.id === id ? { ...item, z, minimized: false } : item))
  }, [])

  const openApp = useCallback((id: AppId) => {
    setStartOpen(false)
    const z = ++zRef.current
    setWindows((items) => {
      if (items.some((item) => item.id === id)) return items.map((item) => item.id === id ? { ...item, minimized: false, z } : item)
      const app = APPS.find((item) => item.id === id)!
      const offset = items.length * 28
      const compact = window.innerWidth < 700
      return [...items, {
        id, title: app.title, x: compact ? 8 : 110 + offset, y: compact ? 10 : 62 + offset,
        width: compact ? window.innerWidth - 16 : id === 'calculator' ? 380 : id === 'settings' ? 700 : 880,
        height: compact ? window.innerHeight - 78 : id === 'calculator' ? 570 : 590,
        z, minimized: false, maximized: compact,
      }]
    })
  }, [])

  function openFile(id: number) {
    openApp('notes')
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('nebula:open-file', { detail: id })), 50)
  }

  function updateWindow(id: AppId, patch: Partial<WindowState>) {
    setWindows((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  function beginDrag(event: ReactPointerEvent, item: WindowState) {
    if (item.maximized || (event.target as HTMLElement).closest('button')) return
    focus(item.id)
    const originX = event.clientX
    const originY = event.clientY
    const startX = item.x
    const startY = item.y
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    const move = (moveEvent: globalThis.PointerEvent) => {
      updateWindow(item.id, {
        x: Math.max(0, Math.min(window.innerWidth - 180, startX + moveEvent.clientX - originX)),
        y: Math.max(0, Math.min(window.innerHeight - 100, startY + moveEvent.clientY - originY)),
      })
    }
    const end = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
  }

  function content(id: AppId) {
    if (id === 'browser') return <BrowserApp />
    if (id === 'notes') return <NotesApp notify={notify} />
    if (id === 'files') return <FilesApp openFile={openFile} notify={notify} />
    if (id === 'settings') return <SettingsApp preferences={preferences} onSave={setPreferences} notify={notify} />
    if (id === 'code') return <CodeEditorApp notify={notify} />
    return <CalculatorApp />
  }

  const visibleApps = APPS.filter((app) => `${app.title}${app.hint}`.toLocaleLowerCase('zh-CN').includes(appQuery.trim().toLocaleLowerCase('zh-CN')))
  const topWindowZ = windows.reduce((highest, item) => item.minimized ? highest : Math.max(highest, item.z), -1)

  return (
    <main className={`desktop wallpaper-${preferences.wallpaper}`} style={{ '--accent': preferences.accent } as React.CSSProperties} onPointerDown={() => setStartOpen(false)}>
      <div className="desktop-shade" />
      <section className="desktop-icons" aria-label="桌面应用">
        {APPS.slice(0, 4).map((app) => <button key={app.id} onDoubleClick={() => openApp(app.id)} onClick={() => { if (window.matchMedia('(pointer: coarse)').matches) openApp(app.id) }}><span className={`app-icon ${app.id}`}>{app.icon}</span><strong>{app.title.replace('星云', '').replace('云', '')}</strong></button>)}
      </section>
      <div className="workspace">
        {windows.map((item) => !item.minimized && (
          <section
            key={item.id}
            className={`app-window ${item.maximized ? 'maximized' : ''}`}
            style={item.maximized ? { zIndex: item.z } : { zIndex: item.z, left: item.x, top: item.y, width: item.width, height: item.height }}
            onPointerDown={() => focus(item.id)}
          >
            <header className="window-titlebar" onDoubleClick={() => updateWindow(item.id, { maximized: !item.maximized })} onPointerDown={(event) => beginDrag(event, item)}>
              <div><span className={`mini-icon ${item.id}`}>{APPS.find((app) => app.id === item.id)?.icon}</span><strong>{item.title}</strong></div>
              <div className="window-controls">
                <button aria-label="最小化" onClick={() => updateWindow(item.id, { minimized: true })}>−</button>
                <button aria-label={item.maximized ? '还原' : '最大化'} onClick={() => updateWindow(item.id, { maximized: !item.maximized })}>{item.maximized ? '❐' : '□'}</button>
                <button className="close" aria-label="关闭" onClick={() => setWindows((items) => items.filter((windowItem) => windowItem.id !== item.id))}>×</button>
              </div>
            </header>
            <div className="window-content">{content(item.id)}</div>
          </section>
        ))}
      </div>
      {startOpen && (
        <section className="start-menu" onPointerDown={(event) => event.stopPropagation()}>
          <div className="start-search">⌕ <input autoFocus placeholder="搜索应用" aria-label="搜索应用" value={appQuery} onChange={(event) => setAppQuery(event.target.value)} /></div>
          <div className="start-heading"><strong>已固定</strong><small>所有应用</small></div>
          <div className="start-apps">{visibleApps.map((app) => <button key={app.id} onClick={() => openApp(app.id)}><span className={`app-icon ${app.id}`}>{app.icon}</span><strong>{app.title}</strong><small>{app.hint}</small></button>)}{!visibleApps.length && <p className="start-empty">没有找到相关应用</p>}</div>
          <footer><div className="user-avatar">{user.displayName.slice(0, 1).toUpperCase()}</div><div><strong>{user.displayName}</strong><small>@{user.username}</small></div><button title="退出登录" onClick={onLogout}>↪</button></footer>
        </section>
      )}
      <aside className="toasts" aria-live="polite">{notices.map((notice) => <div key={notice.id} className={notice.kind}><span>{notice.kind === 'error' ? '!' : '✦'}</span><div><strong>{notice.kind === 'error' ? '出现问题' : 'Nebula 通知'}</strong><p>{notice.message}</p></div><button onClick={() => setNotices((items) => items.filter((item) => item.id !== notice.id))}>×</button></div>)}</aside>
      <nav className="taskbar" onPointerDown={(event) => event.stopPropagation()}>
        <button className={`start-button ${startOpen ? 'active' : ''}`} aria-label="开始" onClick={() => setStartOpen(!startOpen)}><span>✦</span></button>
        <div className="task-apps">{windows.map((item) => <button key={item.id} className={!item.minimized && item.z === topWindowZ ? 'active' : ''} title={item.title} onClick={() => item.minimized || item.z !== topWindowZ ? focus(item.id) : updateWindow(item.id, { minimized: true })}><span className={`mini-icon ${item.id}`}>{APPS.find((app) => app.id === item.id)?.icon}</span></button>)}</div>
        <div className="task-spacer" />
        <button className="tray" onClick={() => notify('所有数据均已同步')}><span>⌃　◉　⌁</span><time>{time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}<small>{time.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</small></time></button>
      </nav>
    </main>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    api.me().then(({ user: value }) => setUser(value)).catch(() => setUser(null)).finally(() => setLoading(false))
  }, [])
  async function logout() {
    try { await api.logout() } finally { setUser(null) }
  }
  if (loading) return <div className="boot-screen"><div className="brand-mark">N</div><strong>Nebula</strong><span className="boot-loader"><i /></span><small>正在唤醒你的工作空间</small></div>
  return user ? <Desktop user={user} onLogout={() => void logout()} /> : <AuthScreen onAuthenticated={setUser} />
}
