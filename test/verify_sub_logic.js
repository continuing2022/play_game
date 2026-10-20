// 独立验证：替身术 / 连击保护（只读 game 实例，不修改 js/ 源码）
// 运行：node test/verify_sub_logic.js
//
// 说明：项目正在被外部会话重构为「纵深 2.5D」（y 由“高度”改为“纵深”），
// 所以本脚本不把 y 写死为 612，凡涉及 y 的断言统一用「场地纵深范围」判定。
// 分组输出，便于区分：替身/连击保护本体 vs 边界/回归。
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---------------- 无头 canvas（同时记录 fillText，用于 UI 文案断言） ----------------
function makeCtx() {
  const target = { texts: [] };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'fillText') return (s) => { t.texts.push(String(s)); };
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

const FILES = ['util', 'audio', 'background', 'fx', 'fighter', 'ai', 'game'];
for (const f of FILES) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: f + '.js' });
}
// 记录加载时的文件签名，结束时再取一次，用于发现「运行期间源码被外部改写」
const sigAtStart = fileSig();

const U = sandbox.U;
const SUB = sandbox.SUB;
const CG = sandbox.COMBO_GUARD;
const A = sandbox.ATTACKS;
const canvas = makeCanvas();
const gctx = canvas.getContext('2d');
const game = new sandbox.Game(canvas);

// ---------------- 断言框架 ----------------
const groups = [];
let current = null;
function group(name, fn) {
  current = { name, checks: [], notes: [], error: null };
  groups.push(current);
  try { fn(); } catch (e) { current.error = e; }
}
function check(name, cond, extra) {
  current.checks.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) });
}
function note(text) { current.notes.push(String(text)); }

// ---------------- 通用工具（兼容 y=高度 / y=纵深 两种语义） ----------------
const DEPTH_MIN = typeof U.DEPTH_MIN === 'number' ? U.DEPTH_MIN : 0;
const DEPTH_MAX = typeof U.DEPTH_MAX === 'number' ? U.DEPTH_MAX : U.H;
const FIELD_LEFT = 70;             // integrate/separate 的场地夹取范围
const FIELD_RIGHT = U.W - 70;
function inDepth(v) {
  return typeof v === 'number' && Number.isFinite(v) &&
    v >= DEPTH_MIN - 1e-6 && v <= DEPTH_MAX + 1e-6;
}
function inFieldX(v) {
  return typeof v === 'number' && Number.isFinite(v) &&
    v >= FIELD_LEFT - 1e-6 && v <= FIELD_RIGHT + 1e-6;
}
function finiteAll(arr) { return arr.every((v) => typeof v === 'number' && Number.isFinite(v)); }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

function freshFight(mode) {
  game.paused = false;
  game.keys.clear();
  game.pressed.clear();
  game.startMatch(mode === undefined ? 2 : mode);
  for (let i = 0; i < 200 && game.state !== 'fight'; i++) game.step(1 / 60);
  return [game.fighters[0], game.fighters[1]];
}
function steps(n) { for (let i = 0; i < n; i++) game.step(1 / 60); }
function pressStep(code) { game.pressed.add(code); game.step(1 / 60); }
function hit(att, tgt, def) {
  game.resolveHit(att, tgt, def || A.a1, 'melee', { x: tgt.x, y: tgt.y - 100, w: 1, h: 1 });
}
function makeHurt(f, t) {
  f.state = 'hurt';
  f.hurtT = t === undefined ? 0.9 : t;
  f.hurtWindowT = 0;
  f.comboLockT = 0;
  f.atk = null;
  f.vx = 0;
  f.vy = 0;
}
function renderInspect() {
  gctx.texts.length = 0;
  game.render();
  return gctx.texts.slice();
}
function renderNoThrow(label) {
  try { game.render(); check(label, true); }
  catch (e) { check(label, false, (e && e.stack) || String(e)); }
}

// ================================================================
// a. 替身仅在被击打状态可用
// ================================================================
group('a. 替身可用状态限定（idle/block/attack/对手大招/roundOver/受击时其它输入无效）', () => {
  {
    const [a] = freshFight();
    a.meter = 100; a.subCd = 0;
    const c0 = a.subCount, m0 = a.meter;
    pressStep('KeyI');
    check('idle 状态按 I 不替身', a.state !== 'sub' && a.subCount === c0, 'state=' + a.state);
    check('idle 失败不扣内力/不进冷却', a.meter === m0 && a.subCd === 0, 'meter=' + a.meter + ' subCd=' + a.subCd);
    check('idle 失败不产生木桩', game.decoys.length === 0, 'decoys=' + game.decoys.length);
  }
  {
    const [a] = freshFight();
    a.meter = 100; a.subCd = 0;
    a.state = 'block';
    pressStep('KeyI');
    check('block 状态按 I 不替身', a.state !== 'sub' && a.subCount === 0, 'state=' + a.state);
  }
  {
    const [a] = freshFight();
    a.meter = 100; a.subCd = 0;
    a.startAttack('a1');
    pressStep('KeyI');
    check('attack 状态按 I 不替身', a.state !== 'sub' && a.subCount === 0, 'state=' + a.state);
  }
  {
    const [a, b] = freshFight();
    b.meter = 100; b.startUlt();
    makeHurt(a);
    a.meter = 100; a.subCd = 0;
    pressStep('KeyI');
    check('对手 state=ult 时不可替身', b.state === 'ult' && a.state !== 'sub' && a.subCount === 0,
      'self=' + a.state + ' opp=' + b.state);
  }
  {
    const [a] = freshFight();
    makeHurt(a);
    a.meter = 100; a.subCd = 0;
    game.roundOver = true;
    pressStep('KeyI');
    check('roundOver 后不可替身', a.state !== 'sub' && a.subCount === 0, 'state=' + a.state);
    game.roundOver = false;
  }
  {
    const [a] = freshFight();
    makeHurt(a);
    a.meter = 100; a.projCd = 0; a.dashCd = 0;
    const x0 = a.x;
    game.keys.add('KeyD');
    ['KeyJ', 'KeyK', 'KeyL', 'KeyU'].forEach((k) => game.pressed.add(k));
    game.step(1 / 60);
    game.keys.delete('KeyD');
    check('受击硬直中按攻击/剑气/残影步/大招全部无效',
      a.state === 'hurt' && !a.atk && game.projectiles.length === 0 && a.dashCd === 0 && a.meter === 100,
      'state=' + a.state + ' atk=' + !!a.atk + ' proj=' + game.projectiles.length +
      ' dashCd=' + a.dashCd + ' meter=' + a.meter);
    check('受击硬直中方向键不产生位移', Math.abs(a.x - x0) < 1e-6, 'x: ' + x0 + ' -> ' + a.x);
  }
  {
    // P2 键位（N）同样可用
    const [a, b] = freshFight();
    b.x = 700; a.x = 820; a.facing = -1; b.facing = 1;
    b.meter = 100; b.subCd = 0;
    makeHurt(b);
    pressStep('KeyN');
    check('P2 键位 N 在受击时可替身', b.state === 'sub' && b.meter === 80,
      'state=' + b.state + ' meter=' + b.meter);
  }
});

