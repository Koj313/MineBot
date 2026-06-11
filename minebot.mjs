import { createBot } from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
import { plugin as pvp } from 'mineflayer-pvp'
import { loader as autoEat } from 'mineflayer-auto-eat'
import minecraftData from 'minecraft-data'

const { pathfinder, Movements, goals } = pathfinderPkg

// ================== BOT CREATION ==================
const bot = createBot({
  host: 'localhost', // Replace with port of your Minecraft server
  port: 12345, // Replace with port of your Minecraft server
  username: 'you@example.com', // Replace with your Microsoft/Minecraft email for the account you want the bot to use.
  auth: 'microsoft',
version: '1.21.11', // DO NOT CHANGE! IT IS NOT COMPATIBLE WITH OTHER VERSIONS UNLESS YOU KNOW WHAT TO UPDATE IN THE CODE!
  checkTimeoutInterval: 90000,
  hideErrors: true,
  skipValidation: true 
})

// === ERROR SUPPRESSION ===
const suppressError = (err) => {
  if (!err) return false
  const msg = (err.message || err.toString()).toLowerCase()
  return msg.includes('partialreaderror') || msg.includes('particle') || msg.includes('socketclosed') || msg.includes('physictick') || msg.includes('timeout')
}

bot.on('error', (err) => {
  if (suppressError(err)) return
  console.error('Error:', err.message || err)
})

bot.loadPlugin(pathfinder)
bot.loadPlugin(pvp)
bot.loadPlugin(autoEat)

// ================== STATE ==================
let mode = 'peace'
let targetName = null
let targetEntity = null
let mcData = null

const ATTACK_RANGE = 3
const BOW_RANGE = 15

// ================== SPAWN ==================
bot.once('spawn', () => {
  console.log('🟢 Bot successfully joined!')
  mcData = minecraftData(bot.version)
  const movements = new Movements(bot, mcData)
  movements.canDig = false 
  bot.pathfinder.setMovements(movements)

  if (bot.autoEat) {
    bot.autoEat.options = { priority: 'foodPoints', startAt: 14 }
    bot.autoEat.enableAuto()
  }
})

// ================== UPDATED CONSOLE INPUT ==================
// This version intercepts !hunt so it doesn't go to game chat
console.log('\n✅ Console active. Type "!hunt Name" to start or "exit" to quit.\n')

process.stdin.on('data', (data) => {
  const cmd = data.toString().trim()
  if (!cmd) return

  if (cmd === 'exit' || cmd === 'quit') {
    console.log('Shutting down...')
    bot.quit()
    process.exit(0)
  }

  // Intercept the hunt command locally
  if (cmd.startsWith('!hunt ')) {
    const name = cmd.split(' ')[1]
    console.log(`[Console] Local Action → Setting target to: ${name}`)
    setHunt(name) 
    return // This prevents the command from being sent to bot.chat()
  }

  if (cmd === '!peace' || cmd === '!stop') {
    setPeace()
    return
  }

  // Send anything else to server chat
  console.log(`[Console] Chat → ${cmd}`)
  bot.chat(cmd)
})

// ================== MODE CONTROL ==================
function setPeace() {
  mode = 'peace'
  targetName = null
  targetEntity = null
  bot.pvp.stop()
  bot.pathfinder.setGoal(null)
  bot.clearControlStates()
  console.log('🟢 Peace mode enabled')
}

function setHunt(name) {
  const player = bot.players[name]
  if (!player) {
    console.log(`❌ Cannot find ${name} in player list.`)
    return
  }

  mode = 'hunt'
  targetName = name
  // Note: targetEntity might be null if they are too far away
  console.log(`🔴 Hunt mode activated for: ${name}`)
}

function resolveTarget() {
  if (!targetName) return null
  return bot.players[targetName]?.entity || null
}

// ================== MAIN LOOP ==================
bot.on('physicsTick', async () => {
  if (mode !== 'hunt') return

  targetEntity = resolveTarget()

  if (!targetEntity) {
    // If we have a name but no entity, we need to find them or wait
    return 
  }

  const dist = bot.entity.position.distanceTo(targetEntity.position)

  // Trigger the PVP plugin to handle the actual movement/combat
  bot.pvp.attack(targetEntity)

  // Additional combat behaviors
  if (dist <= ATTACK_RANGE) {
    handleShield(true)
    equipBestWeapon()
    // Crit jump
    if (bot.entity.onGround) bot.setControlState('jump', true)
  } else {
    handleShield(false)
    bot.setControlState('jump', false)
    if (dist <= BOW_RANGE) await useBow(targetEntity)
  }

  handleStrafe()
  handleGapple()
})

// ================== BEHAVIORS ==================
let strafeDir = 1
setInterval(() => { strafeDir *= -1 }, 1500)

function handleStrafe() {
  bot.setControlState('left', strafeDir === 1)
  bot.setControlState('right', strafeDir === -1)
}

async function useBow(target) {
  const bow = bot.inventory.items().find(i => i.name.includes('bow'))
  if (!bow) return
  try {
    await bot.equip(bow, 'hand')
    bot.lookAt(target.position.offset(0, target.height, 0))
    bot.activateItem()
    setTimeout(() => bot.deactivateItem(), 1000)
  } catch (e) {}
}

function handleShield(on) {
  const shield = bot.inventory.items().find(i => i.name.includes('shield'))
  if (!shield) return
  if (on) {
    bot.equip(shield, 'off-hand').catch(() => {})
    bot.activateItem(true)
  } else {
    bot.deactivateItem()
  }
}

function handleGapple() {
  if (bot.health > 12) return
  const gapple = bot.inventory.items().find(i => i.name.includes('golden_apple'))
  if (gapple) {
    bot.equip(gapple, 'hand').then(() => {
      bot.activateItem()
      setTimeout(() => {
        bot.deactivateItem()
        equipBestWeapon()
      }, 1600)
    }).catch(() => {})
  }
}

function equipBestWeapon() {
  if (!mcData) return
  const weapons = bot.inventory.items().filter(i => i.name.includes('sword') || i.name.includes('axe'))
  if (!weapons.length) return
  const best = weapons.sort((a, b) => (mcData.itemsByName[b.name]?.attackDamage || 0) - (mcData.itemsByName[a.name]?.attackDamage || 0))[0]
  bot.equip(best, 'hand').catch(() => {})
}

// ================== CHAT COMMANDS (In-Game) ==================
bot.on('chat', (user, msg) => {
  if (user === bot.username) return
  const args = msg.split(' ')
  if (args[0] === '!peace') setPeace()
  if (args[0] === '!hunt' && args[1]) setHunt(args[1])
})

bot.on('login', () => console.log('✅ Logged in'))