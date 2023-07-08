
import test from 'boxtape'
import {reactive as r, updates} from '../dist/esm/index.js'

test('reactive variable: create and unbox', async (t) => {
  const count = r(0)
  t.equal(count(), 0, 'unbox')
  t.equal(count.name, 'reactive variable', 'type of proxy')
})

test('reactive variable: change', async (t) => {
  const count = r(0)
  t.equal(count(), 0, 'unbox')
  count(1)
  t.equal(count(), 1, 'unbox')
})

test('reactive function: create and unbox', async (t) => {
  const count = r(1)
  const double = r(() => (count() * 2))
  t.equal(double(), 2, 'unbox')
  t.equal(double.name, 'reactive function', 'type of proxy')
})

test('reactive function: change', async (t) => {
  const count = r(1)
  const double = r(() => (count() * 2))
  t.equal(double(), 2, 'unbox')
  count(2)

  // Since dependents are updated using microtasks,
  // await is needed to cause the current task to end
  // and resume execution after the microtasks have completed.
  await updates()

  t.equal(double(), 4, 'unbox')
})

test('update dependents using microtasks', async (t) => {
  const count = r(1)
  const double = r(() => (count() * 2))
  const triple = r(() => (count() * 3))
  t.equal(double(), 2, 'unbox')
  t.equal(triple(), 3, 'unbox')
  count(2)
  t.equal(double(), 2, 'unbox')
  t.equal(triple(), 3, 'unbox')
  await updates()
  t.equal(double(), 4, 'unbox')
  t.equal(triple(), 6, 'unbox')
})

test('reactive component: create and unbox', async (t) => {
  /*
    <Component count={0}/>
  * */
  const Component = r((props) => {
    t.equal(props.count.name, 'reactive function', 'props are reactive proxies')

    // todo: I sometimes forget that I should unbox when it is the return value.
    //  I think there might be a way to automatically unbox return values.
    return props.count()
  })
  t.equal(Component.name, 'factory', 'functional component type')

  // Usually, because of j (hyperscript replacment)
  // each prop is a functional expression, like `count: () => (0)`
  const proxy = Component({count: () => (0)})
  t.equal(proxy.name, 'reactive function', 'output of factory is a reactive function')

  const node = proxy()
  t.equal(node, 0, 'unbox')

  t.end()
})

test('reactive component: prop value instead of prop expression', async (t) => {
  // Compare this test against the previous one.

  const Component = r((props) => {
    t.equal(props.count.name, 'reactive variable', 'props are reactive proxies')
    return props.count()
  })
  t.equal(Component.name, 'factory', 'functional component type')

  const proxy = Component({count: 0})
  t.equal(proxy.name, 'reactive function', 'output of factory is a reactive function')

  const node = proxy()
  t.equal(node, 0, 'unbox')

  t.end()
})

// todo: test top-level j calls and conditionals inside of j.

// test('special apply: noRegister', async (t) => {
//   // Unbox a value without causing listener registration
//   const check = r(1)
//   const count = r(1)
//   const doubleAdd = r(() => {
//     const checkValue = check(() => ({noRegister: true}))
//     return count() * 2 + checkValue
//   })
//
//   t.equal(doubleAdd(), 3, 'unbox')
//
//   count(2)
//   await updates()
//   t.equal(doubleAdd(), 5, 'unbox')
//
//   // Since noRegister was used to get check's value,
//   // doubleAdd is not a dependent of check,
//   // so changing check's value should not cause
//   // a recompute of doubleAdd.
//   check(2)
//   await updates()
//   t.equal(doubleAdd(), 5, 'unbox')
//
//   // todo: there might be a need to manually cause doubleAdd to recompute.
//   //  This can be done by introducing another special.
//
//   t.end()
// })
