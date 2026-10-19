#!/usr/bin/env node
/**
 * pack-npm-tarball.mjs — build an npm-publishable tarball without npm.
 *
 *   node tools/pack-npm-tarball.mjs <package-dir> [--out <dir>] [--dry-run]
 *
 * Why this exists: this machine runs DSH, which ships pnpm's runtime and *not* npm (`where npm`
 * finds nothing, and the bundled node has no npm/ directory). Packaging still has to be verifiable
 * here, so this tool reproduces the parts of `npm pack` that decide the artifact:
 *
 *   - the `files` allow-list in package.json (plus the files npm always includes: package.json,
 *     README*, LICENSE*, CHANGELOG*, and the `main`/`bin` targets);
 *   - the `node_modules`, `.git`, `.npmrc`, `*.tgz` excludes;
 *   - the `package/` prefix, gzip compression, and 0755 for lifecycle/bin scripts;
 *   - the same "Tarball Contents / Total files / package size / unpacked size / shasum" report
 *     `npm pack` prints, so `--dry-run` output is comparable line for line.
 *
 * The result is a normal npm tarball: `pnpm add ./<name>-<version>.tgz` (and therefore
 * `dsh plugin --profile <p> add ./<name>-<version>.tgz`) installs it exactly like a registry
 * download, which is what makes it a usable distribution rehearsal. Publishing itself still goes
 * through `npm publish` on a machine that has npm.
 *
 * Options:
 *   --out <dir>   where to write the tarball (default: the package directory)
 *   --dry-run     print the report without writing a tarball
 *   --json        machine-readable report
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'

/** Files npm always packs when present, whatever `files` says. */
const ALWAYS = /^(?:readme|license|licence|changelog|history|notice)(?:\.[a-z0-9]+)?$/i
/** Never packed, whatever `files` says. */
const NEVER = /^(?:\.git|\.gitignore|\.npmignore|node_modules|\.npmrc|\.DS_Store)(?:$|\/)/

function toPosix(path) {
  return path.split(sep).join('/')
}

/** Every regular file under `abs`, as absolute paths. */
function walk(abs) {
  const out = []
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = join(abs, entry.name)
    if (entry.isDirectory()) out.push(...walk(child))
    else if (entry.isFile()) out.push(child)
  }
  return out
}

/**
 * Resolve the file list exactly the way the `files` allow-list does: each entry is a file or a
 * directory (recursive), and npm's always-include/never-include rules win over both.
 */
export function collectFiles(packageDir, manifest, { warn = () => {} } = {}) {
  const allow = Array.isArray(manifest.files) ? manifest.files : []
  const selected = new Map()

  const consider = (abs) => {
    const rel = toPosix(relative(packageDir, abs))
    if (rel.length === 0 || rel.startsWith('..')) return
    if (NEVER.test(rel)) return
    selected.set(rel, abs)
  }

  for (const entry of allow) {
    const abs = resolve(packageDir, entry)
    if (!existsSync(abs)) {
      warn(`files entry not found: ${entry}`)
      continue
    }
    if (statSync(abs).isDirectory()) for (const file of walk(abs)) consider(file)
    else consider(abs)
  }

  // npm always includes the manifest, and the readme/license/changelog of the package root.
  consider(join(packageDir, 'package.json'))
  for (const name of readdirSync(packageDir)) {
    if (ALWAYS.test(name)) consider(join(packageDir, name))
  }
  // …and never omits an entry point it would then have to fail to load.
  for (const target of [manifest.main, ...Object.values(manifest.bin ?? {})]) {
    if (typeof target === 'string' && target.length > 0) consider(resolve(packageDir, target))
  }

  return [...selected.entries()]
    .map(([rel, abs]) => ({ rel, abs, size: statSync(abs).size, mode: /\.(?:mjs|cjs|js|sh)$/.test(rel) && manifest.bin && Object.values(manifest.bin).includes('./' + rel) ? 0o755 : 0o644 }))
    .sort((left, right) => (left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0))
}