// ================================================================
// b. 资源判定 + 成功时数值 + 木桩生命周期 + 落地/纵深
// ================================================================
group('b. 内力/冷却门槛、成功后数值、木桩生命周期、被击飞时替身', () => {
  {
    const [a, b] = freshFight();
    b.x = 820; b.facing = -1;
    makeHurt(a);
    a.meter = SUB.cost - 1; a.subCd = 0;
    pressStep('KeyI');
    check('内力 < 20 时不可替身', a.state === 'hurt' && a.subCount === 0 && a.meter === SUB.cost - 1,
      'state=' + a.state + ' meter=' + a.meter);
  }
  {
    const [a] = freshFight();
    makeHurt(a);
    a.meter = 100; a.subCd = 1;
    pressStep('KeyI');
    check('冷却中不可替身', a.state === 'hurt' && a.subCount === 0, 'state=' + a.state + ' subCd=' + a.subCd);
  }
  {
    const [a, b] = freshFight();
    a.x = 700; b.x = 820; a.facing = 1; b.facing = -1;
    a.y = 600; b.y = 624;
    makeHurt(a);
    a.meter = 100; a.subCd = 0;
    const oldX = a.x;
    const expectX = clamp(b.x - b.facing * SUB.dist, 92, U.W - 92);
    const expectY = clamp(b.y, DEPTH_MIN, DEPTH_MAX);
    pressStep('KeyI');
    check('受击时按 I 进入 sub 状态', a.state === 'sub', 'state=' + a.state);
    check('内力正好扣 ' + SUB.cost, a.meter === 100 - SUB.cost, 'meter=' + a.meter);
    check('subCd≈' + SUB.cd + 's', a.subCd > SUB.cd - 0.05 && a.subCd <= SUB.cd + 1e-6, 'subCd=' + a.subCd.toFixed(4));
    check('subCount +1', a.subCount === 1, 'subCount=' + a.subCount);
    check('获得无敌 invuln>0', a.invuln > 0, 'invuln=' + a.invuln.toFixed(3));
    check('瞬身位移 > 60px', Math.abs(a.x - oldX) > 60, 'x: ' + oldX + ' -> ' + a.x);
    check('瞬身目标 = 对手背后 ' + SUB.dist + 'px（未分离前）',
      Math.abs(a.x - expectX) < 1e-6, 'x=' + a.x + ' expect=' + expectX);
    check('瞬身后 x 在场地内', inFieldX(a.x), 'x=' + a.x + ' field=[' + FIELD_LEFT + ',' + FIELD_RIGHT + ']');
    check('瞬身后 y 在场地纵深范围内', inDepth(a.y), 'y=' + a.y + ' depth=[' + DEPTH_MIN + ',' + DEPTH_MAX + ']');
    check('瞬身与对手同纵深（被击飞后不会落后半空）', Math.abs(a.y - expectY) < 1e-6,
      'y=' + a.y + ' expect=' + expectY);
    check('瞬身后朝向对手', a.facing === (b.x >= a.x ? 1 : -1), 'facing=' + a.facing);
    check('原地留下 1 个木桩', game.decoys.length === 1, 'decoys=' + game.decoys.length);
    const d = game.decoys[0] || {};
    check('木桩在旧位置生成', d.x === oldX, 'decoy.x=' + d.x + ' oldX=' + oldX);
    check('木桩 y 在场地纵深范围内', inDepth(d.y), 'decoy.y=' + d.y);
    check('木桩寿命 1s 配置', d.life === 1, 'life=' + d.life);
    steps(55);
    check('0.9s 时木桩仍在', game.decoys.length === 1, 'decoys=' + game.decoys.length);
    steps(10);
    check('1s 后木桩消失', game.decoys.length === 0, 'decoys=' + game.decoys.length);
  }
  {
    // sub 期间其它输入无效；0.2s 后恢复操作
    const [a, b] = freshFight();
    b.x = 820; b.facing = -1;
    a.x = 700; a.y = 600; b.y = 600;
    makeHurt(a);
    a.meter = 100; a.subCd = 0;
    pressStep('KeyI');
    check('sub 状态成立（前置）', a.state === 'sub');
    for (let i = 0; i < 3; i++) { game.pressed.add('KeyJ'); game.step(1 / 60); }
    check('sub 期间按攻击无效', a.state === 'sub' && !a.atk, 'state=' + a.state + ' atk=' + !!a.atk);
    // 注意：替身触发 0.045s 全局 hitstop，会冻结若干帧，因此这里多给几帧再判断
    steps(25);
    check('约 0.2s 后退出 sub、恢复可操作', a.state === 'idle', 'state=' + a.state);
    pressStep('KeyJ');
    check('恢复后可正常出招', a.state === 'attack', 'state=' + a.state);
  }
  {
    // 被击飞/击倒时替身：y 不再等于高度，断言「与对手同纵深 + 在纵深范围内」
    const [a, b] = freshFight();
    a.x = 700; b.x = 850; b.facing = -1;
    a.y = DEPTH_MIN + 12; b.y = DEPTH_MAX - 10;
    a.state = 'launched'; a.hurtT = 0.5; a.vy = 0; a.vx = 150;
    a.meter = 100; a.subCd = 0;
    const oldX = a.x;
    pressStep('KeyI');
    check('launched 状态可替身', a.state === 'sub', 'state=' + a.state);
    check('击飞中替身后 y 被夹回场地纵深范围', inDepth(a.y), 'y=' + a.y);
    check('击飞中替身后落到对手纵深', Math.abs(a.y - clamp(b.y, DEPTH_MIN, DEPTH_MAX)) < 1e-6,
      'y=' + a.y + ' opp.y=' + b.y);
    check('击飞中替身后位移 > 60px', Math.abs(a.x - oldX) > 60, 'x: ' + oldX + ' -> ' + a.x);
    steps(30);
    check('替身结束后回到可操作状态', a.state !== 'sub' && a.state !== 'hurt' && a.state !== 'launched',
      'state=' + a.state);
    check('替身结束后 y 仍在纵深范围内', inDepth(a.y), 'y=' + a.y);
  }
  {
    // down（倒地）状态可替身
    const [a, b] = freshFight();
    b.x = 800; b.facing = -1;
    a.x = 680; a.y = 600; b.y = 600;
    a.state = 'down'; a.stateT = 0.4;
    a.meter = 100; a.subCd = 0;
    pressStep('KeyI');
    check('down（倒地）状态可替身', a.state === 'sub', 'state=' + a.state);
  }
  {
    // 边界：内力恰好 20 可以替身，扣完归 0
    const [a, b] = freshFight();
    b.x = 820; b.facing = -1;
    makeHurt(a);
    a.meter = 20; a.subCd = 0;
    pressStep('KeyI');
    check('内力恰好 20 可以替身且扣完归 0', a.state === 'sub' && a.meter === 0, 'state=' + a.state + ' meter=' + a.meter);
  }
  {
    // 冷却边界：subCd 恰好 0 可替身
    const [a, b] = freshFight();
    b.x = 820; b.facing = -1;
    makeHurt(a);
    a.meter = 100; a.subCd = 0;
    pressStep('KeyI');
    check('subCd 恰好 0 可替身', a.state === 'sub', 'state=' + a.state);
  }
});

