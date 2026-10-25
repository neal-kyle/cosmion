import { expect, test } from 'vitest'
import { newId } from '../../src/core/ids.js'

test('an id is 8 characters from a–z and 0–9', () => {
  for (let i = 0; i < 200; i++) expect(newId(() => false)).toMatch(/^[a-z0-9]{8}$/)
})

test('ids differ from one call to the next', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newId(() => false)))
  expect(ids.size).toBe(200)
})

test('a new id is drawn while the one drawn is already taken', () => {
  const asked: string[] = []
  const id = newId((candidate) => {
    asked.push(candidate)
    return asked.length < 3
  })
  expect(asked).toHaveLength(3)
  expect(id).toBe(asked[2])
})
