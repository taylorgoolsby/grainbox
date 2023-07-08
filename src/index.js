// @flow
import { reactive as _reactive, updates as _updates } from './reactive.js'
import { history as _history } from './history.js'
import { registerRoute as _registerRoute } from './routing.js'
import { default as _html } from './html-tag.js'
import { default as _h } from './grainbox-hyperscript.js'
import { beam as _beam } from './beam.js'
import { ref as _ref } from './ref.js'
import {constraint as _constraint} from './constraint.js'
import {nullProxy as _nullProxy} from './nullProxy.js'
import {j as _j} from './j.js'

export const reactive = _reactive
export const updates = _updates
export const history = _history
export const registerRoute = _registerRoute
export const html = _html
export const h = _h
export const beam = _beam
export const ref = _ref
export const constraint = _constraint
export const nullProxy = _nullProxy
export const j = _j

export default {
  reactive,
  updates,
  history,
  registerRoute,
  html,
  h,
  beam,
  ref,
  constraint,
  nullProxy,
  j
}
