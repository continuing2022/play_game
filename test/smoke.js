// 无头冒烟测试：用假 canvas 在 Node 里跑完整对局逻辑
// 运行：node test/smoke.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeCtx() {
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') {
        return () => ({ addColorStop() {} });
      }
      if (prop === 'measureText') return () => ({ width: 10 });
      if (typeof prop === 'symbol') return undefined;
      return () => {};
    },
    set(t, prop, v) { t[prop] = v; return true; },
    has(t, prop) { return prop in t; }
  });
}

function makeCanvas() {
  const ctx = makeCtx();
  return {
    width: 1280,
    height: 720,
    style: {},
    getContext() { return ctx; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; },
    addEventListener() {}
  };
}

const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
sandbox.location = { search: '' };
sandbox.document = { createElement: () => makeCanvas() };
sandbox.performance = { now: () => Date.now() };
sandbox.requestAnimationFrame = () => 0;
sandbox.addEventListener = () => {};
sandbox.devicePixelRatio = 2;
sandbox.innerWidth = 1280;
sandbox.innerHeight = 720;
vm.createContext(sandbox);

const files = ['util', 'audio', 'background', 'fx', 'fighter', 'ai', 'game'];
for (const f of files) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: f + '.js' });
}

const canvas = makeCanvas();
const game = new sandbox.Game(canvas);
let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}

// ---- 1. 菜单 ----
console.log('[1] 菜单');
game.render();
check('菜单渲染不崩溃', true);
game.step(1 / 60);

// ---- 2. AI 对 AI 完整一局 ----
console.log('[2] AI 对 AI 完整一局（最长 120 秒游戏时间）');
game.startMatch(0);
check('开局状态 = ready', game.state === 'ready', game.state);
let guard = 0;
let maxProj = 0;
let sawDash = false, sawUlt = false, sawDepth = false, sawHurt = false, sawLaunched = false;
let sawSub = false, sawGuard = false, sawJump = false;
while (game.state !== 'result' && guard < 60 * 130) {
  game.step(1 / 60);
  guard++;
  maxProj = Math.max(maxProj, game.projectiles.length);
  const a = game.fighters[0], b = game.fighters[1];
  if (a.state === 'dash' || b.state === 'dash') sawDash = true;
  if (a.state === 'ult' || b.state === 'ult') sawUlt = true;
  if (Math.abs(a.y - 600) > 4 || Math.abs(b.y - 624) > 4) sawDepth = true;
  if (a.state === 'jump' || b.state === 'jump') sawJump = true;
  if (a.state === 'hurt' || b.state === 'hurt') sawHurt = true;
  if (a.state === 'launched' || b.state === 'launched') sawLaunched = true;
  if (a.state === 'sub' || b.state === 'sub') sawSub = true;
  if (a.protectT > 0 || b.protectT > 0) sawGuard = true;
}
check('对局在 130 秒内进入结算', game.state === 'result', game.state + ' after ' + guard + ' steps');
check('产生了伤害', game.fighters[0].hp < 1000 || game.fighters[1].hp < 1000,
  'hp=' + game.fighters[0].hp + '/' + game.fighters[1].hp);
if (maxProj === 0) console.log('     提示：本局 AI 没放剑气（概率事件，非缺陷）');
if (!sawDash) console.log('     提示：本局 AI 没用到残影步（概率事件，非缺陷；人类输入测试会单独验证）');
check('出现过四向纵深移动', sawDepth);
check('没有出现跳跃状态', !sawJump);
check('出现过受击硬直', sawHurt);
check('有结算数据', !!game.result);
check('结算渲染不崩溃', (() => { try { game.render(); return true; } catch (e) { console.log(e.stack); return false; } })());
console.log('     比分: ' + game.fighters[0].name + ' ' + Math.ceil(game.fighters[0].hp) +
  ' hp / ' + game.fighters[1].name + ' ' + Math.ceil(game.fighters[1].hp) +
  ' hp, 用时 ' + (guard / 60).toFixed(1) + 's, 结果 winner=' + (game.result && game.result.winner) +
  ', reason=' + (game.result && game.result.reason));
if (!sawUlt) console.log('     提示：本局 AI 没有攒满内力放大招（可能正常）');
if (!sawSub) console.log('     提示：本局 AI 没用到替身术（概率事件，非缺陷）');
if (!sawGuard) console.log('     提示：本局 AI 没触发连击保护（概率事件，非缺陷；专项测试会验证）');

