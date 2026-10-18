export function apiDocsAreEnabled(nodeEnv = process.env.NODE_ENV, override = process.env.ENABLE_API_DOCS) {
  return nodeEnv !== 'production' || override === 'true'
}