/** One ustar header block (512 bytes) for a regular file. */
function header(name, size, mode, mtimeSeconds) {
  const block = Buffer.alloc(512)
  const write = (text, offset, length) => block.write(text, offset, length, 'utf8')
  const octal = (value, length) => Math.max(0, Math.min(value, 8 ** (length - 1) - 1)).toString(8).padStart(length - 1, '0') + '\0'

  write(name.slice(0, 100), 0, 100)
  write(octal(mode, 8), 100, 8)
  write(octal(0, 8), 108, 8) // uid
  write(octal(0, 8), 116, 8) // gid
  write(octal(size, 12), 124, 12)
  write(octal(mtimeSeconds, 12), 136, 12)
  block.write('        ', 148, 8, 'utf8') // checksum placeholder: spaces
  block.write('0', 156, 1, 'utf8') // typeflag: regular file
  write('ustar\0', 257, 6)
  write('00', 263, 2)

  let sum = 0
  for (const byte of block) sum += byte
  write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return block
}

/** Build the tarball buffer: `package/`-prefixed ustar entries + gzip. */
export function buildTarball(packageDir, files, { mtime = new Date() } = {}) {
  const seconds = Math.floor(mtime.getTime() / 1000)
  const chunks = []
  for (const file of files) {
    const data = readFileSync(file.abs)
    chunks.push(header('package/' + file.rel, data.length, file.mode, seconds), data)
    const padding = (512 - (data.length % 512)) % 512
    if (padding > 0) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(1024)) // two zero blocks end the archive
  return gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 })
}

async function main(argv) {
  const args = argv.filter((argument) => !argument.startsWith('--'))
  const flags = new Set(argv.filter((argument) => argument.startsWith('--')))
  const packageDir = resolve(args[0] ?? '.')
  const outIndex = argv.indexOf('--out')
  const outDir = outIndex >= 0 ? resolve(argv[outIndex + 1]) : packageDir

  const manifestPath = join(packageDir, 'package.json')
  if (!existsSync(manifestPath)) throw new Error('no package.json in ' + packageDir)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const warnings = []
  const files = collectFiles(packageDir, manifest, { warn: (message) => warnings.push(message) })

  const name = String(manifest.name ?? '')
  const version = String(manifest.version ?? '')
  if (name.length === 0 || version.length === 0) throw new Error('package.json needs name and version')
  const tarball = `${name}-${version}.tgz`

  const unpacked = files.reduce((total, file) => total + file.size, 0)
  if (flags.has('--dry-run') || flags.has('--json')) {
    const report = {
      filename: tarball,
      files: files.map((file) => ({ path: file.rel, size: file.size, mode: file.mode.toString(8) })),
      unpackedSize: unpacked,
      warnings,
    }
    if (flags.has('--json')) process.stdout.write(JSON.stringify(report, undefined, 2) + '\n')
    else printReport(name, version, files, unpacked, warnings)
    return 0
  }

  const buffer = buildTarball(packageDir, files)
  mkdirSync(outDir, { recursive: true })
  const target = join(outDir, tarball)
  writeFileSync(target, buffer)
  printReport(name, version, files, unpacked, warnings)
  process.stdout.write('\nshasum: ' + createHash('sha1').update(buffer).digest('hex') + '\n')
  process.stdout.write('package size: ' + formatSize(buffer.length) + '\n')
  process.stdout.write('wrote: ' + target + '\n')
  return 0
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' kB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function printReport(name, version, files, unpacked, warnings) {
  process.stdout.write('npm notice Tarball Contents\n')
  for (const file of files) {
    process.stdout.write(
      'npm notice ' + formatSize(file.size).padStart(8) + '  package/' + file.rel + (file.mode === 0o755 ? '  (0755)' : '') + '\n',
    )
  }
  process.stdout.write('npm notice Tarball Details\n')
  process.stdout.write('npm notice name: ' + name + '\n')
  process.stdout.write('npm notice version: ' + version + '\n')
  process.stdout.write('npm notice filename: ' + name + '-' + version + '.tgz\n')
  process.stdout.write('npm notice total files: ' + String(files.length) + '\n')
  process.stdout.write('npm notice unpacked size: ' + formatSize(unpacked) + '\n')
  for (const warning of warnings) process.stdout.write('npm notice WARNING: ' + warning + '\n')
}

/** Run only when invoked as a script (`node tools/pack-npm-tarball.mjs …`), not when imported. */
const invoked = process.argv[1] ?? ''
const isEntry = invoked.replaceAll('\\', '/').split('/').pop() === 'pack-npm-tarball.mjs'

if (isEntry) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write('pack-npm-tarball: ' + String(error?.message ?? error) + '\n')
    process.exitCode = 1
  }
}

export { formatSize }