// ================================================================
// c. 替身无敌：近战 / 剑气 / 残影步穿身都不能造成伤害
// ================================================================
group('c. 替身无敌期间免疫近战 / 剑气 / 残影步', () => {
  function subFirst() {
    const [a, b] = freshFight();
    a.x = 700; b.x = 820; a.facing = 1; b.facing = -1;
    a.y = 600; b.y = 600;
    makeHurt(a);
    a.meter = 100; a.subCd = 0;
    pressStep('KeyI');
    return [a, b];
  }
  {
    const [a, b] = subFirst();
    const hp0 = a.hp;
    hit(b, a);
    check('无敌期间近战 resolveHit 不掉血', a.hp === hp0, 'hp: ' + hp0 + ' -> ' + a.hp);
    check('无敌期间近战不使目标进入受击状态', a.state !== 'hurt' && a.state !== 'launched', 'state=' + a.state);
    check('无敌期间近战不增加攻击方连击数', b.combo === 0, 'att.combo=' + b.combo);
  }
  {
    const [a, b] = subFirst();
    const hp0 = a.hp;
    b.x = a.x - 200; b.facing = 1; b.y = a.y; b.projCd = 0;
    b.fireProjectile();
    check('剑气已生成（前置）', game.projectiles.length === 1, 'proj=' + game.projectiles.length);
    let sawHurt = false;
    for (let i = 0; i < 50; i++) {
      game.step(1 / 60);
      if (a.state === 'hurt' || a.state === 'launched') sawHurt = true;
    }
    check('无敌期间剑气不掉血', a.hp === hp0, 'hp: ' + hp0 + ' -> ' + a.hp);
    check('无敌期间剑气不造成受击', sawHurt === false, 'sawHurt=' + sawHurt);
  }
  {
    const [a, b] = subFirst();
    const hp0 = a.hp;
    b.x = a.x - 150; b.facing = 1; b.y = a.y; b.dashCd = 0;
    b.startDash();
    steps(20);
    check('无敌期间残影步穿身不掉血', a.hp === hp0, 'hp: ' + hp0 + ' -> ' + a.hp);
    check('无敌期间残影步穿身不造成受击', a.state !== 'hurt' && a.state !== 'launched', 'state=' + a.state);
    check('残影步没有判定命中（dashHit=false）', b.dashHit === false, 'dashHit=' + b.dashHit);
  }
  {
    // 对照组：无敌结束后同样的 resolveHit 会掉血（证明测试真的打得到人）
    const [a, b] = freshFight();
    a.x = 700; b.x = 820; b.facing = -1;
    a.y = 600; b.y = 600;
    makeHurt(a); a.meter = 100; a.subCd = 0;
    pressStep('KeyI');
    for (let i = 0; i < 60 && a.invuln > 0; i++) game.step(1 / 60);
    check('无敌已过期（前置）', a.invuln <= 0, 'invuln=' + a.invuln);
    const hp0 = a.hp;
    hit(b, a);
    check('无敌结束后的近战可以造成伤害（对照组）', a.hp < hp0, 'hp: ' + hp0 + ' -> ' + a.hp);
  }
});

