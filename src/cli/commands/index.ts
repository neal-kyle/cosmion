import type { CommandDefinition } from '../define.js'
import { auth } from './auth.js'
import { batch } from './batch.js'
import { doctor } from './doctor.js'
import { gen } from './gen.js'
import { history } from './history.js'
import { models } from './models.js'
import { price } from './price.js'
import { regen } from './regen.js'
import { schema } from './schema.js'
import { show } from './show.js'
import { usage } from './usage.js'

/** Every command, in the order `--help` lists them. */
export const commands: readonly CommandDefinition[] = [
  gen,
  batch,
  regen,
  history,
  show,
  usage,
  models,
  price,
  auth,
  doctor,
  schema,
]
