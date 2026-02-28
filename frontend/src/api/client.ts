const BASE = 'http://localhost:8000'
export const api = {
  get: (u: string) => fetch(BASE + u).then(r => r.json()),
  post: (u: string, b: any) => fetch(BASE + u, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)}).then(r=>r.json()),
  put: (u: string, b: any) => fetch(BASE + u, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)}).then(r=>r.json()),
}
