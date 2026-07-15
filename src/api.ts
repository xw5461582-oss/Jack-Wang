export interface User {
  id: number
  username: string
  displayName: string
}

export interface CloudFile {
  id: number
  name: string
  content?: string
  mimeType?: string
  encoding?: string
  sizeBytes?: number
  updatedAt?: string
}

export interface Preferences {
  wallpaper: 'aurora' | 'sunset' | 'midnight'
  accent: string
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...options?.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: '请求失败' })) as { error?: string }
    throw new Error(body.error ?? '请求失败')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function requestBlob(path: string) {
  const response = await fetch(path)
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: '下载失败' })) as { error?: string }
    throw new Error(body.error ?? '下载失败')
  }
  return response.blob()
}

export const api = {
  me: () => request<{ user: User }>('/api/auth/me'),
  login: (username: string, password: string) =>
    request<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  register: (username: string, displayName: string, password: string, inviteCode: string) =>
    request<{ user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, displayName, password, inviteCode }),
    }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  browserTicket: () => request<{ ticket: string; expiresIn: number }>('/api/browser/ticket', {
    method: 'POST',
  }),
  files: () => request<{ files: CloudFile[] }>('/api/files'),
  file: (id: number) => request<{ file: CloudFile }>(`/api/files/${id}`),
  createFile: (name: string, content = '') =>
    request<{ file: CloudFile }>('/api/files', {
      method: 'POST',
      body: JSON.stringify({ name, content }),
    }),
  uploadFile: (name: string, mimeType: string, data: string) =>
    request<{ file: CloudFile }>('/api/files/upload', {
      method: 'POST',
      body: JSON.stringify({ name, mimeType, data }),
    }),
  downloadFile: (id: number) => requestBlob(`/api/files/${id}/download`),
  updateFile: (file: Pick<CloudFile, 'id' | 'name' | 'content'>) =>
    request<{ file: CloudFile }>(`/api/files/${file.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: file.name, content: file.content ?? '' }),
    }),
  deleteFile: (id: number) => request<void>(`/api/files/${id}`, { method: 'DELETE' }),
  preferences: () => request<{ preferences: Preferences }>('/api/preferences'),
  updatePreferences: (preferences: Preferences) =>
    request<{ preferences: Preferences }>('/api/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences),
    }),
}
