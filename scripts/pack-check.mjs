// Packs Cosmion as npm would publish it, installs the tarball in an empty folder and runs
// the installed commands against the fake OpenRouter (FR-060, FR-063, Story 6).
// Run with `npm run pack-check`; CI runs it on Linux, macOS and Windows.
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { createFakeOpenRouter, serveFakeOpenRouter } from '../tests/helpers/fake-openrouter.ts'

const run = promisify(execFile)
const isWindows = process.platform === 'win32'
// npm is a .cmd file on Windows, and so are the commands it installs.
const options = { shell: isWindows, maxBuffer: 16 * 1024 * 1024 }
const root = join(import.meta.dirname, '..')
const work = mkdtempSync(join(tmpdir(), 'cosmion-pack-check-'))

function check(condition, message) {
  if (!condition) throw new Error(`pack-check failed: ${message}`)
  console.log(`ok  ${message}`)
}

try {
  const { stdout: packed } = await run('npm', ['pack', '--json', '--pack-destination', work], {
    ...options,
    cwd: root,
  })
  const tarball = join(work, JSON.parse(packed)[0].filename)
  check(existsSync(tarball), `packed ${tarball}`)

  const app = join(work, 'app')
  await run('npm', ['install', '--no-audit', '--no-fund', '--prefix', app, tarball], {
    ...options,
    cwd: work,
  })

  const bin = (name) => join(app, 'node_modules', '.bin', isWindows ? `${name}.cmd` : name)
  check(existsSync(bin('cosmion')), 'the cosmion command is installed')
  check(existsSync(bin('csn')), 'the csn command is installed')

  const installed = join(app, 'node_modules', 'cosmion')
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  check(manifest.engines?.node === '>=22.12.0', 'engines.node is ">=22.12.0"')
  for (const file of ['SKILL.md', 'README.md', 'LICENSE']) {
    check(existsSync(join(installed, file)), `${file} is in the package`)
  }

  const nativeFiles = filesUnder(join(app, 'node_modules')).filter((file) => file.endsWith('.node'))
  check(nativeFiles.length === 0, `no native modules (.node files) ${nativeFiles.join(' ')}`)
  const withScripts = installScripts(join(app, 'node_modules'))
  check(withScripts.length === 0, `no install scripts ${withScripts.join(' ')}`)

  const fake = createFakeOpenRouter()
  const server = await serveFakeOpenRouter(fake)
  try {
    const env = {
      ...process.env,
      COSMION_HOME: join(work, 'home'),
      COSMION_TEST_OPENROUTER_URL: server.url,
      OPENROUTER_API_KEY: '',
    }
    const cosmion = (name, args) => run(bin(name), args, { ...options, env })

    const version = (await cosmion('cosmion', ['--version'])).stdout.trim()
    check(version === manifest.version, `cosmion --version prints ${manifest.version}`)
    const csnVersion = (await cosmion('csn', ['--version'])).stdout.trim()
    check(csnVersion === manifest.version, 'csn --version prints the same')
    const help = (await cosmion('cosmion', ['--help'])).stdout
    check(help.includes('Usage: cosmion'), 'cosmion --help works')

    const models = JSON.parse((await cosmion('cosmion', ['models', '--json'])).stdout)
    check(models.models.length > 0, `cosmion models --json lists ${models.models.length} models`)
  } finally {
    await server.close()
  }
  console.log('pack-check passed')
} finally {
  rmSync(work, { recursive: true, force: true })
}

function filesUnder(folder) {
  return readdirSync(folder, { recursive: true })
    .map((file) => join(folder, String(file)))
    .filter((file) => statSync(file, { throwIfNoEntry: false })?.isFile())
}

/** Installed packages whose package.json runs a script on install. */
function installScripts(nodeModules) {
  return filesUnder(nodeModules)
    .filter((file) => basename(file) === 'package.json')
    .filter((file) => {
      try {
        const { name, scripts } = JSON.parse(readFileSync(file, 'utf8'))
        return name && scripts && ['preinstall', 'install', 'postinstall'].some((s) => s in scripts)
      } catch {
        return false
      }
    })
}
