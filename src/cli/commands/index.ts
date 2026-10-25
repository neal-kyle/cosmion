import type { CommandDefinition } from '../define.js'
import { auth } from './auth.js'
import { gen } from './gen.js'
import { models } from './models.js'
import { price } from './price.js'

/** Every command, in the order `--help` lists them. */
export const commands: readonly CommandDefinition[] = [gen, models, price, auth]
