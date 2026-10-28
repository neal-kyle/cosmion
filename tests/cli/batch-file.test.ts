import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readBatchFile } from '../../src/cli/batch-file.js'
import { CosmionError } from '../../src/core/errors.js'
import { createTestContext } from '../helpers/run-cli.js'

/** Writes `name` in a fresh cwd and reads it as a batch file. */
async function read(name: string, text: string) {
  const t = createTestContext()
  writeFileSync(join(t.cwd, name), text)
  return readBatchFile(t.ctx, name)
}

async function usageError(name: string, text: string): Promise<string> {
  const error = await read(name, text).then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(error).toBeInstanceOf(CosmionError)
  expect((error as CosmionError).code).toBe('usage')
  return (error as CosmionError).message
}

describe('CSV batch files (FR-070)', () => {
  test('a header row, then one row per generation', async () => {
    const rows = await read(
      'jobs.csv',
      'prompt,model,aspect,count,seed,out\na fox,a/model,16:9,2,42,fox.png\na cat,,,,,\n',
    )
    expect(rows).toEqual([
      {
        row: 1,
        prompt: 'a fox',
        model: 'a/model',
        options: { aspect: '16:9', count: 2, seed: 42 },
        refs: [],
        out: 'fox.png',
      },
      { row: 2, prompt: 'a cat', model: undefined, options: {}, refs: [], out: undefined },
    ])
  })

  test('a byte-order mark and CRLF line endings', async () => {
    const rows = await read('jobs.csv', '﻿prompt,quality\r\na fox,high\r\n')
    expect(rows).toEqual([
      {
        row: 1,
        prompt: 'a fox',
        model: undefined,
        options: { quality: 'high' },
        refs: [],
        out: undefined,
      },
    ])
  })

  test('quoted commas, quotes and line breaks', async () => {
    const rows = await read('jobs.csv', 'prompt\n"a fox, red ""and"" quick\non two lines"\n')
    expect(rows[0]?.prompt).toBe('a fox, red "and" quick\non two lines')
  })

  test('refs separated by |', async () => {
    const rows = await read('jobs.csv', 'prompt,ref\na fox,a.png| https://x.test/b.png |\n')
    expect(rows[0]?.refs).toEqual(['a.png', 'https://x.test/b.png'])
  })

  test('every gen option is a column', async () => {
    const rows = await read(
      'jobs.csv',
      'prompt,aspect,resolution,quality,background,count,seed,format,compression\nx,1:1,2K,high,transparent,1,7,png,80\n',
    )
    expect(rows[0]?.options).toEqual({
      aspect: '1:1',
      resolution: '2K',
      quality: 'high',
      background: 'transparent',
      count: 1,
      seed: 7,
      format: 'png',
      compression: 80,
    })
  })

  test('an unknown column exits 2 naming it', async () => {
    expect(await usageError('jobs.csv', 'prompt,colour\na fox,red\n')).toMatch(/colour/)
  })

  test('a malformed file exits 2', async () => {
    expect(await usageError('jobs.csv', 'prompt,model\n"a fox,a/model\n')).toMatch(/jobs\.csv/)
  })
})

describe('JSONL batch files (FR-070)', () => {
  test('one object per line, refs as an array, blank lines ignored', async () => {
    const rows = await read(
      'jobs.jsonl',
      [
        '{"prompt": "a fox", "model": "a/model", "count": 2, "ref": ["a.png", "b.png"], "out": "x/"}',
        '',
        '{"prompt": "a cat", "seed": "9"}',
        '',
      ].join('\n'),
    )
    expect(rows).toEqual([
      {
        row: 1,
        prompt: 'a fox',
        model: 'a/model',
        options: { count: 2 },
        refs: ['a.png', 'b.png'],
        out: 'x/',
      },
      { row: 2, prompt: 'a cat', model: undefined, options: { seed: 9 }, refs: [], out: undefined },
    ])
  })

  test('a line that is not a JSON object exits 2 with its row', async () => {
    const message = await usageError('jobs.jsonl', '{"prompt": "a"}\n[1, 2]\n{"prompt": \n')
    expect(message).toMatch(/row 2/i)
    expect(message).toMatch(/row 3/i)
  })
})

describe('problems are reported with their row numbers', () => {
  test('a missing prompt, a bad count and an unknown column, all at once', async () => {
    const message = await usageError(
      'jobs.jsonl',
      [
        '{"prompt": "fine"}',
        '{"model": "a/model"}',
        '{"prompt": "x", "count": "two"}',
        '{"prompt": "x", "colour": "red"}',
        '{"prompt": "x", "ref": "a.png"}',
        '{"prompt": "  "}',
      ].join('\n'),
    )
    expect(message).toMatch(/row 2.*prompt/i)
    expect(message).toMatch(/row 3.*count/i)
    expect(message).toMatch(/row 4.*colour/i)
    expect(message).toMatch(/row 5.*ref/i)
    expect(message).toMatch(/row 6.*prompt/i)
    expect(message).not.toMatch(/row 1\b/i)
  })

  test('in CSV, a count that is not a whole number', async () => {
    expect(await usageError('jobs.csv', 'prompt,count\nx,1.5\n')).toMatch(/row 1.*count/i)
  })

  test('a file without rows exits 2', async () => {
    expect(await usageError('jobs.csv', 'prompt\n')).toMatch(/no rows/i)
  })
})

describe('the file', () => {
  test('anything but .csv or .jsonl exits 2', async () => {
    expect(await usageError('jobs.txt', 'prompt\nx\n')).toMatch(/\.csv.*\.jsonl/)
  })

  test('the extension is not case-sensitive', async () => {
    expect(await read('JOBS.CSV', 'prompt\nx\n')).toHaveLength(1)
  })

  test('a file that cannot be read exits 2', async () => {
    const t = createTestContext()
    const error = await readBatchFile(t.ctx, 'missing.csv').catch((e: unknown) => e)
    expect((error as CosmionError).code).toBe('usage')
    expect((error as CosmionError).message).toMatch(/missing\.csv/)
  })
})
