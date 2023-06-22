'use strict'

const createContext = []
const recomputeContext = []
const queuedUpdates = {}
let finishedRecomputes = {}

function isNode(el) {
  return el && el.nodeName && el.nodeType
}

function peek(arr) {
  return arr[arr.length - 1]
}

function shouldUpdate(prev, next) {
  return prev !== next
}

const r = function (init, name) {
  const place = typeof name === 'string' ? new Error(name || 'Reactive') : new Error('Reactive')
  const id = typeof name === 'symbol' ? name : Symbol()
  let proxy
  let cachedValue
  let ctx
  const unbox = () => (cachedValue || init)
  const recompute = typeof init === 'function' ? init : unbox

  let domUpdateHandled = false
  const recomputeThis = () => {
    domUpdateHandled = true
    return cachedValue
  }
  recomputeThis.toString = init.toString
  recomputeThis.cachedValue = cachedValue

  function onChange() {
    const prevValue = cachedValue
    // domUpdateHandled = false
    recomputeThis.cachedValue = cachedValue
    cachedValue = recompute.call(recomputeThis)
    // cachedValue = nextValue
    recomputeThis.cachedValue = cachedValue
    // if (domUpdateHandled) {
    //   return
    // }
    // if (isNode(prevValue)) {
    //   // Assume nextValue is also a node or null.
    //   if (!nextValue) {
    //     prevValue.remove()
    //   } else {
    //     prevValue.replaceWith(nextValue)
    //   }
    //   return
    // }
    if (shouldUpdate(prevValue, cachedValue)) {
      updateDependents()
    }
  }

  ctx = {id, onChange}

  const dependents = {}
  function register() {
    const ctx = peek(createContext)
    if (ctx) {
      // This overrides the previous reference which allows garbage collection.
      dependents[ctx.id] = ctx
    }
  }

  function updateDependents() {
    if (!queuedUpdates[id]) { // queue self to batch updates to dependents
      queuedUpdates[id] = true
      queueMicrotask(() => {
        delete queuedUpdates[id]

        for (const ctx of Object.values(dependents)) {
          if (finishedRecomputes[ctx.id]) {
            // A series of microtasks is prevented from updating the
            // same context twice.
            console.error('Loop', place)
            return
          }
          ctx.onChange() // this might queue another update microtask
          finishedRecomputes[ctx.id] = true
        }

        if (Object.keys(queuedUpdates).length) {
          // another microtask is queued after this one,
          // defer cleanup to that one.
          return
        }
        // Reset loop detection before next task.
        // This happens after all microtasks have ran.
        finishedRecomputes = {}
      })
    }
  }

  proxy = new Proxy(unbox, {
    get: (unbox, prop) => {
      register()

      if (prop === 'toString') {
        return () => init.toString()
      } else if (prop === 'cachedValue') {
        return cachedValue
      }
    },
    apply: (target, thisArg, args) => {
      if (!args.length) {
        register()
        return cachedValue
      } else {
        cachedValue = args[0]
        recomputeThis.cachedValue = cachedValue
        updateDependents()
      }
    }
  })

  createContext.push(ctx)
  recomputeThis.isInit = true
  cachedValue = recompute.call(recomputeThis)
  recomputeThis.isInit = false
  recomputeThis.cachedValue = cachedValue
  createContext.pop()

  return proxy
}

const a = r(0)

r(function () {
  console.log('this())', this(), this.cachedValue)
  if (this()) {
    return this() + 1
  } else {
    return a()
  }
}, a[Symbol.for('__')].id)

a(1)
a(0)
a(0)