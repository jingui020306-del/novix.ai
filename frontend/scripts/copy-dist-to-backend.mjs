import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const frontendDir = resolve(__dirname, '..');
const distDir = resolve(frontendDir, 'dist');
const backendStaticDir = resolve(frontendDir, '..', 'backend', 'static_dist');

if (!existsSync(distDir)) {
  throw new Error('frontend dist directory not found. run npm run build first.');
}

rmSync(backendStaticDir, { recursive: true, force: true });
mkdirSync(backendStaticDir, { recursive: true });
cpSync(distDir, backendStaticDir, { recursive: true });
console.log(`Copied ${distDir} -> ${backendStaticDir}`);