// ---- 3. 人类输入：普攻命中 ----
console.log('[3] 人类输入：普攻三段命中');
game.startMatch(2);
for (let i = 0; i < 100; i++) game.step(1 / 60); // 过 ready
const p1 = game.fighters[0], p2 = game.fighters[1];
p1.x = 700; p2.x = 780;
const hp0 = p2.hp;
for (let i = 0; i < 80; i++) {
  if (i % 6 === 0) game.pressed.add('KeyJ');
  game.step(1 / 60);
}
check('普攻可以打掉血', p2.hp < hp0, 'p2.hp=' + p2.hp + ' (from ' + hp0 + ')');
check('产生了连击', p1.maxCombo >= 2, 'maxCombo=' + p1.maxCombo);
game.render();

// ---- 4. 剑气 ----
console.log('[4] 剑气');
game.startMatch(2);
for (let i = 0; i < 100; i++) game.step(1 / 60);
const q1 = game.fighters[0], q2 = game.fighters[1];
q1.x = 300; q2.x = 900;
const hpB = q2.hp;
game.pressed.add('KeyK');
game.step(1 / 60);
check('剑气生成', game.projectiles.length > 0, 'count=' + game.projectiles.length);
for (let i = 0; i < 90; i++) game.step(1 / 60);
check('剑气命中扣血', q2.hp < hpB, 'p2.hp=' + q2.hp);

// ---- 5. 残影步 ----
console.log('[5] 残影步');
game.startMatch(2);
for (let i = 0; i < 100; i++) game.step(1 / 60);
const d1 = game.fighters[0], d2 = game.fighters[1];
d1.x = 500; d2.x = 700;
const hpC = d2.hp;
game.pressed.add('KeyL');
game.step(1 / 60);
check('残影步进入 dash 状态', d1.state === 'dash', d1.state);
for (let i = 0; i < 30; i++) game.step(1 / 60);
check('残影步穿身扣血', d2.hp < hpC, 'p2.hp=' + d2.hp);

// ---- 6. 万剑归宗 ----
console.log('[6] 万剑归宗');
game.startMatch(2);
for (let i = 0; i < 100; i++) game.step(1 / 60);
const u1 = game.fighters[0], u2 = game.fighters[1];
u1.meter = 100;
u1.x = 500; u2.x = 800;
const hpD = u2.hp;
game.pressed.add('KeyU');
game.step(1 / 60);
check('进入大招状态', u1.state === 'ult', u1.state);
for (let i = 0; i < 200; i++) game.step(1 / 60);
check('大招造成大量伤害', hpD - u2.hp > 250, 'damage=' + (hpD - u2.hp));
check('内力被清空', u1.meter < 100, 'meter=' + u1.meter);
game.render();

// ---- 7. 格挡 ----
console.log('[7] 格挡');
game.startMatch(2);
for (let i = 0; i < 100; i++) game.step(1 / 60);
const g1 = game.fighters[0], g2 = game.fighters[1];
g1.x = 700; g2.x = 780;
game.keys.add('ShiftRight');
for (let i = 0; i < 10; i++) game.step(1 / 60);
check('P2 进入格挡', g2.state === 'block', g2.state);
const hpE = g2.hp;
for (let i = 0; i < 60; i++) {
  if (i % 6 === 0) game.pressed.add('KeyJ');
  game.step(1 / 60);
}
game.keys.delete('ShiftRight');
check('格挡只掉少量血（可能 0）', hpE - g2.hp < 80, 'chip=' + (hpE - g2.hp));

// ---- 8. 菜单输入 ----
console.log('[8] 菜单输入');
game.toMenu();
check('回到菜单', game.state === 'menu');
game.pressed.add('Digit2');
game.step(1 / 60);
check('按 2 进入双人模式', game.state === 'ready' && game.mode === 2, game.state + ' mode=' + game.mode);

// ---- 9. 技能栏：冷却 / 内力 ----
console.log('[9] 技能栏数据');
game.startMatch(2);
for (let i = 0; i < 100; i++) game.step(1 / 60);
const s1 = game.fighters[0], s2 = game.fighters[1];
let rows = game.skillRows(s1);
check('技能栏五项齐全（连斩/剑气/残影步/万剑归宗/替身术）',
  rows.map(r => r.id).join(',') === 'atk,proj,dash,ult,sub', rows.map(r => r.id).join(','));
