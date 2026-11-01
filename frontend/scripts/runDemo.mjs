import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
const vite = resolve(root, 'node_modules/vite/bin/vite.js')
const normalEnvPath = resolve(root, '.env')
const normalEnv = existsSync(normalEnvPath) ? readFileSync(normalEnvPath, 'utf8') : ''
const googleClientId = normalEnv.match(/^VITE_GOOGLE_CLIENT_ID\s*=\s*(.*?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '') || ''
const child = spawn(process.execPath, [vite, '--port', '5174', '--mode', 'demo', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PULSEAI_API_TARGET: 'http://127.0.0.1:4100',
    VITE_API_URL: '',
    VITE_GOOGLE_CLIENT_ID: googleClientId || process.env.VITE_GOOGLE_CLIENT_ID || '',
  },
})
child.on('exit', (code) => { process.exitCode = code ?? 1 })
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
