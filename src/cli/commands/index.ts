import type { CommandDefinition } from '../define.js'
import { auth } from './auth.js'
import { gen } from './gen.js'
import { history } from './history.js'
import { models } from './models.js'
import { price } from './price.js'
import { show } from './show.js'

/** Every command, in the order `--help` lists them. */
export const commands: readonly CommandDefinition[] = [gen, history, show, models, price, auth]