// ================================================================
// d. 连击保护：走真实 takeHit 路径
// ================================================================
group('d. 连击保护（真实 takeHit 路径）', () => {
  let firstTrigger = null;
  {
    const [a, b] = freshFight();
    a.x = 640; b.x = 735; a.facing = 1; b.facing = -1;
    a.y = 600; b.y = 600;
    let guarded = false, lastLock = 0, frames = 0, protectAt = 0, comboAt = 0, stateAt = '';
    for (let i = 0; i < 420; i++) {
      if (b.protectT <= 0 && i % 9 === 0) hit(a, b);
      lastLock = b.comboLockT;
      game.step(1 / 60);
      frames = i + 1;
      if (b.protectT > 0) {
        guarded = true;
        protectAt = b.protectT;
        comboAt = a.combo;
        stateAt = b.state;
        break;
      }
    }
    check('连续命中（间隔<1s）约 1.5s 后触发连击保护', guarded,
      'guarded=' + guarded + ' frames=' + frames + ' lastComboLockT=' + lastLock.toFixed(3));
    check('触发前 comboLockT 已接近 1.5s 阈值', lastLock >= CG.time - 0.1 && lastLock < CG.time,
      'lastComboLockT=' + lastLock.toFixed(3));
    check('触发时 protectT=' + CG.invuln,
      Math.abs(protectAt - CG.invuln) < 0.02, 'protectT=' + protectAt.toFixed(3));
    check('触发时护体无敌 invuln>=' + (CG.invuln - 0.02),
      b.invuln >= CG.invuln - 0.02, 'invuln=' + b.invuln.toFixed(3));
    check('触发时对手 combo 归零', comboAt === 0, 'att.combo=' + comboAt);
    check('触发时目标已脱离受击状态', stateAt !== 'hurt' && stateAt !== 'launched', 'state=' + stateAt);
    firstTrigger = { a, b };
    // 护体期间再被 resolveHit：0 伤害
    const hpP = b.hp;
    hit(a, b);
    check('护体期间 resolveHit 掉血为 0', b.hp === hpP, 'hp: ' + hpP + ' -> ' + b.hp);
    check('护体期间不会重新进入受击状态', b.state !== 'hurt' && b.state !== 'launched', 'state=' + b.state);
    // 护体持续时间
    let pf = 0;
    while (b.protectT > 0 && pf < 150) { game.step(1 / 60); pf++; }
    check('护体约 ' + CG.invuln + 's 后结束', pf >= 45 && pf <= 75,
      'frames=' + pf + ' (' + (pf / 60).toFixed(2) + 's)');
    // 护体结束后可再次被击中
    const hp2 = b.hp;
    hit(a, b);
    check('护体结束后可再次被击中', b.hp < hp2, 'hp: ' + hp2 + ' -> ' + b.hp);
    // 第二次连续命中仍能再次触发（回满血，避免第二次连击把人打死导致测不到计时）
    b.hp = 1000;
    let second = false;
    for (let i = 0; i < 420; i++) {
      if (b.protectT <= 0 && i % 9 === 0) hit(a, b);
      game.step(1 / 60);
      if (b.protectT > 0) { second = true; break; }
    }
    check('护体结束后再次被连击可再次触发保护', second, 'second=' + second);
  }
  {
    // 单次受击不触发；静置 >1s 计时清零
    const [a, b] = freshFight();
    a.x = 640; b.x = 735; a.y = 600; b.y = 600;
    hit(a, b);
    const hw0 = b.hurtWindowT;
    check('每次真实命中把 hurtWindowT 重置为 0', hw0 === 0, 'hurtWindowT=' + hw0);
    steps(14);
    const lockEarly = b.comboLockT;
    check('命中后 comboLockT 开始累积', lockEarly > 0.05, 'comboLockT=' + lockEarly.toFixed(3));
    steps(200);
    check('单次受击不会触发连击保护', b.protectT === 0, 'protectT=' + b.protectT);
    check('命中后静置 >1s 连击计时清零', b.comboLockT === 0, 'comboLockT=' + b.comboLockT);
  }
  {
    // 两段命中间隔 >1s：不累计
    const [a, b] = freshFight();
    a.x = 640; b.x = 735; a.y = 600; b.y = 600;
    hit(a, b);
    steps(90);
    check('间隔 >1s 后 comboLockT 已清零（前置）', b.comboLockT === 0, 'comboLockT=' + b.comboLockT);
    const hp0 = b.hp;
    hit(a, b);
    steps(6);
    check('间隔 >1s 的第二段命中不累计旧计时', b.comboLockT < 0.2, 'comboLockT=' + b.comboLockT.toFixed(3));
    check('间隔 >1s 的两段命中不触发保护', b.protectT === 0, 'protectT=' + b.protectT);
    steps(160);
    check('后续未再被命中也不会触发保护', b.protectT === 0, 'protectT=' + b.protectT);
    check('两段间隔命中确实造成了伤害（对照）', b.hp < hp0, 'hp: ' + hp0 + ' -> ' + b.hp);
  }
  {
    // 大招 onUltTick/onUltFinish 不触发连击保护
    const [a, b] = freshFight();
    a.x = 500; b.x = 800; a.y = 600; b.y = 600;
    a.meter = 100;
    game.pressed.add('KeyU');
    game.step(1 / 60);
    check('大招已开始（前置）', a.state === 'ult', 'state=' + a.state);
    let maxProtect = 0, maxLock = 0, maxCastLock = 0, sawCast = false, maxLockAtUlt = 0;
    for (let i = 0; i < 280; i++) {
      game.step(1 / 60);
      maxProtect = Math.max(maxProtect, b.protectT);
      maxLock = Math.max(maxLock, b.comboLockT);
      if (a.state === 'ult') maxLockAtUlt = Math.max(maxLockAtUlt, b.comboLockT);
      if (a.state === 'ult' && a.phase === 'cast') {
        sawCast = true;
        maxCastLock = Math.max(maxCastLock, b.comboLockT);
      }
    }
    check('大招期间不会触发连击保护', maxProtect === 0, 'maxProtect=' + maxProtect.toFixed(3));
    check('大招期间 comboLockT 始终 < 触发阈值', maxLock < CG.time, 'maxComboLockT=' + maxLock.toFixed(3));
    check('大招 cast 阶段 comboLockT 被每段命中清零（<0.5s）',
      sawCast && maxCastLock < 0.5, 'sawCast=' + sawCast + ' maxCastLock=' + maxCastLock.toFixed(3));
    check('大招相关时段 comboLockT 上限 < 0.5s（最后一次命中后的 0.35s 窗口，远低于 1.5s）',
      maxLockAtUlt < 0.5, 'maxLockAtUlt=' + maxLockAtUlt.toFixed(3));
    check('大招确实造成了伤害（对照组）', b.hp < 1000, 'target.hp=' + b.hp);
  }
});

