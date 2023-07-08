// @flow

const secret = Symbol()

export type CreationContext = {
  jCalls: Array<any>,
  memoizedCalls: Array<Reactive<any>>,
  callIndex: 0,
  onChange: (...props: Array<any>) => any,
  registerCreation: (reactiveObj: Reactive<any>) => any,
  handle: () => any,
  id: Symbol,
}

type RecomputeContext = {
  jCalls: Array<any>,
  jIndex: number,
  creations: Array<any>,
  index: number,
}

let creationContexts: Array<CreationContext> = []
let recomputeContexts: Array<RecomputeContext> = []
let finishedRecomputes: {[string]: boolean} = {}
let queuedUpdates: {[string]: boolean} = {}

function isEl(obj) {
  const canUseDOM = !!(
    typeof window !== 'undefined' &&
    window.document &&
    window.document.createElement
  )

  if (!canUseDOM) {
    return
  }

  const isObject = typeof obj === 'object' && obj !== null
  const isWindow = window === Object(window) && window === window.window
  if (!isObject || !isWindow || !(`Node` in window)) {
    return false
  }
  return typeof obj.nodeType === `number` && typeof obj.nodeName === `string`
}

function peek<T>(a: Array<T>): ?T {
  if (!a || !Array.isArray(a)) {
    return null
  }
  return a[a.length - 1]
}

function isReactive(obj: any): Reactive<any> | null %checks {
  return typeof obj === 'function' &&
  !obj?.__isBeam &&
  obj?.[secret] &&
  obj?._setShouldUpdate &&
  obj?._dependents
    ? obj
    : null
}

function setShouldUpdate(
  obj: any,
  shouldUpdate: (prev: any, next: any) => boolean,
) {
  if (isReactive(obj)) {
    const objR = (obj: Reactive<any>)
    objR._setShouldUpdate(shouldUpdate)
  }
}

function fromPromise<T>(p: Promise<T>): Reactive<{ value: ?T, state: string }> {
  const s: { value: ?T, state: string } = {
    value: null,
    state: 'pending',
  }
  const state = reactive(s)

  p.then((value: any) => {
    setShouldUpdate(state, (prev, next) => {
      return JSON.stringify(prev) !== JSON.stringify(next)
    })
    // todo: state() may cause unwanted registration.
    //  In theory, when the promise resolve, there should be no reactive context in the call stack.
    //  So, there should be no problem.
    state.value = value
    state.state = 'fulfilled'
  })

  return state
}

// a isDependent on b
function hasDependent(a: any, b: any): boolean %checks {
  return (
    !!isReactive(b) &&
    !!isReactive(a) &&
    !!a._dependents.find((c) => c._creationContext === c)
  )
}

function getDependents(a: Reactive<any>): Array<CreationContext> {
  return a._dependents
}

function getCreationContext(a: Reactive<any>): CreationContext {
  return a._creationContext
}

function getRootRecomputeContext(): ?RecomputeContext {
  return recomputeContexts[0]
}

function getNearestCreateContext(): ?CreationContext {
  return peek(creationContexts)
}

function isPrimitive(test: any): boolean {
  return test !== Object(test)
}

let constraintRecorder
function setConstraintRecorder(value) {
  constraintRecorder = value
}

let constraintTrace
function setConstraintTrace(value) {
  constraintTrace = value
}

function convertIntoProxies(props: {[string]: () => any}) {
  /*
  Note that j() (the replacement for hyperscript)
  converts props in jsx into functional expressions.

  For example:
    <span className=""/>
  Converts into:
    j('span', {className: () => ("")}, [])

  So usually, if most people are using JSX, we would expect
  `props[key]` in this convertIntoProxies function to be a propExpression.
  However, it is possible for people to manually pass props into
  a functional component AKA a factory function.
  If someone manually passes in a value besides a function in,
  then `propExpressions` here is a misnomer.
  Instead of creating a reactive function, we would be creating a
  reactive variable.
  In both cases, though, they are still both just reactive proxies.
  This means that inside of the functional component's implementation,
  since the developer should be expecting all props to be proxies,
  the developer still has control over when to unbox the proxy.

  Keep in mind, the reason why all props need to be proxies is because
  we want to control when a prop is used in order to build reactions
  around them when they are unboxed.
  This allows us to make fine-grained DOM updates.
  * */
  const result = {}
  for (const key of Object.keys(props)) {
    const propExpression = props[key]
    // This will evaluate the expression and cache the output value:
    const proxy = reactive(propExpression, `prop-wrapper-${propExpression.name || ''}`)
    // $FlowFixMe
    result[key] = proxy
  }
  return result
}