check('开局攻击/剑气/残影步就绪', rows[0].ready && rows[1].ready && rows[2].ready);
check('开局内力为空 → 万剑归宗未就绪', rows[3].ready === false && rows[3].ratio === 0,
  'ratio=' + rows[3].ratio);
check('开局内力为空 → 替身未就绪且标价 20', rows[4].ready === false && rows[4].cost === 20,
  'ready=' + rows[4].ready + ' cost=' + rows[4].cost);
s1.x = 300; s2.x = 900;
game.pressed.add('KeyK');
game.step(1 / 60);
rows = game.skillRows(s1);
check('剑气使用后进入冷却', !rows[1].ready && rows[1].cd > 2, 'cd=' + rows[1].cd);
check('冷却进度从 0 开始', rows[1].ratio < 0.1, 'ratio=' + rows[1].ratio);
check('技能栏高亮刚施放的技能', rows[1].active === true);
for (let i = 0; i < 30; i++) game.step(1 / 60);
rows = game.skillRows(s1);
check('冷却随时间恢复', rows[1].cd < 2.2 && rows[1].ratio > 0.1,
  'cd=' + rows[1].cd.toFixed(2) + ' ratio=' + rows[1].ratio.toFixed(2));
s1.meter = 100;
rows = game.skillRows(s1);
check('内力满 → 万剑归宗就绪', rows[3].ready === true && rows[3].ratio === 1);
check('内力满且冷却好 → 替身就绪', rows[4].ready === true && rows[4].ratio === 1);
game.render();

// ---- 10. 出招方向跟随操作方向 ----
console.log('[10] 出招方向跟随方向键');
game.startMatch(2);
for (let i = 0; i < 100; i++) game.step(1 / 60);
const a1 = game.fighters[0], a2 = game.fighters[1];
a1.x = 640; a2.x = 980;
game.keys.add('KeyA'); // 按住左
game.pressed.add('KeyK');
game.step(1 / 60);
check('按住 A 时朝向变左', a1.facing === -1, 'facing=' + a1.facing);
check('剑气朝左生成', game.projectiles.length > 0 && game.projectiles[0].dir === -1,
  JSON.stringify(game.projectiles.map(p => p.dir)));
const px0 = game.projectiles[0].x;
for (let i = 0; i < 10; i++) game.step(1 / 60);
check('剑气向左飞行', game.projectiles.length === 0 || game.projectiles[0].x < px0,
  'x: ' + px0 + ' -> ' + (game.projectiles[0] && game.projectiles[0].x));
game.keys.delete('KeyA');

game.startMatch(2);
for (let i = 0; i < 100; i++) game.step(1 / 60);
const b1 = game.fighters[0];
b1.x = 640; game.fighters[1].x = 980;
const bx = b1.x;
game.keys.add('KeyA');
game.pressed.add('KeyL');
game.step(1 / 60);
check('残影步朝左冲刺（vx < 0）', b1.state === 'dash' && b1.vx < 0,
  'state=' + b1.state + ' vx=' + b1.vx);
game.step(1 / 60);
check('残影步向左位移', b1.x < bx, 'x: ' + bx + ' -> ' + b1.x);
game.keys.delete('KeyA');

game.startMatch(2);
for (let i = 0; i < 100; i++) game.step(1 / 60);
const c1 = game.fighters[0], c2 = game.fighters[1];
c1.x = 700; c2.x = 900;
game.keys.add('KeyA');
game.pressed.add('KeyJ');
game.step(1 / 60);
const hb = c1.atk && c1.hitbox(c1.atk.def);
check('按住 A 普攻朝左出招', c1.facing === -1 && hb && hb.x + hb.w <= c1.x,
  'facing=' + c1.facing + ' hitboxRight=' + (hb && hb.x + hb.w) + ' x=' + c1.x);
const c2hp = c2.hp;
for (let i = 0; i < 40; i++) game.step(1 / 60);
check('朝左出招打不到右侧的对手', c2.hp === c2hp, 'p2.hp=' + c2.hp + ' (from ' + c2hp + ')');
game.keys.delete('KeyA');
for (let i = 0; i < 40; i++) game.step(1 / 60);
check('松开方向键后自动面向对手', c1.facing === 1, 'facing=' + c1.facing);