// ================================================================
// e. 重置语义 / 结算数据
// ================================================================
group('e. startMatch / toMenu 重置、结算含替身数据', () => {
  {
    const [a] = freshFight();
    a.subCd = 3; a.protectT = 0.5; a.comboLockT = 1.2; a.subCount = 2; a.invuln = 0.5;
    const b = game.fighters[1];
    b.projCd = 0; b.fireProjectile();
    game.spawnDecoy(a, a.x, a.y);
    game.startMatch(2);
    check('startMatch 重置 subCd', a.subCd === 0, 'subCd=' + a.subCd);
    check('startMatch 重置 protectT', a.protectT === 0, 'protectT=' + a.protectT);
    check('startMatch 重置 comboLockT', a.comboLockT === 0, 'comboLockT=' + a.comboLockT);
    check('startMatch 重置 subCount', a.subCount === 0, 'subCount=' + a.subCount);
    check('startMatch 重置 hurtWindowT', a.hurtWindowT > 1, 'hurtWindowT=' + a.hurtWindowT);
    check('startMatch 清空 decoys', game.decoys.length === 0, 'decoys=' + game.decoys.length);
    check('startMatch 清空 projectiles', game.projectiles.length === 0, 'proj=' + game.projectiles.length);
    check('startMatch 进入 ready', game.state === 'ready', 'state=' + game.state);
    check('startMatch 后 y 仍为合法纵深', inDepth(a.y) && inDepth(b.y), 'y=' + a.y + ',' + b.y);
  }
  {
    const [a, b] = freshFight();
    b.x = 820; b.facing = -1;
    makeHurt(a); a.meter = 100; a.subCd = 0;
    pressStep('KeyI');
    check('toMenu 前存在木桩（前置）', game.decoys.length === 1, 'decoys=' + game.decoys.length);
    game.toMenu();
    check('toMenu 回到菜单', game.state === 'menu', 'state=' + game.state);
    check('toMenu 清空 decoys', game.decoys.length === 0, 'decoys=' + game.decoys.length);
    check('toMenu 重置 subCount', a.subCount === 0, 'subCount=' + a.subCount);
    check('toMenu 重置 subCd / protectT', a.subCd === 0 && a.protectT === 0,
      'subCd=' + a.subCd + ' protectT=' + a.protectT);
    renderNoThrow('toMenu 后 menu 渲染不抛异常');
  }
  {
    // 结算：含替身次数、可渲染、不报错
    const [a, b] = freshFight();
    a.subCount = 2; b.subCount = 1;
    b.hp = 1;
    hit(a, b);
    let guard = 0;
    while (game.state !== 'result' && guard < 300) { game.step(1 / 60); guard++; }
    check('对局能进入 result', game.state === 'result', 'state=' + game.state + ' after ' + guard + ' steps');
    check('result 数据有效', !!game.result && typeof game.result.winner === 'number' && !!game.result.reason,
      JSON.stringify(game.result));
    check('结算时替身次数保留', a.subCount === 2 && b.subCount === 1,
      'subCount=' + a.subCount + '/' + b.subCount);
    let texts = null, threw = null;
    try { texts = renderInspect(); } catch (e) { threw = e; }
    check('result 渲染不抛异常', threw === null, threw ? String(threw) : '');
    check('结算界面显示替身次数（subCount）', !!texts &&
      texts.some((t) => t.indexOf('替身 2') >= 0) && texts.some((t) => t.indexOf('替身 1') >= 0),
      texts ? texts.filter((t) => t.indexOf('替身') >= 0).join(' | ') : 'no texts');
    note('game.result 对象本身只有 ' + (game.result ? Object.keys(game.result).join(',') : 'null') +
      '；替身数据挂在 fighter.subCount 上并由 drawResult 渲染，没有 API 级 subCount 字段。');
  }
});

// ================================================================
// f. skillRows 5 项顺序 / 状态 + 各状态渲染
// ================================================================
group('f. skillRows 5 项顺序与冷却/内力状态、HUD 渲染', () => {
  {
    const [a, b] = freshFight();
    let rows = game.skillRows(a);
    check('skillRows 顺序 = atk,proj,dash,ult,sub', rows.map((r) => r.id).join(',') === 'atk,proj,dash,ult,sub',
      rows.map((r) => r.id).join(','));
    check('第 5 项为替身术（名称/键位）',
      rows[4].name === '替身术' && rows[4].key === 'I', rows[4].name + '/' + rows[4].key);
    const rows2 = game.skillRows(b);
    check('P2 替身键位 = N', rows2[4].key === 'N', rows2[4].key);
    check('只有替身术标价（cost=' + SUB.cost + '）',
      rows[4].cost === SUB.cost && rows.slice(0, 4).every((r) => r.cost === 0),
      rows.map((r) => r.cost).join(','));
    check('替身 kind=cd、max=' + SUB.cd + '、ratio=1（刚开局冷却为 0）',
      rows[4].kind === 'cd' && rows[4].max === SUB.cd && rows[4].ratio === 1,
      'kind=' + rows[4].kind + ' max=' + rows[4].max + ' ratio=' + rows[4].ratio);
    check('开局内力 0 → 替身未就绪', rows[4].ready === false, 'ready=' + rows[4].ready);
    a.meter = 100;
    rows = game.skillRows(a);
    check('内力 100 且冷却好 → 替身就绪', rows[4].ready === true && rows[4].ratio === 1,
      'ready=' + rows[4].ready + ' ratio=' + rows[4].ratio);
    a.subCd = 3;
    rows = game.skillRows(a);
    check('冷却中 → 替身未就绪', rows[4].ready === false, 'ready=' + rows[4].ready);
    check('冷却中 cd/ratio 正确', Math.abs(rows[4].cd - 3) < 1e-6 && Math.abs(rows[4].ratio - 0.5) < 1e-6,
      'cd=' + rows[4].cd + ' ratio=' + rows[4].ratio);
    a.subCd = 0; a.meter = SUB.cost - 1;
    rows = game.skillRows(a);
    check('内力 19 且冷却好 → 替身未就绪', rows[4].ready === false, 'ready=' + rows[4].ready);
    a.meter = SUB.cost;
    rows = game.skillRows(a);
    check('内力恰好 20 且冷却好 → 替身就绪', rows[4].ready === true, 'ready=' + rows[4].ready);
  }
  {
    // 施放瞬间 active 高亮 + 冷却进度
    const [a, b] = freshFight();
    b.x = 820; b.facing = -1;
    makeHurt(a); a.meter = 100; a.subCd = 0;
    pressStep('KeyI');
    let rows = game.skillRows(a);
    check('刚施放替身 → active 高亮', rows[4].active === true, 'active=' + rows[4].active);
    check('刚施放替身 → 就绪变 false 且 cd>' + (SUB.cd - 0.1),
      rows[4].ready === false && rows[4].cd > SUB.cd - 0.1, 'ready=' + rows[4].ready + ' cd=' + rows[4].cd.toFixed(2));
    steps(40);
    rows = game.skillRows(a);
    check('冷却随时间恢复（cd 下降）', rows[4].cd < SUB.cd - 0.6 && rows[4].cd > 4.5,
      'cd=' + rows[4].cd.toFixed(3));
    check('active 高亮只持续片刻', rows[4].active === false, 'active=' + rows[4].active);
  }
  {
    // 渲染：替身瞬间 / 木桩 / 护体 / 对局中
    const [a, b] = freshFight();
    b.x = 820; b.facing = -1;
    makeHurt(a); a.meter = 100; a.subCd = 0;
    const texts = (() => {
      game.pressed.add('KeyI');
      gctx.texts.length = 0;
      game.step(1 / 60);
      game.render();
      return gctx.texts.slice();
    })();
    check('sub 状态 + 木桩时 render 不抛异常（隐式）', true);
    check('替身瞬间有「替身术」提示文案', texts.some((t) => t.indexOf('替身术') >= 0),
      texts.filter((t) => t.indexOf('替身') >= 0).join(' | '));
    check('sub 状态下 decoys 已绘制数据存在', game.decoys.length === 1, 'decoys=' + game.decoys.length);
    renderNoThrow('decoy 存在时 render 不抛异常');
    game.paused = false;
    game.setupGuardScene();
    let gtexts = null, gthrew = null;
    try { gtexts = renderInspect(); } catch (e) { gthrew = e; }
    check('guard 状态（护体气罩）render 不抛异常', gthrew === null, gthrew ? String(gthrew) : '');
    check('护体触发时有「连击保护」文案', !!gtexts && gtexts.some((t) => t.indexOf('连击保护') >= 0),
      gtexts ? gtexts.filter((t) => t.indexOf('保护') >= 0).join(' | ') : 'no texts');
    check('护体触发时有「护」字提示', !!gtexts && gtexts.some((t) => t.indexOf('护') >= 0),
      gtexts ? gtexts.filter((t) => t.indexOf('护') >= 0).join(' | ') : 'no texts');
    game.paused = false;
  }
});

