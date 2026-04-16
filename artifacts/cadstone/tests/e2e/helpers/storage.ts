import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))

export const CESAR_STATE = path.resolve(here, "..", ".auth", "cesar.json")
export const ANWAR_STATE = path.resolve(here, "..", ".auth", "anwar.json")
