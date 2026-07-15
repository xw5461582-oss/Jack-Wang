# Nebula WebOS

基于 React、Express、SQLite 与 WebSocket 的云端 Web 工作台，内置浏览器、云记事本、文件管理器、计算器和个性化设置。

## 环境要求

- Node.js 20 或更高版本
- npm

## 开发运行

```bash
npm install
INVITE_CODE='请替换为高强度邀请码' npm run dev
```

访问 `http://localhost:5173`，注册账户后即可使用。Vite 会将 API 与 WebSocket 请求代理到 `http://localhost:3001`，数据默认保存在 `data/webos.db`。

也可分别启动前后端：

```bash
npm run dev:server
npm run dev:client
```

可用环境变量：

- `PORT`：服务端端口，默认 `3001`
- `DATA_DIR`：SQLite 数据目录，默认 `data`
- `INVITE_CODE`：注册邀请码；未配置时关闭新用户注册
- `NODE_ENV=production`：启用安全 Cookie 和 `dist` 静态托管

## 检查、构建与生产运行

```bash
npm run check
npm run lint
npm run build
```

Windows PowerShell：

```powershell
$env:NODE_ENV = "production"
$env:INVITE_CODE = "请替换为高强度邀请码"
npm start
```

Windows CMD：

```bat
set NODE_ENV=production
set INVITE_CODE=请替换为高强度邀请码
npm start
```

生产服务默认监听 `http://localhost:3001`，同时提供构建后的前端与 API。Linux/systemd 部署时可在服务的 `[Service]` 中添加 `Environment=INVITE_CODE=你的邀请码`。生产环境应通过 HTTPS 反向代理访问，以便浏览器发送 `Secure` 会话 Cookie。停止进程时服务端会关闭 HTTP/WebSocket 连接并安全关闭数据库。

## API 概览

除健康检查、注册和登录外，接口均使用 `webos_session` HttpOnly Cookie 认证。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务健康状态 |
| POST | `/api/auth/register` | 注册并登录 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/auth/me` | 当前用户 |
| POST | `/api/auth/logout` | 注销并清除会话 |
| GET/POST | `/api/files` | 文件列表/创建文件 |
| GET/PUT/DELETE | `/api/files/:id` | 读取/更新/删除文件 |
| GET/PUT | `/api/preferences` | 读取/更新外观偏好 |
| GET | `/api/proxy?url=...` | 受 SSRF 防护的 HTML 网页代理 |
| WebSocket | `/ws` | 登录用户的文件和设置变更通知 |

请求和响应使用 JSON（文件删除与注销成功返回 `204`）。错误响应格式为 `{ "error": "错误说明" }`。单个文件内容上限为 1 MB，代理页面上限为 5 MB。
