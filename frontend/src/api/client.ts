const BASE = '/api'

export class ApiError extends Error {
  constructor(message: string, public status: number, public detail?: any) { super(message); this.name = 'ApiError' }
}

async function request(u: string, method = 'GET', body?: any) {
  let payload = body
  const path = u.replace(/^\/api/, '')
  if (method === 'POST' && /\/projects\/[^/]+\/cards$/.test(path) && body) payload = { ...body, _revision: body._revision ?? '' }
  if (method === 'PUT' && body && !(body instanceof FormData)) {
    if (/\/projects\/[^/]+\/cards\/[^/]+$/.test(path) || /\/drafts\/[^/]+\/meta$/.test(path)) payload = { ...body, _revision: body._revision ?? '' }
    if (/\/projects\/[^/]+\/drafts\/[^/]+$/.test(path)) payload = { ...body, base_revision: body.base_revision ?? body.revision ?? '' }
  }
  let response: Response
  try { response = await fetch(BASE + path, { method, ...(payload === undefined ? {} : payload instanceof FormData ? { body: payload } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) }) }
  catch { throw new ApiError('无法连接本地服务。当前编辑已保留，请检查服务后重试。', 0) }
  const text = await response.text()
  let result: any = {}
  try { result = text ? JSON.parse(text) : {} } catch { throw new ApiError('服务返回了无法读取的内容，当前编辑已保留。请稍后重试。', response.status) }
  if (!response.ok) {
    const detail = result?.detail
    const message = typeof detail === 'string' ? detail : typeof detail?.message === 'string' ? detail.message : response.status === 409 ? '保存版或来源资料已有更新。你的编辑已保留，请先核对最新版本。' : response.status === 422 ? '部分内容不符合要求，请检查填写的内容后重试。' : `操作未完成（${response.status}），当前编辑已保留。`
    throw new ApiError(message, response.status, detail)
  }
  return result
}

export const api = {
  get: (u: string) => request(u),
  post: (u: string, b: any) => request(u, 'POST', b),
  put: (u: string, b: any) => request(u, 'PUT', b),
  delete: (u: string) => request(u, 'DELETE'),
  upload: (u: string, b: FormData) => request(u, 'POST', b),
}