// ---- 10.5 四向移动 / 纵深判定 ----
console.log('[10.5] 四向移动 / 纵深判定');
game.startMatch(2);
for (let i = 0; i < 100; i++) game.step(1 / 60);
const m1 = game.fighters[0], m2 = game.fighters[1];
m1.x = 520; m1.y = 600; m2.x = 1000; m2.y = 600;

let y0 = m1.y;
game.keys.add('KeyW');
for (let i = 0; i < 24; i++) game.step(1 / 60);
check('W 向远处移动（纵深减小）', m1.y < y0 - 10, 'y: ' + y0 + ' -> ' + m1.y.toFixed(1));
check('W 不再是跳跃', m1.state !== 'jump' && m1.state !== 'air', 'state=' + m1.state);
game.keys.delete('KeyW');

y0 = m1.y;
game.keys.add('KeyS');
for (let i = 0; i < 24; i++) game.step(1 / 60);
check('S 向镜头移动（纵深增大）', m1.y > y0 + 10, 'y: ' + y0.toFixed(1) + ' -> ' + m1.y.toFixed(1));
game.keys.delete('KeyS');

const mx0 = m1.x;
game.keys.add('KeyA');
for (let i = 0; i < 24; i++) game.step(1 / 60);
check('A 向左移动', m1.x < mx0 - 10, 'x: ' + mx0 + ' -> ' + m1.x.toFixed(1));
game.keys.delete('KeyA');

m1.y = sandbox.U.DEPTH_MIN + 2;
game.keys.add('KeyW');
for (let i = 0; i < 30; i++) game.step(1 / 60);
check('纵深后边界钳制', Math.abs(m1.y - sandbox.U.DEPTH_MIN) < 0.01, 'y=' + m1.y);
game.keys.delete('KeyW');
m1.y = sandbox.U.DEPTH_MAX - 2;
game.keys.add('KeyS');
for (let i = 0; i < 30; i++) game.step(1 / 60);
check('纵深前边界钳制', Math.abs(m1.y - sandbox.U.DEPTH_MAX) < 0.01, 'y=' + m1.y);
game.keys.delete('KeyS');

// 前后错开超过判定阈值时，近身攻击应该落空
game.startMatch(2);
for (let i = 0; i < 100; i++) game.step(1 / 60);
const k1 = game.fighters[0], k2 = game.fighters[1];
k1.x = 700; k2.x = 780; k1.y = 540; k2.y = 640;
k1.facing = 1; k2.facing = -1;
const depthHp = k2.hp;
for (let i = 0; i < 50; i++) {
  if (i % 8 === 0) game.pressed.add('KeyJ');
  game.step(1 / 60);
}
check('纵深错开时普攻落空', k2.hp === depthHp, 'hp=' + k2.hp + ' (from ' + depthHp + ')');

// ---- 11. 替身术：被击打时唯一的脱身手段 ----
console.log('[11] 替身术');
game.startMatch(2);
for (let i = 0; i < 100; i++) game.step(1 / 60);
const t1 = game.fighters[0], t2 = game.fighters[1];
t1.x = 700; t2.x = 820; t1.facing = 1; t2.facing = -1;
t1.meter = 100;
t1.state = 'hurt'; t1.hurtT = 0.8; t1.atk = null;
game.pressed.add('KeyJ');
game.step(1 / 60);
check('受击硬直中按 J 无法出招（只能替身）', t1.state === 'hurt' && !t1.atk,
  'state=' + t1.state + ' atk=' + !!t1.atk);

const subX0 = t1.x;
const subM0 = t1.meter;
game.pressed.add('KeyI');
game.step(1 / 60);
check('被击打时按 I 成功替身', t1.state === 'sub', t1.state);
check('替身消耗 20 内力', subM0 - t1.meter === sandbox.SUB.cost, 'meter=' + t1.meter);
check('替身进入冷却', t1.subCd > sandbox.SUB.cd - 0.1, 'subCd=' + t1.subCd.toFixed(2));
check('替身瞬间无敌', t1.invuln > 0, 'invuln=' + t1.invuln);
check('瞬身到对手背后', Math.abs(t1.x - subX0) > 60, 'x: ' + subX0 + ' -> ' + t1.x);
check('原地留下木桩', game.decoys.length === 1, 'decoys=' + game.decoys.length);
check('替身次数 +1', t1.subCount === 1, 'subCount=' + t1.subCount);

