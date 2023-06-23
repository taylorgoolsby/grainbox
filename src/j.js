import {
  reactive as r,
  getNearestCreateContext,
  getRootRecomputeContext,
} from './reactive.mjs'

// todo:
// If you have:
/*
  r(() => {
    console.log(JSON.stringify(unbox()))
  })
* */
// This makes sense because in order to stringify, it should be
// traversing the tree, calling toPrimitive along the way,
// triggering get traps. Those traps should cause registration,
// so children that change but don't propagate signal in an object
// is not a problem.

const lifecyleMethods = [
  'onconnected',
  'onmount',
  'ondisconnected',
  'onunmount',
]

function exists(value) {
  return value !== undefined && value !== null
}

function normalize(props) {
  for (const key of Object.keys(props)) {
    const lower = key.toLowerCase()
    if (lower.startsWith('on') && lower !== key) {
      props[lower] = props[key]
      delete props[key]
    }
  }
}

function isNode(el) {
  return el && el.nodeName && el.nodeType
}

/*
  j will construct an html element using document.createElement.

  It will then evaluate its children, which are functional expressions,
  in order, calling appendChild along the way.

  Any reactive variables used in the attributes/props or innerHTML space,
  inside tags or between them;
  they are all reactively connected to the final html element returned.

  So an html element is returned, but the necessary reactive listeners
  are registered so that changes in reactive variables can perform
  fine grained DOM updates.
 */
/*

childExpressions:
childExpressions is an array of functional expressions.
This is used evaluate prop expressions after passing them in, within
a context setup by j(), rather than before j() is called.

  childExpressions = [
    () => (stringProxy),
    () => (predicateProxy() ? Component(props) : null),
    () => (arr.map(renderRow))
  ]

propExpressions:
propExpressions could be a proxy, for example, r(props => <span {...props}/>) or r(props => <span {...props()}/>)
propExpressions could also be an object whose properties are proxies. For example, r(props => <span class={classProxy}/>)
Also, each value in propExpressions is a functional expression.
Like childExpressions, it is for context.

  propExpressions = {
    class: () => (classProxy),
    style: () => ({
      color: colorProxy
    }),
    onClick: () => (predicateProxy() ? handler1 : handler2)
  }
* */

