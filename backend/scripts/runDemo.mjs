import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import dotenv from 'dotenv'

const root = resolve(import.meta.dirname, '..')
const demoPath = resolve(root, '.env.demo')

console.log('Checking demo data...')
const setup = spawnSync(process.execPath, [resolve(root, 'scripts/enterpriseDemo.mjs')], { cwd: root, stdio: 'inherit' })
if (setup.status !== 0) process.exit(setup.status ?? 1)

const config = dotenv.config({ path: demoPath, quiet: true }).parsed
if (!config || config.DB_NAME !== 'pulseai_demo' || config.SEED_DEMO_DATA !== 'false' || config.PORT !== '4100') {
  console.error('backend/.env.demo must target pulseai_demo on port 4100 with SEED_DEMO_DATA=false.')
  process.exit(1)
}

const env = {
  ...process.env,
  ...config,
  DOTENV_CONFIG_PATH: demoPath,
  GITHUB_CALLBACK_URL: 'http://localhost:4100/api/auth/github/callback',
}
console.log('Demo API: http://localhost:4100')
const child = spawn(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'watch', 'server.ts'], {
  cwd: root,
  stdio: 'inherit',
  env,
})
child.on('exit', (code) => { process.exitCode = code ?? 1 })
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
