const fs = require('node:fs')
const { createRequire } = require('node:module')
const vm = require('node:vm')

// Load compiled CommonJS modules in one isolated browser-like context per test.
const runModule = (filename, globals = {}, mocks = {}) => {
  const context = vm.createContext({ URL, console, ...globals })
  const cache = new Map()
  const load = (file) => {
    if (cache.has(file)) {
      return cache.get(file).exports
    }
    const module = { exports: {} }
    cache.set(file, module)
    const resolve = createRequire(file)
    const requireModule = (specifier) => {
      if (Object.hasOwn(mocks, specifier)) {
        return mocks[specifier]
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
  return load(filename)
}

module.exports = { runModule }
