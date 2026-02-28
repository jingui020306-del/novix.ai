const BASE = '/api'
export const api = {
  get: (u: string) => fetch(BASE + u.replace(/^\/api/, '')).then(r => r.json()),
  post: (u: string, b: any) => fetch(BASE + u.replace(/^\/api/, ''), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)}).then(r=>r.json()),
  put: (u: string, b: any) => fetch(BASE + u.replace(/^\/api/, ''), {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)}).then(r=>r.json()),
}
