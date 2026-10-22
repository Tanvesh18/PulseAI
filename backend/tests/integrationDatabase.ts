export function isolatedIntegrationDatabaseName() {
  const name = process.env.DB_NAME || ''
  const host = (process.env.DB_HOST || '127.0.0.1').toLowerCase()
  if (process.env.PULSEAI_TEST_DB !== 'true') throw new Error('Set PULSEAI_TEST_DB=true before running database integration tests.')
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Database integration tests require a loopback DB_HOST.')
  if (!/^pulseai_(?:qa_[a-z0-9_]+|test(?:_[a-z0-9_]+)?)$/i.test(name)) throw new Error('Database integration tests require a dedicated pulseai_qa_* or pulseai_test database; refusing to connect.')
  return name
}
