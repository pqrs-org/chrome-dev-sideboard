import fs from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

// Bind each VM entry point to the source module's exports.
type Modules = {
  '../src/cookie-store.js': typeof import('../../src/cookie-store.js')
  '../src/page-content-script-image.js': typeof import('../../src/page-content-script-image.js')
  '../src/sidepanel-image-previews.js': typeof import('../../src/sidepanel-image-previews.js')
  '../src/sidepanel-state.js': typeof import('../../src/sidepanel-state.js')
  '../src/sidepanel-metadata.js': typeof import('../../src/sidepanel-metadata.js')
  '../src/sidepanel-storage.js': typeof import('../../src/sidepanel-storage.js')
  '../src/page-content-script-metadata.js': typeof import('../../src/page-content-script-metadata.js')
  '../src/sidepanel-tabs.js': typeof import('../../src/sidepanel-tabs.js')
  '../src/error-message.js': typeof import('../../src/error-message.js')
  '../src/page-content-script-storage.js': typeof import('../../src/page-content-script-storage.js')
  '../src/sidepanel.js': typeof import('../../src/sidepanel.js')
  '../src/background.js': typeof import('../../src/background.js')
  '../src/network-stats.js': typeof import('../../src/network-stats.js')
  '../src/sidepanel-json.js': typeof import('../../src/sidepanel-json.js')
  '../src/sidepanel-active-tab.js': typeof import('../../src/sidepanel-active-tab.js')
  '../src/sidepanel-editor.js': typeof import('../../src/sidepanel-editor.js')
  '../src/sidepanel-image-access.js': typeof import('../../src/sidepanel-image-access.js')
  '../src/image-fetch.js': typeof import('../../src/image-fetch.js')
  '../src/sidepanel-page-data.js': typeof import('../../src/sidepanel-page-data.js')
  '../src/sidepanel-overview.js': typeof import('../../src/sidepanel-overview.js')
  '../src/page-content-script.js': typeof import('../../src/page-content-script.js')
}

// Dependency stubs retain the source function signatures. Shared state is a
// separate boundary because these tests intentionally supply only the DOM and
// state fields exercised by a scenario (typed by the test's local fixture).
type ModuleMocks = {
  [
    K in keyof Modules as K extends `../src/${infer Name}` ? `./${Name}` : never
  ]?: K extends '../src/sidepanel-state.js'
    ? { SidepanelState: Record<string, unknown> }
    : {
        [E in keyof Modules[K]]?: Modules[K][E] extends (
          ...args: never[]
        ) => unknown
          ? Modules[K][E]
          : Partial<Modules[K][E]>
      }
}

// Each test gets an isolated browser-like context. Only the VM boundary is cast;
// callers receive the actual source API type, never untyped require() exports.
export const runModule = <K extends keyof Modules>(
  filename: K,
  globals: Record<string, unknown> = {},
  mocks: ModuleMocks = {},
): Modules[K] => {
  const context = vm.createContext({ URL, console, ...globals })
  const cache = new Map<string, { exports: unknown }>()
  const load = (file: string): unknown => {
    const cached = cache.get(file)
    if (cached) {
      return cached.exports
    }
    const module = { exports: {} as unknown }
    cache.set(file, module)
    const resolve = createRequire(file)
    const requireModule = (specifier: string): unknown => {
      if (Object.hasOwn(mocks, specifier)) {
        return (mocks as Record<string, unknown>)[specifier]
      }
      return specifier.startsWith('.')
        ? load(resolve.resolve(specifier))
        : resolve(specifier)
    }
    const execute = vm.compileFunction(
      fs.readFileSync(file, 'utf8'),
      ['exports', 'require', 'module'],
      { filename: file, parsingContext: context },
    )
    execute(module.exports, requireModule, module)
    return module.exports
  }
  return load(require.resolve('../' + filename)) as Modules[K]
}
