// Upstream Praxish scripts share their lexical scope, as in its browser demo.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const scope = vm.createContext({})
for (const file of ['util.js', 'db.js', 'praxish.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'praxish', file), 'utf8'), scope)
}
const { DB, Praxish } = vm.runInContext('({ DB, Praxish })', scope)
const state = Praxish.createPraxishState()
Praxish.definePractice(state, {
  id: 'exchange', roles: ['First', 'Other'],
  actions: [
    { name: 'act', conditions: ['eq Option act', 'eq Actor First', 'available'], outcomes: ['insert visible.Other'] },
    { name: 'hold', conditions: ['eq Option hold', 'eq Actor First'] },
    { name: 'respond', conditions: ['eq Option respond', 'eq Actor Other', 'visible.Actor'] },
    { name: 'check', conditions: ['eq Option check', 'eq Actor Other', 'visible.Actor'] },
  ],
})
DB.insert(state.db, 'practice.exchange.first.other')
const input = JSON.parse(fs.readFileSync(0, 'utf8'))
if (input.available) DB.insert(state.db, 'available')
const first = Praxish.getAllPossibleActions(state, 'first')
const partnerOptions = () => Praxish.getAllPossibleActions(state, 'other').map(a => a.name)
const before = partnerOptions()
const after = {}
for (const action of first) {
  const branch = structuredClone(state)
  Praxish.performAction(branch, action)
  after[action.name] = Praxish.getAllPossibleActions(branch, 'other').map(a => a.name)
}
process.stdout.write(JSON.stringify({ first: first.map(a => a.name), before, after }))
