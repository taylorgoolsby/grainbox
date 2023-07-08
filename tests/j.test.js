import test from 'boxtape'
import sinon from 'sinon'
import {JSDOM} from 'jsdom'
import {j, reactive as r, updates} from '../dist/esm/index.js'

const dom = new JSDOM()
global.document = dom.window.document
global.window = dom.window

sinon.spy(document)

test.beforeEach((t) => {
  for (const method in document) {
    if (typeof document[method] === 'function') {
      if (document[method].callCount !== undefined) {
        document[method].callCount = 0
      }
    }
  }
  for (const node of document.body.childNodes) {
    node.remove()
  }
  t.equal(dom.serialize(), '<html><head></head><body></body></html>', 'dom cleaned')
})

test('div', (t) => {
  const el = j('div', null, [])
  t.equal(el.constructor.name, 'HTMLDivElement', 'root element type')
  t.equal(document.createElement.callCount, 1, 'document.createElement call count')

  t.end()
})

test('span textContent', (t) => {
  const el = j('span', null, [() => ('hi')])
  t.equal(el.constructor.name, 'HTMLSpanElement', 'root element type')
  t.equal(document.createElement.callCount, 1, 'document.createElement call count')
  t.equal(el.textContent, 'hi', 'textContent initialized')

  t.end()
})

test('reactive textContent: change existing value', async (t) => {
  const message = r('hi')

  const el = j('span', null, [() => (message())])
  t.equal(el.constructor.name, 'HTMLSpanElement', 'root element type')
  t.equal(document.createElement.callCount, 1, 'document.createElement call count')
  t.equal(document.createTextNode.callCount, 1, 'document.createTextNode call count')
  t.equal(el.textContent, 'hi', 'textContent initialized')

  message('HI!')
  await updates()
  t.equal(el.textContent, 'HI!', 'textContent changed')
  // When the innerHTML of a node is just a string, and a string change occurs,
  // the new value is set using `textContent = newValue`, so there is no need to
  // convert the newValue into a TextNode.
  t.equal(document.createTextNode.callCount, 1, 'document.createTextNode call count')

  t.end()
})

test('reactive textContent: add value from empty', async (t) => {
  const message = r('')

  const el = j('span', null, [() => (message())])
  t.equal(el.constructor.name, 'HTMLSpanElement', 'root element type')
  t.equal(document.createElement.callCount, 1, 'document.createElement call count')
  // Setting an empty string still calls document.createTextNode
  t.equal(document.createTextNode.callCount, 1, 'document.createTextNode call count')
  t.equal(el.textContent, '', 'textContent initialized')

  message('HI!')
  await updates()
  t.equal(el.textContent, 'HI!', 'textContent changed')
  // See: reactive textContent: change existing value
  t.equal(document.createTextNode.callCount, 1, 'document.createTextNode call count')

  t.end()
})

test('reactive textContent: remove value', async (t) => {
  const message = r('hi')

  const el = j('span', null, [() => (message())])
  t.equal(el.constructor.name, 'HTMLSpanElement', 'root element type')
  t.equal(document.createElement.callCount, 1, 'document.createElement call count')
  t.equal(document.createTextNode.callCount, 1, 'document.createTextNode call count')
  t.equal(el.textContent, 'hi', 'textContent initialized')

  message('')
  await updates()
  t.equal(el.textContent, '', 'textContent changed')
  t.equal(document.createTextNode.callCount, 1, 'document.createTextNode call count')

  t.end()
})

test('reactive innerHTML: add child', async (t) => {
  /*
    <div>
      {show() ? <span/> : null}
    </div>
  * */

  const show = r(false)

  const el = j('div', null, [() => (show() ? j('span', null, []) : null)])
  t.equal(el.constructor.name, 'HTMLDivElement', 'root element type')
  t.equal(document.createElement.callCount, 1, 'document.createElement call count')
  t.equal(el.innerHTML, '', 'innerHTML initialized')

  sinon.spy(el)
  show(true)
  await updates()
  t.equal(el.innerHTML, '<span></span>', 'innerHTML changed')
  t.equal(el.prepend.callCount, 1, 'el.prepend was called')

  t.end()
})

