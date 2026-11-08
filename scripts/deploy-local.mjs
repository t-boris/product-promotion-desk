// Installs the freshly built app into /Applications and confirms the installed version (DEC-007).
// Usage: npm run deploy:local   (builds first, then runs this script)
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const appName = `${pkg.productName}.app`
const built = join(root, 'dist', 'mac-arm64', appName)
const installDir = process.env.PPD_INSTALL_DIR || '/Applications'
const target = join(installDir, appName)

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })
const read = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()
const bundleVersion = (app) => read('defaults', ['read', join(app, 'Contents', 'Info'), 'CFBundleShortVersionString'])

if (!existsSync(built)) {
  console.error(`Build output not found: ${built}\nRun "npm run dist" first.`)
  process.exit(1)
}

const builtVersion = bundleVersion(built)
if (builtVersion !== pkg.version) {
  console.error(`Built bundle is ${builtVersion} but package.json is ${pkg.version}; rebuild.`)
  process.exit(1)
}

// An explicit quit is how a running instance is stopped; automation resumes only when the new app is launched.
try {
  execFileSync('osascript', ['-e', `tell application "${pkg.productName}" to quit`], { stdio: 'ignore' })
} catch {
  // Not running.
}

if (existsSync(target)) rmSync(target, { recursive: true, force: true })
run('ditto', [built, target])
// Unsigned local build: ad-hoc sign (required on Apple Silicon) and drop the quarantine flag.
run('codesign', ['--force', '--deep', '--sign', '-', target])
try {
  run('xattr', ['-cr', target])
} catch {
  // No extended attributes to clear.
}

const installed = bundleVersion(target)
console.log(`Installed ${appName} ${installed} at ${target}`)
if (installed !== pkg.version) {
  console.error(`Version mismatch: installed ${installed}, expected ${pkg.version}`)
  process.exit(1)
}
console.log(`OK: deployed version ${installed} matches package.json`)