// ================================================================
// i. 自检场景（?scenario=sub / ?scenario=guard）
// ================================================================
group('i. 自检场景 setupSubScene / setupGuardScene', () => {
  {
    game.paused = false;
    game.setupSubScene();
    const a = game.fighters[0];
    check('setupSubScene 定格（paused=true）', game.paused === true, 'paused=' + game.paused);
    check('setupSubScene 有木桩', game.decoys.length > 0, 'decoys=' + game.decoys.length);
    check('setupSubScene 处于替身状态', a.state === 'sub', 'state=' + a.state);
    check('setupSubScene 后 x/y 合法', inFieldX(a.x) && inDepth(a.y), 'x=' + a.x + ' y=' + a.y);
    renderNoThrow('setupSubScene 后 render 不抛异常');
    const x0 = a.x;
    game.step(1 / 60);
    check('paused 时 step 不推进逻辑', a.x === x0, 'x=' + a.x);
  }
  {
    game.paused = false;
    game.setupGuardScene();
    const b = game.fighters[1];
    check('setupGuardScene 定格（paused=true）', game.paused === true, 'paused=' + game.paused);
    check('setupGuardScene 护体生效（protectT>0）', b.protectT > 0, 'protectT=' + b.protectT.toFixed(3));
    check('setupGuardScene 护体无敌（invuln>0）', b.invuln > 0, 'invuln=' + b.invuln.toFixed(3));
    renderNoThrow('setupGuardScene 后 render 不抛异常');
    game.paused = false;
  }
});

