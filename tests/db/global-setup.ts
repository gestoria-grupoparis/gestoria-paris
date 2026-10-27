// @ts-expect-error módulo ESM sin tipos
import { startDb } from '../../scripts/test-db.mjs'

export default async function setup() {
  const db = await startDb()
  process.env.TEST_DB_URL = db.url
  return async () => {
    await db.stop()
  }
}
