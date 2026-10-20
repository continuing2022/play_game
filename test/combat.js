// 战斗执行验收：真实 Fighter/Game 结算及输入流程，固定步长，无浏览器依赖。
// node test/combat.js
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function canvas() {
  const ctx = new Proxy({}, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (p === 'measureText') return () => ({ width: 10 });
      return () => {};
    }
  });
  return { width: 1280, height: 720, style: {}, getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }), addEventListener() {} };
}
const env = { console, location: { search: '' }, document: { createElement: canvas },
  performance: { now: () => 0 }, requestAnimationFrame() {}, addEventListener() {},
  devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720 };
env.window = env;
vm.createContext(env);
for (const file of ['util', 'audio', 'background', 'fx', 'fighter', 'ai', 'game']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), env);
}
let count = 0;
function test(name, fn) {
  fn();
  count++;
  console.log('ok ' + name);
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`); }
function setup() {
  const game = new env.Game(canvas());
  game.startMatch(2);
  game.state = 'fight';
  const [a, b] = game.fighters;
  a.place(400, 1, 600); b.place(476, -1, 600);
  a.autoFace = b.autoFace = false;
  return { game, a, b };
}
const cases = [
  [env.ATTACKS.a1, 40, 70, 0.16, 0.04, 6, 0.016, 4, 1, false],
  [env.ATTACKS.a2, 56, 150, 0.22, 0.06, 8, 0.020, 7, 1, false],
  [env.PROJ, 72, 230, 0.26, 0.08, 10, 0.024, 10, 1.03, false],
  [env.DASH, 72, 50, 0.26, 0.08, 10, 0.024, 10, 1.03, false],
  [env.ATTACKS.a3, 104, 360, 0.44, 0.11, 15, 0.028, 16, 1.06, true],
  [env.ULT.tick, 8, 0, 0.07, 0.012, 0, 0.01, 2, 1, false],
  [env.ULT.final, 200, 420, 0.65, 0.14, 28, 0.03, 24, 1.12, true]
];
for (const [def, dmg, kb, stun, stop, chip, blockStop, shake, zoom, launch] of cases) {
  test(def.name + '：命中数值、力度、击倒', () => {
    const { game, a, b } = setup();
    assert.equal(game.resolveHit(a, b, def, 'test'), 'hit');
    assert.equal(b.hp, 1000 - dmg);
    near(b.vx, kb); near(b.hurtT, stun); near(game.hitstop, stop);
    near(game.shake, shake); near(game.zoomTarget, zoom);
    assert.equal(b.state, launch ? 'launched' : 'hurt');
    assert.equal(a.combo, 1);
    assert.equal(game.fx.texts[0].str, '-' + dmg);
    assert.equal(game.fx.parts.filter(p => p.mode === 'spark').length, def.light ? 4 : env.IMPACTS[def.tier].dots);
  });
  test(def.name + '：被挡减伤、擦墨、较短顿帧、不击倒', () => {
    const { game, a, b } = setup();
    b.state = 'block';
    assert.equal(game.resolveHit(a, b, def, 'test'), 'block');
    assert.equal(b.hp, 1000 - chip);
    assert.equal(b.state, 'block');
    near(game.hitstop, blockStop); near(game.zoomTarget, 1);
    assert.ok(game.shake < shake);
    assert.equal(a.combo, 0);
    assert.equal(game.fx.texts[0].str, '格挡');
    assert.ok(game.fx.parts.every(p => p.mode === 'scrape'));
    assert.equal(game.fx.rings.length, 0);
    if (def.light) assert.equal(b.vx, 0);
  });
  test(def.name + '：无敌时挥空，没有伤害、顿帧、飘字、墨爆', () => {
    const { game, a, b } = setup();
    b.state = 'hurt'; b.invuln = 0.2;
    assert.equal(game.resolveHit(a, b, def, 'test'), 'whiff');
    assert.equal(b.hp, 1000); assert.equal(a.combo, 0);
    assert.equal(game.hitstop, 0); assert.equal(game.shake, 0);
    assert.equal(game.fx.parts.length + game.fx.rings.length + game.fx.texts.length, 0);
  });
}

test('普攻原有三段时序、衔接与弧长递增', () => {
  const { game } = setup();
  const timings = [[0.085, 0.09, 0.16], [0.10, 0.09, 0.19], [0.17, 0.12, 0.34]];
  ['a1', 'a2', 'a3'].forEach((key, i) => {
    const d = env.ATTACKS[key];
    assert.deepEqual([d.startup, d.active, d.recovery], timings[i]);
    assert.equal(d.chain, i < 2 ? 'a' + (i + 2) : null);
    game.fx.slash(400, 600, 1, '#fff', d.tier);
  });
  const arcs = game.fx.slashes;
  assert.ok(arcs[0].radius < arcs[1].radius && arcs[1].radius < arcs[2].radius);
  assert.ok(arcs[0].width < arcs[1].width && arcs[1].width < arcs[2].width);
  assert.ok(arcs[0].arc < arcs[1].arc && arcs[1].arc < arcs[2].arc);
});

test('普攻挥空及替身木桩只消耗轨迹', () => {
  for (const key of ['a1', 'a2', 'a3']) {
    const { game, a, b } = setup();
    b.x = 1000;
    a.startAttack(key);
    for (let i = 0; i < 60; i++) a.update(1 / 60, {});
    assert.equal(b.hp, 1000); assert.equal(game.hitstop, 0);
    assert.equal(game.fx.texts.length + game.fx.parts.length, 0);
    b.x = 476;
    game.spawnDecoy(b, b.x, b.y);
    game.fx.reset();
    a.x = 400; a.startAttack(key);
    for (let i = 0; i < 60; i++) a.update(1 / 60, {});
    assert.equal(b.hp, 1000); assert.equal(game.hitstop, 0);
    assert.equal(game.fx.texts.length + game.fx.parts.length, 0);
  }
});

test('剑气命中/被挡接触后消失，纵深阈值仍为 58', () => {
  for (const block of [false, true]) {
    const { game, a, b } = setup();
    b.x = 650; b.y += 58;
    if (block) b.state = 'block';
    a.fireProjectile();
    for (let i = 0; i < 60 && game.projectiles.length; i++) game.updateProjectiles(1 / 60);
    assert.equal(game.projectiles.length, 0);
    assert.equal(b.hp, block ? 990 : 928);
    assert.equal(game.fx.texts.length, 1);
    assert.equal(game.fx.rings.length, block ? 0 : 1);
  }
  const { game, a, b } = setup();
  b.y += 59; a.fireProjectile(); game.fx.reset();
  for (let i = 0; i < 120; i++) game.updateProjectiles(1 / 60);
  assert.equal(b.hp, 1000); assert.equal(game.projectiles.length, 0);
  assert.equal(game.hitstop, 0); assert.equal(game.fx.texts.length, 0);
  near(env.PROJ.speed, 830); near(env.PROJ.cooldown, 2.5);
});

test('剑气超时散墨、打在木桩上无命中反馈', () => {
  const { game, a, b } = setup();
  a.fireProjectile();
  game.projectiles[0].t = 1.7;
  b.y += 59;
  game.updateProjectiles(1 / 60);
  assert.equal(game.projectiles.length, 0); assert.equal(game.hitstop, 0);
  game.spawnDecoy(b, 530, 600); game.fx.reset();
  b.x = 1000; b.y = 600;
  a.fireProjectile(); game.fx.reset();
  for (let i = 0; i < 20; i++) game.updateProjectiles(1 / 60);
  assert.equal(game.projectiles.length, 0); assert.equal(b.hp, 1000);
  assert.equal(game.hitstop, 0); assert.equal(game.fx.rings.length + game.fx.texts.length, 0);
});

test('残影步恰好消失 0.12 秒，仅此期间无敌且不画本体', () => {
  const { game, a, b } = setup();
  let bodyDraws = 0;
  a.drawBody = () => bodyDraws++;
  a.startDash(); a.draw(game.ctx);
  assert.equal(bodyDraws, 0); assert.equal(a.afterimages.length, 1);
  for (let i = 0; i < 119; i++) a.update(0.001, {});
  assert.ok(a.dashHidden); assert.ok(a.invuln > 0); assert.equal(a.x, 400);
  assert.equal(b.hp, 1000);
  a.update(0.001, {});
  assert.equal(a.dashHidden, false); near(a.invuln, 0); near(a.x, b.x - 76);
  a.draw(game.ctx); assert.equal(bodyDraws, 1);
  assert.equal(b.hp, 928); assert.equal(b.state, 'hurt');
  assert.equal(game.fx.rings.length, 3); // 消失点、出现点和命中环
  game.hitstop = 0;
  assert.equal(game.resolveHit(b, a, env.ATTACKS.a1, 'melee'), 'hit');
});

test('残影步左右、墙边与纵深落点均不绕背，只出击一次', () => {
  for (const [ax, bx] of [[300, 800], [900, 400], [100, 110], [1200, 1190]]) {
    const { game, a, b } = setup();
    a.x = ax; b.x = bx; a.y = 510; b.y = 660;
    const side = Math.sign(ax - bx);
    a.startDash();
    for (let i = 0; i < 300; i++) a.update(0.001, {});
    assert.equal(a.y, b.y); assert.equal(Math.sign(a.x - b.x), side);
    assert.equal(a.facing, -side); assert.equal(b.hp, 928);
    assert.equal(a.state, 'idle'); assert.equal(game.fx.texts.length, 1);
    assert.ok(a.x >= 70 && a.x <= 1210);
    near(a.dashCd, 2.5);
  }
});

test('残影步对无敌/倒地/击飞目标现身挥空，对格挡只掉 10', () => {
  for (const state of ['invuln', 'down', 'launched', 'block']) {
    const { game, a, b } = setup();
    if (state === 'invuln') b.invuln = 0.5;
    else b.state = state;
    a.startDash();
    for (let i = 0; i < 120; i++) a.update(0.001, {});
    assert.equal(a.dashHidden, false); near(a.x, b.x - 76);
    assert.equal(b.hp, state === 'block' ? 990 : 1000);
    near(game.hitstop, state === 'block' ? 0.024 : 0);
    assert.equal(game.fx.texts.length, state === 'block' ? 1 : 0);
    assert.ok(game.fx.parts.every(p => p.mode === 'scrape'));
  }
});

test('消失期间对手移动到场地边界，现身及收招分离仍不绕背', () => {
  for (const side of [-1, 1]) {
    const { game, a, b } = setup();
    a.x = 600 + side * 50; b.x = 600;
    a.startDash();
    b.x = side < 0 ? 70 : 1210;
    b.invuln = 0.5;
    for (let i = 0; i < 300; i++) {
      a.update(0.001, {}); b.update(0.001, {}); game.separate();
      if (!a.dashHidden) assert.ok((a.x - b.x) * side >= 0);
    }
    assert.equal(Math.sign(a.x - b.x), side);
  }
});

function ultimate({ block = false, midway = false, evade = false, dt = 1 / 60 } = {}) {
  const { game, a, b } = setup();
  b.x = 800;
  a.meter = 100;
  game.pressed.add('KeyU');
  if (block) game.keys.add('ShiftRight');
  let ticks = 0, rainHp = 1000, hpBeforeFinish;
  const tick = game.onUltTick;
  const finish = game.onUltFinish;
  game.onUltTick = function (f) {
    ticks++;
    if (midway && ticks === 4) this.keys.add('ShiftRight');
    if (evade) b.x = f.rainArea.x + env.ULT.rainHalfWidth + 1;
    const result = tick.call(this, f);
    rainHp = b.hp;
    return result;
  };
  game.onUltFinish = function (f) {
    hpBeforeFinish = b.hp;
    return finish.call(this, f);
  };
  for (let i = 0; i < 5 / dt; i++) {
    game.step(dt);
    if (a.phase === 'charge') assert.equal(b.hp, 1000);
    if (hpBeforeFinish != null) break;
  }
  assert.equal(ticks, 10);
  assert.ok(hpBeforeFinish != null);
  return { game, a, b, rainHp, hpBeforeFinish };
}

test('大招全命中：10×8 + 200 = 280，伤害集中终结', () => {
  for (const dt of [1 / 60, 1 / 120, 1 / 30]) {
    const { game, a, b, hpBeforeFinish } = ultimate({ dt });
    assert.equal(hpBeforeFinish, 920); assert.equal(b.hp, 720);
    assert.equal(b.state, 'launched'); near(game.hitstop, 0.14);
    near(game.shake, 24); near(game.zoomTarget, 1.12);
    assert.equal(a.combo, 11);
  }
});

test('大招全程格挡：落剑零伤害，终结 28，无击倒和最大镜头', () => {
  const { game, b, hpBeforeFinish } = ultimate({ block: true });
  assert.equal(hpBeforeFinish, 1000); assert.equal(b.hp, 972);
  assert.equal(b.state, 'block'); near(game.hitstop, 0.03); near(game.zoomTarget, 1);
  assert.ok(game.shake < 24);
});

test('落剑中途按住格挡后能挡住后续剑及终结', () => {
  const { b, hpBeforeFinish } = ultimate({ midway: true });
  assert.ok(hpBeforeFinish > 920 && hpBeforeFinish < 1000);
  assert.equal(b.hp, hpBeforeFinish - 28);
  assert.equal(b.state, 'block');
});

test('走出固定剑雨范围后落剑及终结挥空', () => {
  const { game, b } = ultimate({ evade: true });
  assert.equal(b.hp, 1000); assert.equal(game.hitstop, 0);
  assert.equal(game.fx.texts.length, 0); near(game.zoomTarget, 1);
});

test('落剑无击退时保留已有横向速度，0.07 秒后能格挡', () => {
  const { game, a, b } = setup();
  game.onUltCast(a); b.vx = 100;
  game.onUltTick(a);
  assert.equal(b.vx, 100); near(b.hurtT, 0.07);
  for (let i = 0; i < 6; i++) b.update(1 / 60, { block: true });
  assert.equal(b.state, 'block');
  const hp = b.hp;
  game.hitstop = 0;
  game.onUltTick(a);
  assert.equal(b.hp, hp); near(game.hitstop, 0.01);
});

test('落剑纵深边界、无敌与终结挥空均不产生命中反馈', () => {
  for (const mode of ['depth', 'invuln']) {
    const { game, a, b } = setup();
    game.onUltCast(a); game.fx.reset(); game.hitstop = game.shake = 0;
    if (mode === 'depth') b.y += 59;
    else b.invuln = 0.3;
    assert.equal(game.onUltTick(a), 'whiff');
    assert.equal(game.onUltFinish(a), 'whiff');
    assert.equal(b.hp, 1000); assert.equal(game.hitstop, 0);
    assert.equal(game.fx.parts.length + game.fx.texts.length + game.fx.rings.length, 0);
  }
});

test('镜头反馈会恢复，重开清空镜头计时', () => {
  const { game, a, b } = setup();
  game.resolveHit(a, b, env.ULT.final, 'ult');
  for (let i = 0; i < 120; i++) game.updateCamera(1 / 60);
  near(game.zoomTarget, 1); assert.ok(game.zoom < 1.001);
  game.zoomHold = 0.3; game.startMatch(2); assert.equal(game.zoomHold, 0);
  near(game.fighters[0].maxHp, 1000); near(game.fullTime, 90);
  near(env.SUB.cost, 20); near(env.SUB.cd, 6); near(env.SUB.invuln, 0.55);
});

console.log(`\n${count} 项战斗执行专项测试通过。`);