const debounce = (func, timeout) => {
  let timer

  return (...args) => {
    const deferred = () => {
      timer = null;
      func(...args);
    };

    timer && clearTimeout(timer)
    timer = setTimeout(deferred, timeout)
  };
}

// export type Reactive<T> = {
//   (): T,
//   _setShouldUpdate: (prev: any, next: any) => boolean,
//   _dependents: Array<CreationContext>,
//   _creationContext: CreationContext,
//   ...T
// }
export type Reactive<T> = T
type Extra = string | {debounce: number} | {timeout: number} | Symbol

function reactive<T>(init: T, extra?: ?Extra): Reactive<T> | () => Reactive<T> {
  const takesProps = typeof init === 'function' && init.length
  let onChange: (...props: Array<any>) => any

  const factory = (...args: Array<any>) => {
    const name = typeof extra === 'string' ? extra : (() => {
      if (typeof init === 'function') {
        return 'reactive function'
      } else {
        return 'reactive variable'
      }
    })()
    const place = new Error(name || 'reactive proxy')
    const id = typeof extra === 'symbol' ? extra : Symbol()

    if (!!args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      // Following React convention, the first argument should be a props object
      // for functional components.
      // In grainbox, properties of props are proxies.
      // Also in grainbox, each prop should be a functional expression.
      args[0] = convertIntoProxies(args[0])
    }

    const debounceSettings = extra?.debounce ? extra : null
    const timeoutSettings = extra?.timeout || extra?.timeout === 0 ? extra : null

    const isR = isReactive(init)
    if (isR) {
      return isR
    }

    if (takesProps) {
      const parentCtx = peek(recomputeContexts)
      if (parentCtx) {
        // In a recompute, instead of passing props in to create a new proxy,
        // the existing proxy is obtained by call order memoization, like react hooks,
        // and then props are passed into it, and it is recomputed.
        // The cachedValue is set, and if it returns html, then .replaceWith is called.
        const proxy = parentCtx.memoizedCalls[parentCtx.callIndex]
        parentCtx.callIndex++ // This will be reset to 0 in the parent's onChange() function.
        // Check if the proxy is the same
        onChange(...args)
        return proxy
      }
    }

    const defaultState = isPrimitive(init) ? Object(init) : {}
    const defaultFunction = () => {
      // return isPrimitive(init) ? init : null
      return defaultState.valueOf()
    }
    const recompute: () => any =
      // $FlowFixMe
      typeof init === 'function' ? init : defaultFunction
    let state = typeof init === 'object' || init?.__isProxy ? init : defaultState

    const dependents: {[Symbol]: CreationContext} = {}
    const creations = []
    let shouldUpdate = (prev, next) => prev !== next
    let setterLocked = false

    const register = () => {
      if (constraintRecorder) {
        return
      }
      if (recomputeContexts.length) {
        // When running as a recompute, do not register
        return
      }
      const createCtx = peek(creationContexts)
      if (createCtx) {
        dependents[createCtx.id] = createCtx
      }
    }

    // Register any observables used inside a computable.
    let cachedValue
    const unboxCache = () => {
      register()
      return cachedValue
    }

    // For printing a reactive function:
    Object.defineProperty(unboxCache, 'name', {value: name})

    let domUpdateHandled = false
    const recomputeThis = () => {
      domUpdateHandled = true
      return cachedValue
    }
    // recomputeThis.toString = init.toString

    const createContext: CreationContext = {
      jCalls: [],
      // If this is a reactive function, then whenever it runs,
      // any prop proxy calls made during its execution will
      // use the memoizedCalls array to obtain a reference to
      // the previous prop proxy. This is needed so that .replaceWith
      // on child components can be called.
      memoizedCalls: [],
      callIndex: 0,
      onChange: () => {}, // onChange makes a reference to createContext, so it hasn't been set yet.
      registerCreation: (reactiveObj) => {
        creations.push(reactiveObj)
      },
      handle: recompute,
      id,
      name
    }

    onChange = (...args: Array<any>) => {
      recomputeContexts.push({ index: 0, creations, jCalls: createContext.jCalls, jIndex: 0 })
      domUpdateHandled = false
      const nextValue: any = recompute.call(recomputeThis, ...args)
      init.cachedValue = nextValue
      recomputeContexts.pop()
      // At the end of the recompute, any component calls made incremented the memoization, like react hooks,
      // so they need to be reset.
      createContext.callIndex = 0
      const prevValue = cachedValue // setting should not causes registrations as dependent.
      cachedValue = nextValue
      // todo: there is no need to do DOM operations in this file.
      //  instead, jyperscript handles it.
      // if (
      //   !domUpdateHandled &&
      //   isEl(nextValue) &&
      //   !!nextValue?.replaceWith &&
      //   isEl(prevValue) &&
      //   !!prevValue?.replaceWith &&
      //   nextValue !== prevValue // See ref proxy
      // ) {
      //   prevValue.replaceWith(nextValue)
      // }

      if (isEl(prevValue) || isEl(nextValue)) {
        // Reactive elements do not propagate update signal.
        //
        return nextValue
      }

      if (shouldUpdate(prevValue, nextValue)) {
        updateDependents()
      }

      return nextValue
    }
    if (debounceSettings) {
      onChange = debounce(onChange, debounceSettings.debounce)
    }
    if (timeoutSettings) {
      const oc = onChange
      onChange = () => {
        setTimeout(oc, timeoutSettings.timeout)
      }
    }
    createContext.onChange = onChange

    creationContexts.push(createContext)
    recomputeThis.isInit = true
    cachedValue = recompute.call(recomputeThis, ...args) // todo the first time this runs, it needs to record any reactive creations.
    recomputeThis.isInit = false
    creationContexts.pop()

    function updateDependents() {
      // batching
      // There may be multiple data sources changing which both cause a common reactive function to recompute.
      // The recomputed value should then propagate to its own dependents.
      // If batching is put in place this would cause subsequent recomputes to happen on the next task.
      // Microtasks might be used to perform these subsequent recomputes soon, rather than being at the back of the task queue.
      // So to perform batching, instead of calling ctx.onChange(),
      // queue a microtask that calls ctx.onChange().
      // If another data source wants to call the same ctx.onChange(),
      // then it would see that it has already been queued.

      // Calls to updateDependents so that things are updates in breadth first order.
      if (!queuedUpdates[createContext.id]) { // batch updates
        queuedUpdates[createContext.id] = true
        queueMicrotask(() => {
          delete queuedUpdates[createContext.id]

          // Within this microtask, update all dependents:
          // $FlowFixMe
          const arr = Object.getOwnPropertySymbols(dependents).map(k => dependents[k])
          for (const ctx of Object.values(arr)) {
            if (finishedRecomputes[ctx.id]) {
              // A series of microtasks is prevented from updating the
              // same context twice.
              console.error('Loop', place)
              return
            }
            ctx.onChange() // this might queue another update microtask
            finishedRecomputes[ctx.id] = true
          }

          // Last thing to run is clean up:
          if (Object.getOwnPropertySymbols(queuedUpdates).length) {
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

    let lastLockingStack
    const pendingSets = []
    let pendingSetTimeout
    const reportPendingSets = () => {
      pendingSetTimeout = setTimeout(() => {
        pendingSetTimeout = null
        if (pendingSets.length) {
          // If there are any remaining pending sets still unapplied on the next frame,
          // then it means there are conflicting constraints enabled.
          console.group(`%cTwo or more constraints are conflicting: `, 'color: #ea2929;')
          console.error(lastLockingStack)
          for (const ps of pendingSets) {
            console.error(ps[1])
          }
          console.groupEnd()
        }
      })
    }

    function set(obj, prop, value) {
      // Performing a set should not cause dependency registration

      // $FlowFixMe
      const currentValue = isPrimitive(init) ? state.valueOf() : state[prop]
      const updateNeeded = shouldUpdate(currentValue, value)

      if (constraintRecorder && !setterLocked) {
        constraintRecorder(proxy, prop, currentValue)
      }
      if (setterLocked) {
        // todo:
        //  If locked, record this set as a pending operation.
        //  If during this frame the proxy is unlocked, then the pending set will by applied.
        if (constraintRecorder && updateNeeded) {
          const setConstraintRecorder = constraintRecorder
          const trace = constraintTrace()
          pendingSets.push([() => {
            proxy[prop] = value
            proxy(() => ({lock: true, trace}))
            // a reference to constraintRecorder must survive even after attempted locking.
            setConstraintRecorder(proxy, prop, currentValue)
          }, trace])
          reportPendingSets()
        }
        return true
      }

      if (updateNeeded) {
        const isInputRef = init?.__isRef && init?.__isResolved && init().tagName === 'INPUT' && init().type !== 'image'
        // $FlowFixMe
        if (isPrimitive(init)) {
          state = Object(value)
          cachedValue = state.valueOf()
        } else if (isInputRef) {
          init().value = value
        } else {
          state[prop] = value
          cachedValue = state
        }

        updateDependents()
      }
      return true
    }

    // $FlowFixMe
    const proxy: Reactive<T> = new Proxy(unboxCache, {
      get(unboxCache, prop) {
        if (
          prop !== '__isProxy' &&
          prop !== '__isRef' &&
          prop !== '__isBeam' &&
          prop !== '__isResolved' &&
          prop !== '__isNullProxy'
        ) {
          register()
        }

        if (prop === secret) {
          return true
        }
        if (prop === 'toString' && unboxCache().__isBeam) {
          return state?.toString
        }
        if (prop === 'toString') {
          return () => init?.toString()
        }
        if (
          prop === 'valueOf' ||
          prop === Symbol.toStringTag ||
          prop === Symbol.toPrimitive
        ) {
          return () => {
            if (typeof cachedValue !== 'string' && typeof cachedValue !== 'number') {
              return cachedValue.toString()
            } else {
              return cachedValue
            }
          }
        }
        if (prop === 'name') {
          if (state?.hasOwnProperty('name')) {
            return state?.['name']
          } else {
            return unboxCache.name
          }
        }
        if (prop === '_setShouldUpdate') {
          return (func) => {
            shouldUpdate = func
          }
        }
        if (prop === '__updateDependents') {
          return updateDependents
        }
        if (prop === '_dependents') {
          return dependents
        }
        if (prop === '_creationContext') {
          return createContext
        }
        if (prop === '__isProxy') {
          return true
        }
        if (prop === '__isReactive') {
          return true
        }
        if (init?.__isBeam) {
          if (prop === '__resolve') {
            // internally used when beam tries to resolve.
            const beamResolve = state?.[prop]
            return (value) => {
              beamResolve(value)
              updateDependents()
            }
          } else {
            // state is a beam proxy.
            const value = state?.[prop]
            // value is:
            //  - new reactive proxy when a new leaf is created
            //  - unboxed value when leaf is resolved
            if (value?.__isResolved) {
              // resolved
              // Return the value boxed still
              return value
            } else {
              // new leaf
              // it is wrapped with reactive
              return value
            }
          }
        }
        if (prop === '__isResolved' && !init?.__isBeam && !init?.__isRef) {
          return true
        }

        // $FlowFixMe
        return state?.[prop]
        // const arr = unboxCache()
        // console.log('arr', arr)
        // if (Array.isArray(arr)) {
        //   if (prop === 'map') {
        //     const originalProp = arr[prop].bind(arr)
        //
        //     const newMap = (...args) => {
        //       const cb = args[0]
        //
        //       // map should cause the source and destination arrays to become and stay parallel.
        //       // If items are added, removed, or moved, in the source then they react accordingly.
        //       const result = reactive(originalProp(...args), 'mapped')
        //
        //       parallelArrays(arr, result, cb)
        //
        //       // The new .map should return a reactive object and it should register itself as a dependent.
        //       creationContexts.push(createContext)
        //       result()
        //       creationContexts.pop()
        //
        //       // lines.map() is called outside of a reactive context.
        //       // This causes the newMap() to run, which creates a reactive result.
        //       // Registration as dependent happens on get, set, or (),
        //       // but only if there is a creation context.
        //       // A creation context is created whenever reactive(() => {}) is called.
        //       // The function passed in is called when reactive is called, but it is called within a creation context.
        //       // So a creation context can be thought of as a function which is running inside a reactive() call.
        //       // Any usage of other already instantiated reactive objects registers the new reactive object as a dependent.
        //       // Upstream changes in those objects will cause the function in reactive(() => {}) to recompute.
        //       // So .map creates a new reactive object, kind of like how reactive(() => {}) does.
        //       // And the returned reactive object should be listening to changes.
        //       // const outlines = reactive(() => {return lines.map(() => {})})
        //
        //
        //       return result
        //     }
        //     return newMap.bind(arr)
        //   }
        //   if (prop === 'push') {
        //     const originalProp = arr[prop].bind(arr)
        //     const newProp = (item) => {
        //       console.log('newPush', item)
        //       set(arr, arr.length, item)
        //       return originalProp(item)
        //     }
        //     return newProp.bind(arr)
        //   }
        // }
      },
      set,
      apply(target, thisArg, args) {
        if (args.length) {
          // Passing args in allows alternative behavior besides unboxing.
          // Normally, w empty args, reactive apply is used for:
          //  - unboxing
          //  - registering self as a listener to the outer reactive context.

          if (init.__isBeam) {
            // init is a beam proxy
            register()
            if (!init.__isResolved) {
              // value is a beam proxy, unboxed once.
              // In general a beam proxy should never be exposed.
              // only a reactive proxy or a resolved value.
              return proxy // allows ability to chain listener registration.
            } else {
              // the resolved value is unboxed.
              const value = init(...args)
              return value
            }
          } else if (args.length === 1 && typeof args[0] === 'function') {
            // Passing a function into an apply is a different kind of operation
            // than passing in a non-function value.
            // This is currently only used for the constraint system.
            // Passing in (() => {lock: true}) or (() => {unlock: true})
            // to lock or unlock the proxy.

            const specialArgs = args[0]()
            if (!!specialArgs && typeof specialArgs === 'object') {
              if (specialArgs?.lock) {
                if (!setterLocked) {
                  lastLockingStack = specialArgs.trace
                }
                setterLocked = true
              } else if (specialArgs?.unlock) {
                const prevSetterLocked = setterLocked
                setterLocked = false
                if (prevSetterLocked && pendingSets.length) {
                  const ps = pendingSets.shift()
                  ps[0]()
                }
              } else if (specialArgs?.noRegister) {
                return cachedValue
              } else if (specialArgs?.onResolve) {
                reactive(() => {
                  // todo: These rules would be useful here:
                  //  unresolved proxy unboxes to null
                  //  null proxy unboxes to null
                  proxy()
                  if (!this() && proxy.__isResolved) {
                    specialArgs?.onResolve()
                    // todo: delete this reaction
                  }
                  return proxy.__isResolved
                })
              }
            }
            return
          } else if (args.length === 1 && typeof args[0] !== 'function') {
            // Passing in a non-function value will set.

            // If it is primitive:
            if (isPrimitive(args[0])) {
              // prop name is set to _ as a dummy name
              proxy._ = args[0]
            } else {
              // An object was passed in
              for (const key of Object.keys(args[0])) {
                proxy[key] = args[0][key]
              }
            }
            return
          }
        }
        if (init.__isBeam) {
          // init is a beam proxy
          register()
          // unbox:
          return init()
        }
        if (init.__isRef) {
          return unboxCache()()
        }
        return unboxCache()
      }
    })

    const createCtx = peek(creationContexts)
    // console.log('createCtx', createCtx)
    // console.log('init', init)
    if (createCtx) {
      // This runs during the first call of the recompute function.
      // Any specials objects created during a recompute
      // need to be blocked, and instead merged into the
      // the matching original object.
      // the observer is part of the specials which should remember creations made within its context.
      createCtx?.registerCreation(proxy)
      // console.warn('registerCreation', createCtx.init, init)
    }

    const recomputeCtx = peek(recomputeContexts)
    // console.log('recomputeCtx', recomputeCtx)
    // console.log('creations', creations)
    if (recomputeCtx) {
      // This runs when a subsequent recompute calls creates a specials obj.
      // Instead of returning a new specials obj in this case,
      // we need to return the same specials obj that was created the first time recompute function was called.
      const item = recomputeCtx.creations[recomputeCtx.index]
      recomputeCtx.index++
      if (item) {
        // console.warn('blocked specials obj')
        return item
      }
    }

    if (takesProps) {
      // When a functional component is instantiated, it is usually done inside
      // of a createContext, i.e. inside of a reactive function who is passing in props.
      const createCtx = peek(creationContexts)
      if (createCtx) {
        register()
        createCtx.memoizedCalls.push(proxy)
      }
    }

    // console.warn('created new specials obj', init)
    // $FlowFixMe
    return proxy
  }

  if (takesProps) {
    // A function with props, probably a functional component.
    // These need props passed in to create proxies, so they will be called later.
    return factory
  } else {
    return factory()
  }
}

async function updates(): Promise<void> {
  // An await statement queues the code that comes after it in a microtask,
  // so await Promise.resolve() does not wait for all updates to finish
  // because updating is process which involves queuing multiple microtasks.
  // In order to wait for all updates, use await updates().
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    })
  })
}

export {
  reactive,
  isReactive,
  fromPromise,
  hasDependent,
  getDependents,
  getCreationContext,
  setConstraintRecorder,
  setConstraintTrace,
  getRootRecomputeContext,
  getNearestCreateContext,
  updates
}
