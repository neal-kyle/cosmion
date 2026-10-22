import type { CommandDefinition } from '../define.js'
import { auth } from './auth.js'
import { models } from './models.js'
import { price } from './price.js'

/** Every command, in the order `--help` lists them. */
export const commands: readonly CommandDefinition[] = [models, price, auth]