// ================================================================
// h. 边界：贴墙瞬身 / 双方同时替身 / 双方同时护体 / KO 同帧保护 / decoy 不增长
// ================================================================
group('h. 边界条件', () => {
  {
    // 贴左墙：对手在 x=100 且朝向 +x，背后 = 100-120 → 夹到 92
    const [a, b] = freshFight();
    b.x = 100; b.facing = 1; a.x = 400; a.y = b.y = 600;
    a.state = 'hurt'; a.hurtT = 0.8; a.meter = 100; a.subCd = 0;
    const txLeft = clamp(b.x - b.facing * SUB.dist, 92, U.W - 92);
    a.startSubstitute();
    check('贴左墙瞬身目标被夹到 [92, W-92]', Math.abs(a.x - txLeft) < 1e-6,
      'x=' + a.x + ' expect=' + txLeft);
    check('贴左墙瞬身目标 >= 92', a.x >= 92 - 1e-6, 'x=' + a.x);
    steps(6);
    check('贴左墙瞬身后 x 仍在场地内', inFieldX(a.x), 'x=' + a.x);
    check('贴左墙瞬身后 y 合法', inDepth(a.y), 'y=' + a.y);
  }
  {
    // 贴右墙：对手在 x=1180 且朝向 -x，背后 = 1180+120 → 夹到 W-92
    const [a, b] = freshFight();
    b.x = 1180; b.facing = -1; a.x = 900; a.y = b.y = 600;
    a.state = 'hurt'; a.hurtT = 0.8; a.meter = 100; a.subCd = 0;
    const txRight = clamp(b.x - b.facing * SUB.dist, 92, U.W - 92);
    a.startSubstitute();
    check('贴右墙瞬身目标被夹到 [92, W-92]', Math.abs(a.x - txRight) < 1e-6,
      'x=' + a.x + ' expect=' + txRight + ' (代码用 W-92=' + (U.W - 92) + ')');
    steps(6);
    check('贴右墙瞬身后 x 仍在场地内', inFieldX(a.x), 'x=' + a.x);
    note('任务描述写「x∈[92,1208]」，当前实现夹取范围是 [92, U.W-92] = [92,' + (U.W - 92) +
      ']；场地物理夹取是 [70,' + (U.W - 70) + ']。1208 与代码不一致（右墙留 92 与左墙对称更自洽）。');
  }
  {
    // 双方同时被击打并同时按替身键
    const [a, b] = freshFight();
    a.x = 700; b.x = 820; a.facing = 1; b.facing = -1;
    a.y = b.y = 600;
    makeHurt(a); makeHurt(b);
    a.meter = 100; b.meter = 100; a.subCd = 0; b.subCd = 0;
    const ca = a.subCount, cb = b.subCount;
    game.pressed.add('KeyI'); game.pressed.add('KeyN');
    game.step(1 / 60);
    check('双方同时替身：两端都进入 sub', a.state === 'sub' && b.state === 'sub',
      'A=' + a.state + ' B=' + b.state);
    check('双方同时替身：各自扣 20 内力', a.meter === 80 && b.meter === 80,
      'A=' + a.meter + ' B=' + b.meter);
    check('双方同时替身：各 +1 次数', a.subCount === ca + 1 && b.subCount === cb + 1,
      'A=' + a.subCount + ' B=' + b.subCount);
    check('双方同时替身：生成 2 个木桩', game.decoys.length === 2, 'decoys=' + game.decoys.length);
    check('双方同时替身：位置均在场地内', inFieldX(a.x) && inFieldX(b.x), 'A.x=' + a.x + ' B.x=' + b.x);
    check('双方同时替身：y 均在纵深范围内', inDepth(a.y) && inDepth(b.y), 'A.y=' + a.y + ' B.y=' + b.y);
    check('双方同时替身：数值有限', finiteAll([a.x, a.y, b.x, b.y]), a.x + ',' + b.x);
  }
  {
    // 双方同一帧触发连击保护
    const [a, b] = freshFight();
    a.x = 600; b.x = 760; a.y = b.y = 600;
    a.state = 'hurt'; a.hurtT = 0.9; a.hurtWindowT = 0; a.comboLockT = CG.time - 0.004;
    b.state = 'hurt'; b.hurtT = 0.9; b.hurtWindowT = 0; b.comboLockT = CG.time - 0.004;
    game.step(1 / 60);
    check('双方同时触发护体：两端 protectT>0', a.protectT > 0 && b.protectT > 0,
      'A=' + a.protectT.toFixed(3) + ' B=' + b.protectT.toFixed(3));
    check('双方同时触发护体：两端 invuln>0', a.invuln > 0 && b.invuln > 0,
      'A=' + a.invuln.toFixed(3) + ' B=' + b.invuln.toFixed(3));
    check('双方同时触发护体：均脱离受击状态', a.state !== 'hurt' && b.state !== 'hurt',
      'A=' + a.state + ' B=' + b.state);
    const hpa = a.hp, hpb = b.hp;
    hit(a, b); hit(b, a);
    check('双方护体期间互打不掉血', a.hp === hpa && b.hp === hpb,
      'A=' + a.hp + ' B=' + b.hp + ' (from ' + hpa + '/' + hpb + ')');
    check('双方护体后数值有限', finiteAll([a.x, a.y, b.x, b.y, a.invuln, b.invuln]));
  }
  {
    // KO 同帧及 KO 之后的连击保护：真实命中路径（不手动改 hurtWindowT）
    const [a, b] = freshFight();
    a.x = 640; b.x = 735; a.facing = 1; b.facing = -1;
    a.y = b.y = 600;
    let lethal = null;
    for (let i = 0; i < 800; i++) {
      if (i % 9 === 0 && b.protectT <= 0) hit(a, b);
      game.step(1 / 60);
      if (b.protectT > 0) break;
      if (b.comboLockT >= 1.40 && b.comboLockT < CG.time && b.hp > 60) {
        b.hp = 20;
        hit(a, b);
        lethal = { i, comboLockT: b.comboLockT, hp: b.hp, state: b.state };
        break;
      }
    }
    check('KO 边界：先通过真实连击把 comboLockT 累积到 1.4~1.5', !!lethal,
      lethal ? 'comboLockT=' + lethal.comboLockT.toFixed(3) : 'not reached');
    let koSeen = false, ressurected = false, guardAfterKO = false, protectOnKO = 0, stateLog = [];
    for (let i = 0; i < 220 && game.state !== 'result'; i++) {
      game.step(1 / 60);
      if (game.state === 'ko' || game.state === 'result') koSeen = true;
      if (koSeen && b.hp <= 0 && (b.state === 'idle' || b.state === 'walk' || b.state === 'attack')) {
        ressurected = true;
        if (stateLog.length < 6) stateLog.push('i=' + i + ' state=' + b.state + ' gstate=' + game.state);
      }
      if (koSeen && b.protectT > 0) {
        guardAfterKO = true;
        protectOnKO = Math.max(protectOnKO, b.protectT);
      }
    }
    check('KO 后对局仍能进入 result（不崩）', game.state === 'result', 'state=' + game.state);
    check('KO 后 result 数据有效', !!game.result && typeof game.result.winner === 'number',
      JSON.stringify(game.result));
    check('KO 的角色不会被连击保护重置回可操作状态', !ressurected,
      (ressurected ? 'KO 后 state 变为 ' + stateLog.join('; ') : '') +
      '（loser.state=' + b.state + ' hp=' + b.hp + '）');
    check('KO 后不再出现护体特效（protectT 应为 0）', !guardAfterKO,
      guardAfterKO ? 'KO 后出现 protectT=' + protectOnKO.toFixed(3) : 'protectT=0');
    note('KO 边界说明：19:07:39 版本已修复（updateGuard/triggerGuard 首行增加 state===ko / roundOver 保护，' +
      'draw 的护体绘制加 state!==ko）。本轮用真实命中路径复测：KO 后 loser.state 保持 ko、protectT=0、能正常进 result。');
  }
  {
    // decoy 数组不会无限增长 / 正常节奏最多 1 个
    const [a, b] = freshFight();
    b.x = 820; b.facing = -1;
    makeHurt(a); a.meter = 100; a.subCd = 0;
    pressStep('KeyI');
    check('单次替身只有 1 个木桩', game.decoys.length === 1, 'decoys=' + game.decoys.length);
    steps(70);
    check('1.1s 后木桩清空', game.decoys.length === 0, 'decoys=' + game.decoys.length);
    // 强制连续多次替身（模拟异常高频）：观察最多堆积数量，并在生命周期后清空
    let maxDecoys = 0;
    for (let k = 0; k < 20; k++) {
      makeHurt(a); a.meter = 100; a.subCd = 0;
      a.state = 'hurt'; a.hurtT = 0.8;
      pressStep('KeyI');
      maxDecoys = Math.max(maxDecoys, game.decoys.length);
    }
    check('连续 20 次替身木桩数量有上限（<=20）', maxDecoys <= 20, 'maxDecoys=' + maxDecoys);
    steps(80);
    check('生命周期结束后 decoys 全部清空（无泄漏）', game.decoys.length === 0,
      'decoys=' + game.decoys.length);
    for (let k = 0; k < 200; k++) game.spawnDecoy(a, 300 + (k % 7), a.y);
    check('强制生成 200 个木桩不抛异常', true, 'decoys=' + game.decoys.length);
    steps(70);
    check('200 个木桩 1 秒后全部清空', game.decoys.length === 0, 'decoys=' + game.decoys.length);
  }
});