const j = (tagName, _propExpressions, childExpressions) => {
  const nearestCreateContext = getNearestCreateContext()
  const rootRecomputeContext = getRootRecomputeContext()

  if (rootRecomputeContext) {
    // In this case, the j() call is being made due to a recompute:
    // either props have changed,
    // or a reactive variable was unboxed outside of a JSX child expression.

    const jObj = rootRecomputeContext.jCalls[rootRecomputeContext.jIndex]
    rootRecomputeContext.jIndex++

    jObj.returnedElement.children

    return
  } // otherwise we are in create context, so continue building brand new HTML and reactive structures:

  // todo: props may be an object or a proxy.
  //  Unbox it it is a proxy.
  const propExpressions = _propExpressions || {} // props is an object

  // Normalize props by lowercasing any key that starts with `on`.
  normalize(propExpressions)

  // If there is a ref proxy passed into the ref prop,
  // then return the unboxed element.
  const ref = propExpressions.ref
  const hasRefProxy = ref?.__isRef && ref?.__isResolved
  if (hasRefProxy) {
    // update existing element in place instead of creating a new one.
    e = ref(() => ({ noRegister: true }))()
    return e
  }

  let e

  const connectedCallbacks = [
    propExpressions['onconnected'],
    propExpressions['onmount'],
  ].filter((a) => !!a)
  const disconnectedCallbacks = [
    propExpressions['ondisconnected'],
    propExpressions['onunmount'],
  ].filter((a) => !!a)
  const hasLifecycle = connectedCallbacks.length || disconnectedCallbacks.length
  if (hasLifecycle) {
    // customElements.get(tagName) returns undefined if tagName is not custom.
    const BaseClass = customElements.get(tagName) || HTMLElement
    const LifeClass = class extends BaseClass {
      constructor() {
        super()
      }

      connectedCallback() {
        super.connectedCallback()
        connectedCallbacks.forEach((cb) => cb())
      }

      disconnectedCallback() {
        super.disconnectedCallback()
        disconnectedCallbacks.forEach((cb) => cb())
      }
    }
    customElements.define(`${tagName}--life`, LifeClass)
    e = document.createElement(`${tagName}--life`)
  } else {
    e = document.createElement(tagName)
  }

  // At this point, e should be an element, either:
  // - From a previous ref.
  //    (This already returned because no need to redefine reactive structure.)
  // - Newly created with lifecycle callbacks via web components API.
  // - Newly created.

  // Attach props to attributes and make them reactive.
  // todo:
  //  ref proxy and ref function
  //  props where the value is a function are event handlers
  //  style string and object
  //  attrs object
  //  data- attributes
  //  disabled
  //  checked
  //  class prop
  //  null or undefined prop value noop
  //  fallback e[key] = props[key]; js properties can be set through jsx props.

  function connect(key, expression, value) {
    if (key === 'ref') {
      // If this is a ref proxy, it should be unresolved because that case was
      // already checked at the beginning of the j() call.
      if (value?.__isRef) {
        function g(ty, li, op) {
          e.addEventListener(ty, li, op)
          // cleanupFuncs.push(function () {
          //   e.removeEventListener(
          //     ty,
          //     li,
          //     op,
          //   )
          // })
          // todo: cleanup
          //  When an element is removed from the DOM, it might still have
          //  references to it from the reactivity system and also event listeners.
          //  These should be removed to avoid memory leaks.
        }
        // unbox the ref proxy which is wrapped by the reactive proxy:
        const ref = value(() => ({ noRegister: true }))
        ref(e, g)
      } else if (typeof value === 'function') {
        value(e)
      }
    } else if (key === 'style') {
      if (typeof value === 'string') {
        r(() => {
          e.style.cssText = expression()
        })
      } else if (typeof value === 'object') {
        r(() => {
          // If the expression is like style={predicate() ? obj1: obj2}
          // then anytime the predicate() changes, a new set of reactions
          // need to be registered.
          const styleObj = expression()
          for (let k in styleObj) {
            r(() => {
              // styleObj[k] might be a reactive proxy
              // or a functional expression which performs unboxings.
              // This is useful if you want to use a style object,
              // but you only want individual style properties to be
              // fine-grained. Example:
              // style={{
              //   color: () => (predicate() ? 'red': 'blue'),
              //   fontSize: '1em'
              // }}
              const style =
                typeof styleObj[k] === 'function' ? styleObj[k]() : styleObj[k]
              if (exists(style)) {
                // todo: is empty string allowed?
                const match = style.match(/(.*)\W+!important\W*$/)
                if (match) {
                  e.style.setProperty(k, match[1], 'important')
                } else {
                  e.style.setProperty(k, style)
                }
              } else {
                e.style.removeProperty(k)
              }
            })
          }
        })
      } else {
        console.error('The style prop should be of type string or object.')
      }
    } else if (key === 'attrs') {
      r(() => {
        // See comments on style object for explanation on why there are
        // nested r() calls.
        const attrsObj = expression()
        for (let k in attrsObj) {
          r(() => {
            const attr =
              typeof attrsObj[k] === 'function' ? attrsObj[k]() : attrsObj[k]
            if (exists(attr)) {
              e.setAttribute(k, attr) // setting empty string is allowed.
            } else {
              e.removeAttribute(k)
            }
          })
        }
      })
    } else if (
      key.substr(0, 5) === 'data-' ||
      key === 'disabled' ||
      key === 'checked'
    ) {
      r(() => {
        const u = expression()
        if (exists(u)) {
          e.setAttribute(key, u)
        } else {
          e.removeAttribute(key)
        }
      })
    } else if (key === 'class') {
      r(() => {
        e.className = expression()
      })
    } else if (value === undefined || value === null) {
      console.warn(`${value} value for prop`, e, key)
    } else if (typeof value === 'function') {
      if (lifecyleMethods.includes(key.toLowerCase())) {
        // lifecycle methods already handled
      } else if (/^on\w+/.test(key)) {
        r(function () {
          const u = expression()
          if (this()) {
            // this() is the previous value, aka cachedValue.
            e.removeEventListener(key.substring(2).toLowerCase(), this(), false)
          }
          e.addEventListener(key.substring(2).toLowerCase(), u, false)
          return u // Need to return in order to set cachedValue.
        })
      }
    } else {
      // JS accessible properties can be set via JSX props.
      r(() => {
        // value might be a naked primitive,
        // or a resolved proxy.
        e[key] = expression()
      })
    }
  }

  // todo:
  //  props need to be functional expressions
  //  to be evaluated within the j context.
  for (const key of Object.keys(propExpressions)) {
    // propExpressions should be unboxed at the last possible moment,
    // inside the smallest fine-grained update.
    // Evaluating it now might perform reactive unbox,
    // thus connecting it to any reactive function we are currently in.

    // However, there is a need to get the output value
    // because in order to setup some of these fine-grained reactions,
    // we need to know what the output value is.
    // For example, is the ref prop a ref proxy or a regular function?
    // Or, is the style prop an object or string?

    // Passing the function into this r() will evaluate it,
    // and connect it to this r().
    // The newly created proxy will not be connected to the reactive context
    // which we are currently in.
    const expression = propExpressions[key]
    const proxy = r(expression)
    const value = proxy(() => ({ noRegister: true }))
    // Note that this r() call might perform unboxing operations.
    // This causes any reactive dependencies to hold a reference to the new proxy.
    // So this is a bit of a waste.
    // Any time the reactive dependency changes, it will recompute this proxy
    // but then the cachedValue isn't used for anything.
    // Todo: Is there another way to get the cachedValue without waste?

    if (value?.__isNullProxy) {
      // Consider:
      // style={server.data.viewer.themeStyle()}
      // Before it resolves, it is unknown if it is a string or object.
      // So connect() doesn't know which kind of reaction to setup.
      // Applying on an unresolved async proxy should return a nullProxy.

      // When it resolves, it connects.
      // Only the ref proxy connects while unresolved.
      value(() => ({
        onResolve: () => {
          connect(key, expression, value)
        },
      }))
    } else {
      connect(key, expression, value)
    }

    // if (key === 'ref' || !value?.__isProxy || value?.__isResolved) {
    //   connect(key, expression, value)
    // } else if (value?.__isProxy && !value?.__isResolved) {
    //   // This is an unresolved proxy, but not the ref proxy.
    //   // Ref proxies are unresolved before connected.
    //
    //   // Consider:
    //   // style={server.data.viewer.themeStyle()}
    //   // Before it resolves, it is unknown if it is a string or object.
    //   // So connect() doesn't know which kind of reaction to setup.
    //
    //   // When it resolves, it connects.
    //   // Only the ref proxy connects while unresolved.
    //   value(() => ({onResolve: () => {
    //     connect(key, expression, value)
    //   }}))
    // }
  }

  function getNonNullPreviousSibling(i) {
    for (let n = i - 1; n > -1; n--) {
      const sibling = childExpressions[n]
      if (isNode(sibling.cachedValue)) {
        return sibling
      }
      if (n === 0) {
        // found none
        return null
      }
    }
  }

  function updateDOM(ctx, i, prevValue, v) {
    // The value needs to be placed into the DOM.
    if (!prevValue && v !== null) {
      // initialization or
      // a conditional, like <span>{i ? '' : null}</span>
      let childElement = isNode(v) ? v : document.createTextNode(v)

      if (ctx.isInit) {
        // on init, these are appended in order.
        e.append(childElement)
      } else {
        // Find a non-null prior sibling by iterating over siblings
        // starting from the current index and decrementing,
        // checking each sibling function's cachedValue
        // until one is found to be non-null.
        // Note: sibling.cachedValue is a possible thing you can do
        // because after reactive recomputes, the return value is attached
        // to the function's .cachedValue prop.
        // This is a way to get a function's last computed value without
        // having a reference to the proxy and without registering
        // reactive listeners.
        // Todo: look into emptying text nodes instead of removing them. Might be faster.
        const sibling = getNonNullPreviousSibling(i)
        if (sibling) {
          sibling.after(childElement)
        } else {
          e.prepend(childElement)
        }
      }

      return childElement
    }

    // If the value changes due to recompute, then the DOM needs to change.
    if (prevValue && isNode(v)) {
      // v is probably an expression evaluating to a functional component
      // a conditional, like <span>{i ? <Comp1/> : <Comp2/>}</span>
      prevValue.replaceWith(v)
      return v // v is a node
    } else if (prevValue && v !== null) {
      // otherwise, v is cast to a string
      // a conditional, like <span>{i ? <Comp1/> : ''}</span>
      // prevValue is a textNode.
      prevValue.textContent = v // todo: try to set v to weird values, like a function
      return prevValue // prevValue is a text node.
    } else if (prevValue && v === null) {
      // a conditional, like <span>{i ? '' : null}</span>
      prevValue.remove()
      return null
    } else {
      return null // fallback when !prevValue && !v
    }
  }

  for (let i = 0; i < childExpressions.length; i++) {
    // Each child should be a function.
    r(function () /*: HTMLElement | null*/ {
      // Each child potentially uses reactive variables
      // so, this function recomputes due to changes in child.
      let v = childExpressions[i]()

      // if (typeof v === 'function') {
      //   v = v()
      // }

      // If child is an unresolved async proxy or a null proxy,
      // then it is treated like an empty string.
      const isUnresolvedBeam = v?.__isBeam && !v?.__isResolved
      const isNullProxy = v?.__isNullProxy === true
      if (isUnresolvedBeam || isNullProxy) {
        v = ''
      }

      if (v.__isProxy) {
        v = v()
      }

      if (Array.isArray(v)) {
        v = v.map(item => {
          isNode(item) ? item : document.createTextNode(item)
        })
      }

      // Usage of this requires that the function handles DOM updating itself:
      const prevValue /*: Node | Array<Node> | null */ = this() ?? null

      // The idea here is to handle expressions that evaluate to arrays by
      // pretending each item is an independent child expression.
      // There is a difference however between real child expressions
      // and arrays. The number of child expressions cannot change if JSX
      // declarations are deterministic.
      // However, the number of items in an array can change.
      // One way to solve this is to use pv.remove() for each item in
      // the prevValueAsArray.
      // Then we are free to call e.append() for each item in
      // the nextValueAsArray.
      // However, this means array updates are slow.
      // Suppose the only difference between the prev and next arrays were
      // just a .push(), .pop(), .shift(), or .unshift().
      // The fine-grained thing to do would be to append or remove just the
      // tail or head, leaving all other elements in the interior of the array
      // alone.
      // TODO: Speed up array changes for .push(), .pop(), .shift(), or .unshift()
      //  by setting up special traps just for these operations which will
      //  call the appropriate fine-grained update.
      //  The same technique can also be used for array insertions.
      const isPrevArray = Array.isArray(prevValue)
      const isNextArray = Array.isArray(v)
      if (isPrevArray || isNextArray) {
        if (isPrevArray) {
          for (const pv of prevValue) {
            pv.remove()
          }
        } else {
          prevValue.remove()
        }
        let sibling = getNonNullPreviousSibling(i)
        if (isNextArray) {
          // todo: All elements in v should be nodes.
          for (const nv of v) {
            if (v !== null) {
              if (!sibling) {
                e.append(nv)
              } else {
                sibling.after(nv)
              }
              // The added node is the new non-null previous sibling:
              sibling = nv
            }
          }
        } else {
          if (sibling) {
            sibling.after(v)
          } else {
            e.append(v)
          }
        }
        return v
      } else {
        updateDOM(this, i, prevValue, v)
      }
      // for (let j = 0; j < nextValueAsArray.length; j++) {
      //   const nv = nextValueAsArray[i]
      //   const pv = prevValueAsArray[i] ?? null
      //
      //   updateDOM(this, i, pv, nv)
      // }

      // // The value needs to be placed into the DOM.
      // if (!prevValue && v !== null) {
      //   // initialization or
      //   // a conditional, like <span>{i ? '' : null}</span>
      //   let childElement = isNode(v) ? v : document.createTextNode(v)
      //
      //   if (this.isInit) {
      //     // on init, these are appended in order.
      //     e.append(childElement)
      //   } else {
      //     // Find a non-null prior sibling by iterating over siblings
      //     // starting from the current index and decrementing,
      //     // checking each sibling function's cachedValue
      //     // until one is found to be non-null.
      //     // Note: sibling.cachedValue is a possible thing you can do
      //     // because after reactive recomputes, the return value is attached
      //     // to the function's .cachedValue prop.
      //     // This is a way to get a function's last computed value without
      //     // having a reference to the proxy and without registering
      //     // reactive listeners.
      //     // Todo: look into emptying text nodes instead of removing them. Might be faster.
      //     for (let n = i - 1; n > -1; n--) {
      //       const sibling = childExpressions[n]
      //       if (isNode(sibling.cachedValue)) {
      //         sibling.after(childElement)
      //         break
      //       }
      //       if (n === 0) {
      //         // found none
      //         e.prepend(childElement)
      //       }
      //     }
      //   }
      //
      //   return childElement
      // }
      //
      // // If the value changes due to recompute, then the DOM needs to change.
      // if (prevValue && isNode(v)) {
      //   // v is probably an expression evaluating to a functional component
      //   // a conditional, like <span>{i ? <Comp1/> : <Comp2/>}</span>
      //   prevValue.replaceWith(v)
      //   return v // v is a node
      // } else if (prevValue && v !== null) {
      //   // otherwise, v is cast to a string
      //   // a conditional, like <span>{i ? <Comp1/> : ''}</span>
      //   // prevValue is a textNode.
      //   prevValue.textContent = v // todo: try to set v to weird values, like a function
      //   return prevValue // prevValue is a text node.
      // } else if (prevValue && v === null) {
      //   // a conditional, like <span>{i ? '' : null}</span>
      //   prevValue.remove()
      //   return null
      // } else {
      //   return null // fallback when !prevValue && !v
      // }

      // Background info on why this function uses `this()`:
      // Inside reactive's implementation, when this function is ran due to
      // recompute, the return value is checked to see if it is an HTML element.
      // If it is, then replaceWith is used.
      // If the return value is a string, then the fastest thing to do is:
      //    e.textContent = value
      // But this only works if value is the only JS escape in the element.
      // Like this:
      // <span>
      //   {expression()}
      // </span>
      // But not like this:
      // <span>
      //   {expression1()}
      //   {expression2()}
      // </span>
      // If only expression1 changes, then calling e.textContent = value
      // would cause expression2's value to be lost.
      //
      // Instead, the value must be converted into a TextNode, then the node
      // appended to e.
      // And then, when expression1 changes, textNode.replaceWith is called,
      // or it could be detected to be a text node, and `.textContent =`
      // could be called for an optimization.
      //
      // Still, however, doing the DOM update in reactive's onChange function
      // requires that a new TextNode is created in this function because
      // the update in reactive's onChange only happens if the return value
      // of this function is a node.
      //
      // To avoid having to unnecessarily create a new TextNode,
      // DOM update handing is moved into this function instead of
      // reactive's onChange.
      // This is done by using `this()` inside of this function to get
      // the cachedValue of the reactive proxy enclosing this function.
      //
      // To use `this()`, the reactive function being wrapped must be
      // declared using the function keyword, not an array function.
    })
  }

  // Any time a j() call is made, it is registered to the nearest create context.
  if (nearestCreateContext) {
    nearestCreateContext.jCalls.push()
  }
}

export default j
