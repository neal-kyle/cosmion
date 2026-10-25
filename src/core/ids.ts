import { randomInt } from 'node:crypto'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const LENGTH = 8

/** An 8-character id from a–z and 0–9, drawn again while `isTaken` says it is in use. */
export function newId(isTaken: (id: string) => boolean): string {
  let id: string
  do {
    id = Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  } while (isTaken(id))
  return id
}