// ================================================================
// g. 纯 AI vs AI 跑 10 局
// ================================================================
group('g. AI vs AI 10 局（异常 / 有限数 / 结算 / 替身与护体出现次数）', () => {
  const stats = { matches: 0, results: 0, exceptions: [], subs: 0, guards: 0, maxDecoys: 0, steps: 0, maxSteps: 0 };
  for (let m = 0; m < 10; m++) {
    game.paused = false;
    game.keys.clear(); game.pressed.clear();
    game.startMatch(0);
    const [a, b] = game.fighters;
    let steps = 0, exception = null, prevSubA = 0, prevSubB = 0, prevProtA = 0, prevProtB = 0;
    let guardCount = 0, subCount = 0, maxDecoys = 0, finiteBad = null;
    while (game.state !== 'result' && steps < 60 * 130) {
      try {
        game.step(1 / 60);
      } catch (e) {
        exception = e;
        break;
      }
      steps++;
      maxDecoys = Math.max(maxDecoys, game.decoys.length);
      if (a.subCount > prevSubA) subCount += a.subCount - prevSubA;
      if (b.subCount > prevSubB) subCount += b.subCount - prevSubB;
      prevSubA = a.subCount; prevSubB = b.subCount;
      if (prevProtA <= 0 && a.protectT > 0) guardCount++;
      if (prevProtB <= 0 && b.protectT > 0) guardCount++;
      prevProtA = a.protectT; prevProtB = b.protectT;
      if (!finiteBad && !finiteAll([a.hp, a.x, a.y, b.hp, b.x, b.y])) {
        finiteBad = 'hp=' + a.hp + '/' + b.hp + ' pos=' + a.x + ',' + a.y + '/' + b.x + ',' + b.y;
      }
    }
    stats.matches++;
    stats.steps += steps;
    stats.maxSteps = Math.max(stats.maxSteps, steps);
    stats.subs += subCount;
    stats.guards += guardCount;
    stats.maxDecoys = Math.max(stats.maxDecoys, maxDecoys);
    if (exception) stats.exceptions.push('match#' + m + ': ' + ((exception && exception.stack) || exception));
    if (!finiteBad) check('AI 第 ' + (m + 1) + ' 局：hp/x/y 始终为有限数', true);
    else check('AI 第 ' + (m + 1) + ' 局：hp/x/y 始终为有限数', false, finiteBad);
    if (game.state === 'result') stats.results++;
    check('AI 第 ' + (m + 1) + ' 局：进入 result', game.state === 'result',
      'state=' + game.state + ' steps=' + steps);
    if (!exception) { try { game.render(); } catch (e) { stats.exceptions.push('render#' + m + ': ' + e); } }
  }
  check('10 局完全无异常', stats.exceptions.length === 0, stats.exceptions.slice(0, 2).join(' || '));
  check('10 局都进入结算', stats.results === 10, 'results=' + stats.results + '/10');
  note('AI vs AI 统计：总局数 ' + stats.matches + '，替身总次数 ' + stats.subs +
    '，连击保护触发次数 ' + stats.guards + '，单局木桩峰值 ' + stats.maxDecoys +
    '，总帧数 ' + stats.steps + '，单局最长 ' + stats.maxSteps + ' 帧（≈' +
    (stats.maxSteps / 60).toFixed(1) + 's）。概率事件允许为 0，未对源码做任何调整。');
});

// ================================================================
// 汇总
// ================================================================
let total = 0, failedChecks = 0, groupErrors = 0;
const failLines = [];

function fileSig() {
  return FILES.map((f) => {
    const p = path.join(__dirname, '..', 'js', f + '.js');
    const st = fs.statSync(p);
    return f + ':' + st.mtimeMs + ':' + st.size;
  }).join('|');
}
const sigAtEnd = fileSig();

console.log('\n===== 独立验证：替身术 / 连击保护 =====');
console.log('版本摘要（本次运行加载的 js，md5 / mtime）：');
const crypto = require('crypto');
for (const f of FILES) {
  const p = path.join(__dirname, '..', 'js', f + '.js');
  const buf = fs.readFileSync(p);
  const st = fs.statSync(p);
  console.log('  js/' + f + '.js  md5=' + crypto.createHash('md5').update(buf).digest('hex') +
    '  mtime=' + st.mtime.toISOString());
}
if (sigAtEnd !== sigAtStart) {
  console.log('  ⚠ 注意：js/ 文件在本次运行期间发生变化，结果可能混合了两个版本，请复跑！');
} else {
  console.log('  js/ 文件在本脚本运行期间未变化（版本一致 ✅）');
}
for (const g of groups) {
  const bad = g.checks.filter((c) => !c.pass).length;
  console.log('\n[' + g.name + ']  ' + (g.checks.length - bad) + '/' + g.checks.length + ' PASS' +
    (g.error ? '  + 该组异常' : ''));
  for (const c of g.checks) {
    total++;
    if (c.pass) {
      console.log('  ok   ' + c.name + (c.extra ? '  [' + c.extra + ']' : ''));
    } else {
      failedChecks++;
      failLines.push(g.name + ' -> ' + c.name + (c.extra ? '  [' + c.extra + ']' : ''));
      console.log('  FAIL ' + c.name + (c.extra ? '  -> ' + c.extra : ''));
    }
  }
  for (const n of g.notes) console.log('  note ' + n);
  if (g.error) {
    groupErrors++;
    failLines.push(g.name + ' -> 组内异常: ' + ((g.error && g.error.stack) || g.error));
    console.log('  FAIL 组内异常: ' + ((g.error && g.error.stack) || g.error));
  }
}
console.log('\n----------------------------------------');
console.log('总计: ' + total + ' 项检查，失败 ' + failedChecks + ' 项' +
  (groupErrors ? '，分组异常 ' + groupErrors + ' 组' : ''));
if (failLines.length) {
  console.log('失败列表:');
  for (const l of failLines) console.log('  - ' + l);
} else {
  console.log('全部通过 ✅');
}
process.exit(failedChecks === 0 && groupErrors === 0 ? 0 : 1);
