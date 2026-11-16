// Praxish 727d92511257ca1e5714b7027ba4e0c558568516, MIT, see docs/licenses/praxish.txt.
// Only upstream program text enters the VM. All author input is passed as data.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ctx = vm.createContext({console})
for (const file of ['util.js', 'db.js', 'praxish.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'praxish', file), 'utf8'), ctx)
}
const {Praxish, DB} = vm.runInContext('({Praxish, DB})', ctx)
const {priority, witness, previous = 0, pressure = 0} = JSON.parse(fs.readFileSync(0, 'utf8'))
const tension = Math.min(2, Math.max(0, previous / 2 + pressure))
const state = Praxish.createPraxishState()
const options = [
  {name:'act', conditions:['eq Actor Owner'], outcomes:['insert progress.yes', 'insert exposed.yes']},
  {name:'pause', conditions:['eq Actor Owner'], outcomes:['insert protected.yes']},
  {name:'ask', conditions:['eq Actor Owner', 'present.other'], outcomes:['insert informed.yes', 'insert observed.other']},
]
Praxish.definePractice(state, {id:'choice', roles:['Owner'], actions:options})
DB.insert(state.db, 'practice.choice.self')
if (witness) DB.insert(state.db, 'present.other')
const weights = {
  progress: priority === 'goal' ? 4 : 1,
  protected: priority === 'protect' || (priority === 'understand' && !witness) ? 4 : 1,
  informed: priority === 'understand' ? 4 : 1,
  exposed: -2 * tension,
}
const ranked = options.flatMap(option => {
  // Upstream annotates mutable binding objects; enumerate each action independently.
  state.practiceDefs.choice.actions = [option]
  const [action] = Praxish.getAllPossibleActions(state, 'self')
  if (!action) return []
  const trial = {...state, db:structuredClone(state.db)}
  Praxish.performAction(trial, action)
  let value = 0
  for (const [effect, weight] of Object.entries(weights))
    if (Praxish.query(trial.db, [effect+'.yes'], {}).length) value += weight
  return [{action:action.name, score:value}]
}).sort((a,b)=>b.score-a.score)
process.stdout.write(JSON.stringify({ranked,tension}))