test('reactive innerHTML: remove child', async (t) => {
  /*
    <div>
      {show() ? <span/> : null}
    </div>
  * */

  const show = r(true)
  const el = j('div', null, [() => (show() ? j('span', null, []) : null)])
  t.equal(el.constructor.name, 'HTMLDivElement', 'root element type')
  t.equal(document.createElement.callCount, 2, 'document.createElement call count')
  t.equal(el.innerHTML, '<span></span>', 'innerHTML initialized')

  const child = el.children[0]
  sinon.spy(child)

  show(false)
  await updates()
  t.equal(el.innerHTML, '', 'innerHTML changed')
  t.equal(child.remove.callCount, 1, '.remove was called')

  t.end()
})

test('reactive innerHTML: change child', async (t) => {
  /*
    <div>
      {show() ? <span/> : <div/>}
    </div>
  * */

  const show = r(false)
  const el = j('div', null, [() => (show() ? j('span', null, []) : j('div', null, []))])
  t.equal(el.constructor.name, 'HTMLDivElement', 'root element type')
  t.equal(document.createElement.callCount, 2, 'document.createElement call count')
  t.equal(el.innerHTML, '<div></div>', 'innerHTML initialized')

  const child = el.children[0]
  sinon.spy(child)

  show(true)
  await updates()
  t.equal(el.innerHTML, '<span></span>', 'innerHTML changed')
  t.equal(child.replaceWith.callCount, 1, '.replaceWith was called')

  t.end()
})

test('reactive innerHTML: multiple children', async (t) => {
  /*
    <div>
      {show1() ? <span/> : null}
      {show2() ? <div/> : null}
      {show3() ? <table/> : null}
    </div>
  * */

  const show1 = r(false)
  const show2 = r(false)
  const show3 = r(false)
  const el = j('div', null, [
    () => (show1() ? j('span', null, []) : null),
    () => (show2() ? j('div', null, []) : null),
    () => (show3() ? j('table', null, []) : null),
  ])
  t.equal(el.constructor.name, 'HTMLDivElement', 'root element type')
  t.equal(document.createElement.callCount, 1, 'document.createElement call count')
  t.equal(el.innerHTML, '', 'innerHTML initialized')

  sinon.spy(el)

  show1(true)
  await updates()
  t.equal(el.innerHTML, '<span></span>', 'innerHTML changed')
  t.equal(el.prepend.callCount, 1, 'root.prepend was called')

  const child1 = el.children[0]
  sinon.spy(child1)

  show3(true)
  await updates()
  t.equal(el.innerHTML, '<span></span><table></table>', 'innerHTML changed')
  t.equal(child1.after.callCount, 1, 'child1.after was called')

  show2(true)
  await updates()
  t.equal(el.innerHTML, '<span></span><div></div><table></table>', 'innerHTML changed')
  t.equal(child1.after.callCount, 2, 'child1.after was called')

  show1(false)
  await updates()
  t.equal(el.innerHTML, '<div></div><table></table>', 'innerHTML changed')
  t.equal(child1.remove.callCount, 1, 'child1.remove was called')

  show1(true)
  await updates()
  t.equal(el.innerHTML, '<span></span><div></div><table></table>', 'innerHTML changed')
  t.equal(el.prepend.callCount, 2, 'root.prepend was called')

  t.end()
})

test('functional components: fine-grained updates through components', async (t) => {
  /*
  const Text = r((props) => (
    <span color={props?.color() ?? 'red'}>{props.children()}</span>
  ))

  const Row = r((props) => (
    <div>
      <Text>{props.value()}</Text>
    </div>
  ))

  const predicate = r(false)
  const Page = r(() => (
    <div>
      <Row value={predicate() ? 'low' : 'high'}/>
    </div>
  ))
  * */

  const Text = sinon.spy(r((props) => (
    j('span', null, [() => (props.children())])
  ), 'r-text'))

  const Row = r((props) => (
    j('div', null, [
      () => (Text({children: () => (props.value())}))
    ])
  ), 'r-row')

  const predicate = r(false, 'r-predicate')
  const Page = r(() => (
    j('div', null, [
      () => (Row({value: () => (predicate() ? 'high' : 'low')}))
    ])
  ), 'r-page')

  document.body.append(Page())

  t.equal(dom.serialize(), '<html><head></head><body><div><div><span>low</span></div></div></body></html>', 'html before')

  predicate(true)
  await updates()

  t.equal(dom.serialize(), '<html><head></head><body><div><div><span>high</span></div></div></body></html>', 'html after')

  t.equal(Text.callCount, 1, 'update does not re-render Text')
})

