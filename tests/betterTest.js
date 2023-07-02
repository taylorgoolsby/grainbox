import { test } from 'tape'

function makeBetterTest() {
  let beforeEach
  let afterEach

  function betterTest(name, fn) {
    test(name, async (t) => {
      if (beforeEach) {
        await beforeEach()
      }
      await fn(t)
      if (afterEach) {
        await afterEach()
      }
    })
  }

  betterTest.beforeEach = (fn) => {
    beforeEach = fn
  }
  betterTest.afterEach = (fn) => {
    afterEach = fn
  }

  return betterTest
}

const betterTest = makeBetterTest()
export default betterTest