t1.state = 'hurt'; t1.hurtT = 0.6; t1.meter = 100;
game.pressed.add('KeyI');
game.step(1 / 60);
check('冷却中无法连续替身', t1.state === 'hurt', t1.state);
t1.subCd = 0; t1.meter = 10; t1.state = 'hurt'; t1.hurtT = 0.6;
game.pressed.add('KeyI');
game.step(1 / 60);
check('内力不足时无法替身', t1.state === 'hurt', t1.state);
t1.meter = 100; t1.state = 'idle'; t1.subCd = 0;
const subCountBefore = t1.subCount;
game.pressed.add('KeyI');
game.step(1 / 60);
check('非受击状态按 I 不会替身', t1.state !== 'sub' && t1.subCount === subCountBefore,
  'state=' + t1.state);

t1.state = 'launched'; t1.hurtT = 0.8; t1.vy = 0; t1.y = 560;
t1.meter = 100; t1.subCd = 0;
game.pressed.add('KeyI');
game.step(1 / 60);
check('被击倒时也能替身换位', t1.state === 'sub' && Math.abs(t1.y - t2.y) < 1,
  'state=' + t1.state + ' y=' + t1.y + ' oppY=' + t2.y);
for (let i = 0; i < 90; i++) game.step(1 / 60);
check('替身动作结束后恢复操作', t1.state !== 'sub' && t1.state !== 'hurt', t1.state);
check('木桩 1 秒后消失', game.decoys.length === 0, 'decoys=' + game.decoys.length);
game.render();

// ---- 12. 连击保护：连续被打 1.5 秒自动挣脱 ----
console.log('[12] 连击保护');
game.startMatch(2);
for (let i = 0; i < 100; i++) game.step(1 / 60);
const v1 = game.fighters[0], v2 = game.fighters[1];
v1.x = 640; v2.x = 735;
let guarded = false, guardHp = 0, guardHpAfter = 0, guardCombo = 0;
for (let i = 0; i < 190; i++) {
  if (i % 9 === 0 && v2.protectT <= 0) {
    game.resolveHit(v1, v2, sandbox.ATTACKS.a1, 'melee', { x: v2.x, y: v2.y - 100, w: 1, h: 1 });
  }
  game.step(1 / 60);
  if (!guarded && v2.protectT > 0) {
    guarded = true;
    guardHp = v2.hp;
    game.resolveHit(v1, v2, sandbox.ATTACKS.a1, 'melee', { x: v2.x, y: v2.y - 100, w: 1, h: 1 });
    guardHpAfter = v2.hp;
    guardCombo = v1.combo;
  }
}
check('连续受击超过 1.5s 触发连击保护', guarded, 'protectT=' + v2.protectT);
check('保护期间无法被击中', guardHpAfter === guardHp, guardHp + ' -> ' + guardHpAfter);
check('连击被中断', guardCombo === 0, 'combo=' + guardCombo);
check('保护结束后仍能正常对局', v2.hp > 0 && v2.hp < 1000, 'hp=' + v2.hp);
game.render();

game.startMatch(2);
for (let i = 0; i < 100; i++) game.step(1 / 60);
const w1 = game.fighters[0], w2 = game.fighters[1];
w1.x = 640; w2.x = 735;
game.resolveHit(w1, w2, sandbox.ATTACKS.a1, 'melee', { x: w2.x, y: w2.y - 100, w: 1, h: 1 });
for (let i = 0; i < 90; i++) game.step(1 / 60);
check('单次受击不会触发连击保护', w2.protectT === 0, 'protectT=' + w2.protectT);
check('间隔超时后连续计时清零', w2.comboLockT === 0, 'comboLockT=' + w2.comboLockT);

// ---- 13. 自检场景 ----
console.log('[13] 自检场景');
game.paused = false;
game.setupSubScene();
check('替身场景可定格', game.paused === true && game.decoys.length > 0,
  'paused=' + game.paused + ' decoys=' + game.decoys.length);
game.paused = false;
game.setupGuardScene();
const gv = game.fighters[1];
check('连击保护场景可定格', game.paused === true && gv.protectT > 0, 'protectT=' + gv.protectT);
game.render();

console.log(failures === 0 ? '\n全部通过 ✅' : '\n有 ' + failures + ' 项失败 ❌');
process.exit(failures === 0 ? 0 : 1);
