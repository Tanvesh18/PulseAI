import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || '.env', quiet: true })
const host = process.env.DB_HOST || '127.0.0.1'
const connection = await mysql.createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' })
try {
  const [[identity]] = await connection.query('SELECT DATABASE() AS active_database')
  const [databases] = await connection.query('SHOW DATABASES LIKE ?', ['pulseai_demo'])
  console.log(JSON.stringify({ host, activeDatabase: identity.active_database, demoExists: databases.length > 0 }))
} finally { await connection.end() }
