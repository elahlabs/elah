// Metro config for the @elah/react-native dev harness.
//
// 1. The @elah packages are read from SOURCE (packages/*/src), so edits there
//    reload instantly, the same way apps/web aliases them in next.config.mjs.
// 2. npm packages imported from packages/*/src (react, zustand, immer, ...)
//    resolve from THIS app's node_modules. The repo root hoists React 18 for the web
//    packages; letting Metro walk up to it would load two Reacts.
// 3. The root `@elah/core` entry is refused with a readable error. It reaches
//    the export worker's `import.meta`, which Metro cannot parse. Everything a
//    phone needs is on `@elah/core/engine` (see docs/react-native, RN-T1).
//    Type-only imports of `@elah/core` are erased by Babel and never get here.

const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const repoRoot = path.resolve(projectRoot, '../..')
const packages = path.join(repoRoot, 'packages')

const ELAH_SOURCES = {
  '@elah/core/engine': path.join(packages, 'core/src/engine.ts'),
  '@elah/react': path.join(packages, 'react/src/index.ts'),
  '@elah/react-native': path.join(packages, 'react-native/src/index.ts'),
}

const config = getDefaultConfig(projectRoot)

config.watchFolders = [path.join(packages, 'core/src'), path.join(packages, 'react/src'), path.join(packages, 'react-native/src')]
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules')]

const reactSrc = path.join(packages, 'react/src')

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const source = ELAH_SOURCES[moduleName]
  if (source) return { type: 'sourceFile', filePath: source }

  if (moduleName === '@elah/core' || moduleName.startsWith('@elah/core/')) {
    throw new Error(
      `${moduleName} imported by value from ${path.relative(repoRoot, context.originModulePath)}. ` +
        "React Native must use '@elah/core/engine' (the root entry reaches import.meta). " +
        'Use `import type` for types.',
    )
  }

  // Web preview only: Metro prefers `.native` files on iOS/Android but not on
  // web, so @elah/react's DOM useMediaLibrary would pull in the root entry.
  // The harness has no DOM importers either way, so web uses the native variant.
  if (
    platform === 'web' &&
    moduleName === './useMediaLibrary' &&
    context.originModulePath.startsWith(reactSrc)
  ) {
    return { type: 'sourceFile', filePath: path.join(reactSrc, 'useMediaLibrary.native.ts') }
  }

  // An npm import made from packages/*/src (react, zustand, immer...) resolves
  // as if this app had made it, so it never walks up to the repo root's copies.
  const isBare = !moduleName.startsWith('.') && !path.isAbsolute(moduleName)
  if (isBare && context.originModulePath.startsWith(packages)) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(projectRoot, 'index.ts') },
      moduleName,
      platform,
    )
  }

  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
