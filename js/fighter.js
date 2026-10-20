(function (g) {
  'use strict';

  var U = g.U;
  var GROUND = U.GROUND;
  var DEPTH_MIN = U.DEPTH_MIN;
  var DEPTH_MAX = U.DEPTH_MAX;
  var MAX_METER = 100;

  // 力度只由招式档位决定；伤害不参与演出分档。
  var IMPACTS = {
    1: { stop: 0.04, blockStop: 0.016, shake: 4, zoom: 1, dots: 8, width: 7, radius: 78, arc: 0.72 },
    2: { stop: 0.06, blockStop: 0.020, shake: 7, zoom: 1, dots: 12, width: 11, radius: 102, arc: 1.02 },
    3: { stop: 0.08, blockStop: 0.024, shake: 10, zoom: 1.03, dots: 16, width: 14, radius: 112, arc: 1.12 },
    4: { stop: 0.11, blockStop: 0.028, shake: 16, zoom: 1.06, dots: 22, width: 19, radius: 132, arc: 1.25 },
    5: { stop: 0.14, blockStop: 0.03, shake: 24, zoom: 1.12, dots: 32, width: 25, radius: 158, arc: 1.4 }
  };

  var ATTACKS = {
    a1: {
      key: 'a1', name: '横斩',
      startup: 0.085, active: 0.09, recovery: 0.16,
      dmg: 40, hitstun: 0.16, kb: 70, tier: 1, chain: 'a2',
      box: { ox: 16, oy: -142, w: 112, h: 92 },
      lunge: 260, heavy: false
    },
    a2: {
      key: 'a2', name: '撩剑',
      startup: 0.10, active: 0.09, recovery: 0.19,
      dmg: 56, hitstun: 0.22, kb: 150, tier: 2, chain: 'a3',
      box: { ox: 18, oy: -132, w: 122, h: 102 },
      lunge: 300, heavy: false
    },
    a3: {
      key: 'a3', name: '崩山',
      startup: 0.17, active: 0.12, recovery: 0.34,
      dmg: 104, hitstun: 0.44, kb: 360, tier: 4, launch: true, chain: null,
      box: { ox: 14, oy: -170, w: 152, h: 154 },
      lunge: 360, heavy: true
    }
  };

  var PROJ = { dmg: 72, hitstun: 0.26, kb: 230, tier: 3, speed: 830, cooldown: 2.5, name: '剑气' };
  var DASH = { dmg: 72, hitstun: 0.26, kb: 50, tier: 3, vanish: 0.12, recover: 0.10, dist: 76, cd: 2.8, name: '残影步' };
  var ULT = {
    tickDmg: 8, finalDmg: 200, charge: 0.9, cast: 1.25, recover: 0.4,
    interval: 0.115, rainHalfWidth: 190,
    tick: { dmg: 8, hitstun: 0.07, kb: 0, tier: 5, light: true, chip: 0, name: '落剑' },
    final: { dmg: 200, hitstun: 0.65, kb: 420, tier: 5, launch: true, name: '万剑归宗' }
  };

  // 替身术：被连击时唯一的脱身手段（消耗内力 + 冷却）
  var SUB = { cost: 20, cd: 6.0, invuln: 0.55, dur: 0.2, dist: 120, name: '替身术' };
  // 连击保护：连续受击超过 time 秒后强制挣脱（自动时间设定）
  var COMBO_GUARD = { gap: 1.0, time: 1.5, invuln: 0.9 };

  function Fighter(game, idx, pal) {
    this.game = game;
    this.idx = idx;
    this.pal = pal;
    this.name = pal.name;
    this.maxHp = 1000;
    this.reset();
  }

  Fighter.prototype.reset = function () {
    this.hp = this.maxHp;
    this.meter = 0;
    this.state = 'idle';
    this.stateT = 0;
    this.stT = 0;
    this.hurtT = 0;
    this.atk = null;
    this.atkBuf = 0;
    this.projCd = 0;
    this.dashCd = 0;
    this.subCd = 0;
    this.subCount = 0;
    this.protectT = 0;
    this.comboLockT = 0;
    this.hurtWindowT = 99;
    this.invuln = 0;
    this.flash = 0;
    this.dashHit = false;
    this.dashHidden = false;
    this.dashSide = 1;
    this.afterimageT = 0;
    this.afterimages = [];
    this.inputDir = 0;
    this.castFx = null;
    this.combo = 0;
    this.comboT = 0;
    this.maxCombo = 0;
    this.animT = Math.random() * 10;
    this.walkPhase = 0;
    this.vy = 0; // 纵深方向速度
    this.vx = 0;
    this.y = GROUND;
    this.x = 640;
    this.facing = 1;
    this.autoFace = true; // 仅 AI 一方在空闲时自动转向对手；人类玩家松手保持朝向
    this.phase = null;
    this.ultT = 0;
    this.ultTickT = 0;
    this.ultBurst = 0;
    this.rainArea = null;
    this.blockGlow = 0;
    this.koDown = false;
  };

  Fighter.prototype.place = function (x, facing, y) {
    this.reset();
    this.x = x;
    this.facing = facing;
    if (y != null) this.y = U.clamp(y, DEPTH_MIN, DEPTH_MAX);
  };

  Fighter.prototype.opponent = function () { return this.game.opponentOf(this); };

  // 现在所有角色都在地面平面上四向移动，不再有跳跃/浮空状态。
  Fighter.prototype.grounded = function () { return true; };

  // 纵深透视缩放：越靠前（y 越大）角色越大。
  Fighter.prototype.depthScale = function () { return U.depthScale(this.y); };

  Fighter.prototype.body = function () {
    var s = this.depthScale();
    return { x: this.x - 30 * s, y: this.y - 152 * s, w: 60 * s, h: 152 * s };
  };

  Fighter.prototype.hurtbox = function () {
    var s = this.depthScale();
    if (this.state === 'down' || this.state === 'launched' ||
        (this.state === 'ko' && this.koDown)) {
      return { x: this.x - 52 * s, y: this.y - 62 * s, w: 104 * s, h: 62 * s };
    }
    return { x: this.x - 30 * s, y: this.y - 152 * s, w: 60 * s, h: 152 * s };
  };

  Fighter.prototype.hitbox = function (def) {
    var b = def.box;
    var s = this.depthScale();
    var x = this.facing === 1 ? this.x + b.ox * s : this.x - (b.ox + b.w) * s;
    return { x: x, y: this.y + b.oy * s, w: b.w * s, h: b.h * s };
  };

  // ---------------- 更新 ----------------

  Fighter.prototype.update = function (dt, inp) {
    this.animT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.projCd = Math.max(0, this.projCd - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.subCd = Math.max(0, this.subCd - dt);
    this.protectT = Math.max(0, this.protectT - dt);
    this.atkBuf = Math.max(0, this.atkBuf - dt);
    this.blockGlow = Math.max(0, this.blockGlow - dt);
    if (this.castFx) {
      this.castFx.t -= dt;
      if (this.castFx.t <= 0) this.castFx = null;
    }
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
    if (inp.justAtk) this.atkBuf = 0.14;

    // 连续受击计时：两次命中间隔不超过 gap 时持续累计；
    // 间隔超时清零。受击硬直 + 每次命中后的 0.35s 计入「被连击」时间。
    this.hurtWindowT += dt;
    if (this.hurtWindowT > COMBO_GUARD.gap) {
      this.comboLockT = 0;
    } else if (this.state === 'hurt' || this.state === 'launched' || this.hurtWindowT <= 0.35) {
      this.comboLockT += dt;
    }

    // 被击打中唯一能做的事：按替身键脱身（其它输入在受击状态里一律无效）
    if (inp.justSub) this.trySubstitute();

    this.updateFacing(inp);

    for (var i = this.afterimages.length - 1; i >= 0; i--) {
      var a = this.afterimages[i];
      a.life -= dt;
      if (a.life <= 0) this.afterimages.splice(i, 1);
    }

    switch (this.state) {
      case 'ko':
        this.stT += dt;
        break;
      case 'down':
        this.stateT -= dt;
        if (this.stateT <= 0) this.toNeutral(true);
        break;
      case 'hurt':
        this.hurtT -= dt;
        if (this.hurtT <= 0) this.toNeutral(false);
        break;
      case 'launched':
        this.hurtT -= dt;
        if (this.hurtT <= 0) {
          this.state = 'down';
          this.stateT = 0.42;
          this.vx = 0;
          this.vy = 0;
        }
        break;
      case 'dash':
        this.updateDash(dt);
        break;
      case 'sub':
        this.updateSub(dt);
        break;
      case 'attack':
        this.updateAttack(dt);
        break;
      case 'ult':
        this.updateUlt(dt);
        break;
      default:
        this.updateGround(dt, inp);
        break;
    }

    this.updateGuard(dt);
    this.integrate(dt);
  };

  // 朝向：左右方向键决定朝向（技能就朝那个方向放），松手保持当前朝向；
  // 只有 AI 操控的一方会在空闲时自动转向对手（否则它瞄不准玩家）。
  // W/S（纵深移动）不改变左右朝向。
  Fighter.prototype.updateFacing = function (inp) {
    var dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    this.inputDir = dir;
    if (this.state === 'idle' || this.state === 'walk' || this.state === 'block') {
      if (dir !== 0) {
        this.facing = dir;
      } else if (this.autoFace) {
        var opp = this.opponent();
        if (opp) this.facing = opp.x >= this.x ? 1 : -1;
      }
    }
  };

  Fighter.prototype.toNeutral = function (invuln) {
    this.atk = null;
    this.phase = null;
    this.state = 'idle';
    if (invuln) this.invuln = Math.max(this.invuln, 0.35);
  };

  Fighter.prototype.updateGround = function (dt, inp) {
    if (inp.justUlt && this.meter >= MAX_METER) { this.startUlt(); return; }
    if (inp.justDash && this.dashCd <= 0) { this.startDash(); return; }
    if (inp.justProj && this.projCd <= 0) { this.fireProjectile(); return; }
    if (this.atkBuf > 0.02) { this.startAttack('a1'); this.atkBuf = 0; return; }
    if (inp.block) {
      if (this.state !== 'block') { this.state = 'block'; this.blockGlow = 0.2; }
      this.vx = 0;
      this.vy = 0;
      return;
    }

    var dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    var dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (dx !== 0 || dy !== 0) {
      var k = dx !== 0 && dy !== 0 ? 0.7071 : 1;
      this.vx = dx * 322 * k;
      this.vy = dy * 205 * k;
      this.state = 'walk';
      this.walkPhase += dt * 10.5;
    } else {
      this.vx = 0;
      this.vy = 0;
      this.state = 'idle';
    }
  };

  Fighter.prototype.startAttack = function (key) {
    var def = ATTACKS[key];
    this.atk = { def: def, t: 0, hit: false, queued: false };
    this.state = 'attack';
    this.stateT = 0;
    this.castFx = { id: 'atk', t: 0.16 };
    if (def.lunge) this.vx = this.facing * def.lunge * 0.3;
    this.vy = 0;
    this.game.audio.swish(def.heavy);
  };

  Fighter.prototype.updateAttack = function (dt) {
    var a = this.atk;
    if (!a) { this.toNeutral(false); return; }
    var d = a.def;
    var prev = a.t;
    a.t += dt;
    var total = d.startup + d.active + d.recovery;

    if (a.t < d.startup) {
      this.vx = this.facing * (d.lunge || 0) * 0.42;
    } else {
      this.vx *= Math.exp(-9 * dt);
    }

    if (prev < d.startup && a.t >= d.startup) {
      this.game.fx.slash(this.x, this.y, this.facing, this.pal.glow, d.tier);
    }

    if (a.t >= d.startup && a.t <= d.startup + d.active && !a.hit) {
      this.tryHit(d);
    }

    if (this.atkBuf > 0.02 && d.chain && !a.queued && a.t > d.startup) {
      a.queued = true;
      this.atkBuf = 0;
    }

    if (a.t >= total) {
      if (a.queued && d.chain) {
        this.startAttack(d.chain);
      } else {
        this.atk = null;
        this.state = 'idle';
      }
    }
  };

  Fighter.prototype.tryHit = function (d) {
    var opp = this.opponent();
    if (!opp || opp.state === 'ko' || this.game.roundOver) return;
    var box = this.hitbox(d);
    var self = this;
    var decoyHit = this.game.decoys.some(function (decoy) {
      var s = U.depthScale(decoy.y);
      return decoy.pal !== self.pal && Math.abs(self.y - decoy.y) <= U.DEPTH_HIT &&
        U.rects(box, { x: decoy.x - 30 * s, y: decoy.y - 152 * s, w: 60 * s, h: 152 * s });
    });
    if (decoyHit) { this.atk.hit = true; return; }
    // 2.5D：招式同时要求在「同一纵深」附近才命中，前后错开会落空。
    if (Math.abs(this.y - opp.y) > U.DEPTH_HIT) return;
    var hb = opp.hurtbox();
    if (!U.rects(box, hb)) return;
    this.atk.hit = true;
    var cx = (Math.max(box.x, hb.x) + Math.min(box.x + box.w, hb.x + hb.w)) / 2;
    var cy = (Math.max(box.y, hb.y) + Math.min(box.y + box.h, hb.y + hb.h)) / 2;
    this.game.resolveHit(this, opp, d, 'melee', { x: cx, y: cy, w: 1, h: 1 });
  };

  Fighter.prototype.fireProjectile = function () {
    this.projCd = PROJ.cooldown;
    this.castFx = { id: 'proj', t: 0.22 };
    this.game.spawnProjectile(this);
    this.game.audio.shoot();
    var s = this.depthScale();
    this.game.fx.muzzle(this.x + this.facing * 50 * s, this.y - 104 * s, this.pal.glow, this.facing);
    this.vx = -this.facing * 130;
  };

  Fighter.prototype.startDash = function () {
    this.dashCd = DASH.cd;
    this.castFx = { id: 'dash', t: 0.22 };
    this.state = 'dash';
    this.stateT = DASH.vanish;
    this.dashHit = false;
    this.dashHidden = true;
    var opp = this.opponent();
    this.dashSide = opp ? (U.sign(this.x - opp.x) || -this.facing) : -this.facing;
    this.invuln = Math.max(this.invuln, DASH.vanish);
    this.vx = 0;
    this.vy = 0;
    this.afterimageT = 0;
    this.game.audio.dash();
    var s = this.depthScale();
    this.game.fx.ring(this.x, this.y - 60 * s, this.pal.glow, 10, 86 * s, 0.3);
    this.pushAfterimage();
  };

  Fighter.prototype.updateDash = function (dt) {
    this.stateT -= dt;
    this.vx = 0;
    if (this.stateT > 0.000001) return;
    if (!this.dashHidden) { this.toNeutral(false); return; }
    this.dashHidden = false;
    this.stateT += DASH.recover;
    var opp = this.opponent();
    if (opp) {
      this.x = U.clamp(opp.x + this.dashSide * DASH.dist, 70, U.W - 70);
      this.y = U.clamp(opp.y, DEPTH_MIN, DEPTH_MAX);
      this.facing = -this.dashSide;
    }
    var s = this.depthScale();
    this.game.fx.ring(this.x, this.y - 60 * s, this.pal.glow, 10, 86 * s, 0.3);
    this.game.fx.slash(this.x, this.y, this.facing, this.pal.glow, DASH.tier);
    // 再现时只判定一次；无敌、倒地或替身都在落点挥空。
    if (opp && opp.state !== 'down' && opp.state !== 'launched') {
      this.dashHit = this.game.resolveHit(this, opp, DASH, 'dash',
        { x: opp.x, y: opp.y - 95 * s }) !== 'whiff';
    }
  };

  Fighter.prototype.pushAfterimage = function () {
    this.afterimages.push({ x: this.x, y: this.y, facing: this.facing, life: 0.3, max: 0.3 });
  };

  // ---------------- 替身术 ----------------

  // 只有在「被击打」的硬直里才能替身：这就是被打时唯一的反抗手段
  Fighter.prototype.canSubstitute = function () {
    if (this.state !== 'hurt' && this.state !== 'launched' && this.state !== 'down') return false;
    if (this.game.roundOver || this.state === 'ko') return false;
    var opp = this.opponent();
    if (opp && opp.state === 'ult') return false; // 大招演出中不能替身逃走
    return this.subCd <= 0 && this.meter >= SUB.cost;
  };

  Fighter.prototype.trySubstitute = function () {
    if (!this.canSubstitute()) return false;
    this.startSubstitute();
    return true;
  };

  Fighter.prototype.startSubstitute = function () {
    var opp = this.opponent();
    var oldX = this.x;
    var oldY = this.y;

    this.meter -= SUB.cost;
    this.subCd = SUB.cd;
    this.subCount++;
    this.invuln = Math.max(this.invuln, SUB.invuln);
    this.protectT = 0;
    this.comboLockT = 0;
    this.hurtWindowT = 99; // 打断连击计时
    this.hurtT = 0;
    this.atk = null;
    this.phase = null;
    this.state = 'sub';
    this.stateT = SUB.dur;
    this.castFx = { id: 'sub', t: 0.2 };
    this.vy = 0;
    this.vx = 0;

    // 瞬身到对手背后（对手面朝的反方向），并落到对手所在纵深
    var tx = opp ? opp.x - opp.facing * SUB.dist : this.x;
    this.x = U.clamp(tx, 92, U.W - 92);
    if (opp) this.y = U.clamp(opp.y, DEPTH_MIN, DEPTH_MAX);
    this.facing = opp ? (opp.x >= this.x ? 1 : -1) : this.facing;

    this.game.spawnDecoy(this, oldX, oldY);
    this.game.onSubstitute(this, oldX, oldY);
  };

  Fighter.prototype.updateSub = function (dt) {
    this.stateT -= dt;
    this.vx *= Math.exp(-9 * dt);
    if (this.stateT <= 0) this.toNeutral(true);
  };

  // ---------------- 连击保护（时间设定） ----------------

  Fighter.prototype.updateGuard = function () {
    if (this.state === 'ko' || this.game.roundOver) return;
    if (this.protectT > 0) return;
    if (this.comboLockT >= COMBO_GUARD.time) this.triggerGuard();
  };

  Fighter.prototype.triggerGuard = function () {
    if (this.state === 'ko' || this.game.roundOver) return; // KO 后不再「护体复活」
    var opp = this.opponent();
    var dir = opp ? (U.sign(this.x - opp.x) || 1) : 1;

    this.comboLockT = 0;
    this.hurtWindowT = 99;
    this.hurtT = 0;
    this.atk = null;
    this.phase = null;
    this.protectT = COMBO_GUARD.invuln;
    this.invuln = Math.max(this.invuln, COMBO_GUARD.invuln);
    this.vx = dir * 320; // 护体震开
    this.vy = 0;
    this.state = 'idle';

    this.game.onComboGuard(this, opp);
  };

  Fighter.prototype.startUlt = function () {
    this.meter = 0;
    this.state = 'ult';
    this.phase = 'charge';
    this.ultT = 0;
    this.stateT = 0;
    this.castFx = { id: 'ult', t: 0.6 };
    this.invuln = 3.0;
    this.vx = 0;
    this.vy = 0;
    this.ultTickT = 0;
    this.ultBurst = 0;
    this.game.onUltStart(this);
  };

  Fighter.prototype.updateUlt = function (dt) {
    this.ultT += dt;
    this.vx = 0;
    if (this.phase === 'charge') {
      this.ultBurst -= dt;
      if (this.ultBurst <= 0) {
        this.ultBurst = 0.05;
        this.game.fx.aura(this.x, this.y, this.pal.glow);
      }
      if (this.ultT >= ULT.charge) {
        this.phase = 'cast';
        this.ultT = 0;
        this.ultTickT = 0.03;
        this.game.onUltCast(this);
      }
    } else if (this.phase === 'cast') {
      this.ultTickT -= dt;
      if (this.ultTickT <= 0 && this.ultT < 1.08) {
        this.ultTickT += ULT.interval;
        this.game.onUltTick(this);
        var k;
        for (k = 0; k < 4; k++) {
          this.game.fx.swordRain(U.clamp(this.rainArea.x + U.rand(-ULT.rainHalfWidth, ULT.rainHalfWidth), 30, U.W - 30),
            U.rand(0.01, 0.12), this.pal.sword, this.rainArea.y);
        }
      }
      if (this.ultT >= ULT.cast) {
        this.phase = 'recover';
        this.ultT = 0;
        this.game.onUltFinish(this);
      }
    } else if (this.phase === 'recover') {
      if (this.ultT >= ULT.recover) {
        this.state = 'idle';
        this.phase = null;
      }
    }
  };

  // ---------------- 受击 ----------------

  Fighter.prototype.blockHit = function (def, source, hitPoint) {
    var chip = def.chip == null ? Math.max(1, Math.round((def.dmg || 0) * 0.14)) : def.chip;
    this.hp = Math.max(0, this.hp - chip);
    this.meter = Math.min(MAX_METER, this.meter + 2);
    this.flash = 0.05;
    this.blockGlow = 0.18;
    var opp = this.opponent();
    if (!def.light) this.vx = (opp && opp.x > this.x ? -1 : 1) * 95;
    this.game.onBlock(this, def, hitPoint);
    return chip;
  };

  Fighter.prototype.takeHit = function (att, def, source, hitPoint) {
    if (this.state === 'ko') return false;
    if (this.invuln > 0) return false;
    var dmg = def.dmg || 1;
    this.hp = Math.max(0, this.hp - dmg);
    this.meter = Math.min(MAX_METER, this.meter + dmg * 0.06);
    if (att) att.meter = Math.min(MAX_METER, att.meter + dmg * 0.10);
    this.flash = 0.13;
    this.combo = 0;
    this.comboT = 0;
    this.hurtWindowT = 0; // 重新开始「连续被击打」的时间窗口
    // 保留原有大招不累计连击保护的规则，落剑仍可在硬直间隙格挡。
    if (source === 'rain' || source === 'ult') this.comboLockT = 0;
    this.blockGlow = 0;
    var dir = att ? (U.sign(this.x - att.x) || att.facing) : 1;
    if (def.kb !== 0) {
      this.vx = dir * (def.kb == null ? 120 : def.kb);
      this.vy = 0;
    }
    if (def.launch) {
      // 仍然保留「第三段击倒」的演出：滑退 → 倒地 → 起身
      this.state = 'launched';
      this.hurtT = def.hitstun;
      this.game.fx.dust(this.x, -dir, this.y);
    } else {
      this.state = 'hurt';
      this.hurtT = def.hitstun == null ? 0.2 : def.hitstun;
    }
    this.game.onHit(att, this, def, hitPoint);
    return true;
  };

  Fighter.prototype.integrate = function (dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.state === 'idle' || this.state === 'hurt' || this.state === 'block' ||
        this.state === 'down' || this.state === 'launched' || this.state === 'ko') {
      this.vx *= Math.exp(-11 * dt);
      this.vy = 0;
    } else if (this.state === 'attack' || this.state === 'ult' || this.state === 'sub') {
      this.vx *= Math.exp(-9 * dt);
      this.vy = 0;
    }

    this.x = U.clamp(this.x, 70, U.W - 70);
    this.y = U.clamp(this.y, DEPTH_MIN, DEPTH_MAX);
    if (this.state === 'ko') this.koDown = true;
  };

  // ---------------- 绘制 ----------------

  Fighter.prototype.draw = function (c) {
    var i, a;
    for (i = 0; i < this.afterimages.length; i++) {
      a = this.afterimages[i];
      this.drawGhost(c, a);
    }

    if (this.state === 'dash' && this.dashHidden) return;

    var s = this.depthScale();
    c.save();
    c.globalAlpha = 0.4;
    c.fillStyle = '#000000';
    c.beginPath();
    c.ellipse(this.x, this.y + 6, 46 * s, 10 * s, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();

    // 出招朝向指示：脚前的小箭标，按住方向键时会变亮
    if (this.game.state !== 'menu' && this.state !== 'ko' && this.state !== 'down') {
      var aimPulse = 0.5 + 0.5 * Math.sin(this.animT * 4.2);
      var aimA = (this.inputDir !== 0 ? 0.5 : 0.24) + aimPulse * 0.1;
      c.save();
      c.translate(this.x + this.facing * 42 * s, this.y - 5 * s);
      c.scale(this.facing * s, s);
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = aimA;
      c.strokeStyle = this.pal.glow;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.lineWidth = 2.2;
      c.beginPath();
      c.moveTo(-8, -7);
      c.lineTo(3, 0);
      c.lineTo(-8, 7);
      c.stroke();
      c.globalAlpha = aimA * 0.35;
      c.lineWidth = 6;
      c.stroke();
      c.restore();
    }

    if (this.meter >= MAX_METER && this.state !== 'ult') {
      var pulse = 0.5 + 0.5 * Math.sin(this.animT * 6);
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.12 + pulse * 0.14;
      c.strokeStyle = this.pal.glow;
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(this.x, this.y - 1, (54 + pulse * 10) * s, (15 + pulse * 4) * s, 0, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }

    if (this.protectT > 0 && this.state !== 'ko') this.drawGuard(c);
    else if (this.comboLockT > 0.62 && this.state !== 'ko') this.drawGuardWarn(c);

    this.drawBody(c);
  };

  // 连击保护生效：护体气罩
  Fighter.prototype.drawGuard = function (c) {
    var pulse = 0.5 + 0.5 * Math.sin(this.animT * 12);
    var s = this.depthScale();
    c.save();
    c.globalCompositeOperation = 'lighter';
    // 光罩
    var rg = c.createRadialGradient(this.x, this.y - 86 * s, 6, this.x, this.y - 86 * s, 100 * s);
    rg.addColorStop(0, 'rgba(160, 235, 255, 0.05)');
    rg.addColorStop(0.72, 'rgba(160, 235, 255, 0.22)');
    rg.addColorStop(1, 'rgba(160, 235, 255, 0)');
    c.globalAlpha = 0.5 + pulse * 0.3;
    c.fillStyle = rg;
    c.beginPath();
    c.ellipse(this.x, this.y - 86 * s, 66 * s, 102 * s, 0, 0, Math.PI * 2);
    c.fill();
    // 外圈 + 内圈
    c.globalAlpha = 0.32 + pulse * 0.22;
    c.strokeStyle = '#bfefff';
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(this.x, this.y - 86 * s, 54 * s, 94 * s, 0, 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 0.16 + pulse * 0.12;
    c.lineWidth = 1.5;
    c.beginPath();
    c.ellipse(this.x, this.y - 86 * s, 62 * s, 104 * s, 0, 0, Math.PI * 2);
    c.stroke();
    // 护字
    c.globalAlpha = 0.55 + pulse * 0.35;
    c.fillStyle = '#d8f6ff';
    c.font = "bold 17px 'Songti SC','STKaiti','KaiTi','SimSun',serif";
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('护', this.x, this.y - 198 * s - pulse * 4);
    c.restore();
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
  };

  // 连续被打太久：头顶「护」字预警
  Fighter.prototype.drawGuardWarn = function (c) {
    var k = U.clamp((this.comboLockT - 0.62) / (COMBO_GUARD.time - 0.62), 0, 1);
    var pulse = 0.5 + 0.5 * Math.sin(this.animT * 14);
    var s = this.depthScale();
    c.save();
    c.globalAlpha = 0.16 + k * 0.52 + pulse * 0.1;
    c.fillStyle = '#cfeaff';
    c.font = "bold 15px 'Songti SC','STKaiti','KaiTi','SimSun',serif";
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = '#9fe8ff';
    c.shadowBlur = 12;
    c.fillText('护', this.x, this.y - 190 * s);
    c.restore();
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
  };

  Fighter.prototype.drawGhost = function (c, a) {
    var k = U.clamp(a.life / a.max, 0, 1);
    var s = U.depthScale(a.y);
    c.save();
    c.translate(a.x, a.y);
    c.scale(a.facing * s, s);
    c.globalAlpha = k * 0.3;
    c.fillStyle = this.pal.trim;
    c.beginPath();
    c.moveTo(-22, -60);
    c.lineTo(-26, -114);
    c.lineTo(-10, -130);
    c.lineTo(12, -130);
    c.lineTo(26, -114);
    c.lineTo(22, -60);
    c.closePath();
    c.fill();
    c.beginPath();
    c.arc(3, -146, 15, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = this.pal.glow;
    c.globalAlpha = k * 0.5;
    c.fillRect(6, -152, 12, 3);
    c.restore();
  };

  Fighter.prototype.drawBody = function (c) {
    var P = this.pal;
    var st = this.state;
    var t = this.animT;
    var flash = this.flash > 0 && Math.floor(this.flash * 46) % 2 === 0;
    var robe = flash ? '#ffffff' : P.robe;
    var robe2 = flash ? '#f0f0f0' : P.robe2;
    var trim = flash ? '#ffffff' : P.trim;
    var glow = flash ? '#ffffff' : P.glow;
    var s = this.depthScale();

    c.save();
    c.translate(this.x, this.y);
    c.scale(this.facing * s, s);

    // 倒地/被击倒/被击退倒地：整体旋转
    var lying = (st === 'down') || (st === 'launched') || (st === 'ko' && this.koDown);
    if (lying) {
      c.translate(0, -6);
      c.rotate(-1.28);
    }

    var lean = 0;
    if (st === 'walk') lean = 0.05;
    if (st === 'dash') lean = 0.32;
    if (st === 'hurt') lean = -0.14;
    if (st === 'attack') lean = 0.08;
    if (st === 'ult') lean = 0.02;
    c.rotate(lean);

    var bob = Math.sin(t * 2.4) * 1.5;
    var walkSw = st === 'walk' ? Math.sin(this.walkPhase * 2) : 0;

    // 披风/围巾（身后）
    c.save();
    c.globalAlpha = 0.32;
    c.fillStyle = trim;
    c.beginPath();
    c.moveTo(-8, -126);
    var sw = Math.sin(t * 3.6) * 5;
    c.quadraticCurveTo(-34 - sw, -116 + sw, -48 - Math.sin(t * 2.2) * 8, -92 + Math.sin(t * 4) * 6);
    c.quadraticCurveTo(-32, -104, -10, -108);
    c.closePath();
    c.fill();
    c.restore();

    // 腿
    c.lineCap = 'round';
    var hipY = -72 + bob * 0.4;
    var fLx, fRx, fLy, fRy;
    fLx = -16 + walkSw * 14; fLy = 0;
    fRx = 16 - walkSw * 14; fRy = 0;
    c.strokeStyle = robe2;
    c.lineWidth = 15;
    c.beginPath();
    c.moveTo(-7, hipY);
    c.lineTo(fLx, fLy - 4);
    c.moveTo(7, hipY);
    c.lineTo(fRx, fRy - 4);
    c.stroke();
    // 靴子
    c.strokeStyle = 'rgba(190, 205, 225, 0.35)';
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(fLx - 4, fLy - 3);
    c.lineTo(fLx + 9, fLy - 3);
    c.moveTo(fRx - 4, fRy - 3);
    c.lineTo(fRx + 9, fRy - 3);
    c.stroke();

    // 袍身
    var flare = 1;
    c.beginPath();
    c.moveTo(-22 * flare, -60 + bob);
    c.lineTo(-27 * flare, -110 + bob);
    c.lineTo(-13, -128 + bob);
    c.lineTo(13, -128 + bob);
    c.lineTo(27 * flare, -110 + bob);
    c.lineTo(22 * flare, -60 + bob);
    c.closePath();
    c.fillStyle = robe;
    c.fill();
    c.strokeStyle = 'rgba(180, 200, 225, 0.18)';
    c.lineWidth = 1.6;
    c.stroke();

    // 衣领
    c.fillStyle = 'rgba(230, 238, 250, 0.14)';
    c.beginPath();
    c.moveTo(-10, -126 + bob);
    c.lineTo(10, -126 + bob);
    c.lineTo(0, -110 + bob);
    c.closePath();
    c.fill();

    // 腰带
    c.fillStyle = trim;
    c.globalAlpha = flash ? 1 : 0.85;
    c.fillRect(-23, -82 + bob, 46, 7);
    c.globalAlpha = 1;

    // 腰带飘带
    c.strokeStyle = trim;
    c.globalAlpha = 0.55;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(4, -77 + bob);
    c.quadraticCurveTo(18 + Math.sin(t * 4) * 5, -52, 12 + Math.sin(t * 3) * 6, -26);
    c.stroke();
    c.globalAlpha = 1;

    var shoulderY = -116 + bob;
    var handX = 12, handY = -94 + bob;
    var swordAng = null;
    var swordLen = 92;
    var extending = false;

    if (st === 'attack' && this.atk) {
      var d = this.atk.def;
      var swingDur = d.startup + d.active;
      var pr = U.clamp(this.atk.t / swingDur, 0, 1);
      var ang = U.lerp(-2.35, 0.62, U.easeOutCubic(pr));
      handX = 10 + Math.cos(ang) * 30;
      handY = shoulderY + Math.sin(ang) * 30;
      swordAng = ang;
      extending = true;
    } else if (st === 'dash') {
      handX = 34; handY = shoulderY + 10; swordAng = 0.06;
      extending = true;
    } else if (st === 'ult') {
      handX = 10; handY = -158 + bob;
      swordAng = -1.35;
      extending = true;
    } else if (st === 'block') {
      handX = 20; handY = -102 + bob;
    } else if (st === 'hurt') {
      handX = -2; handY = -128 + bob;
    }

    // 后手
    c.strokeStyle = robe;
    c.lineWidth = 11;
    c.beginPath();
    c.moveTo(-8, shoulderY);
    c.lineTo(-22, -92 + bob);
    c.stroke();

    // 前手
    c.strokeStyle = robe;
    c.lineWidth = 11;
    c.beginPath();
    c.moveTo(8, shoulderY);
    c.lineTo(handX, handY);
    c.stroke();

    // 剑
    if (swordAng !== null) {
      var sx = handX, sy = handY;
      var ex = sx + Math.cos(swordAng) * swordLen;
      var ey = sy + Math.sin(swordAng) * swordLen;
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.strokeStyle = glow;
      c.globalAlpha = extending ? 0.5 : 0.2;
      c.lineWidth = 9;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(ex, ey);
      c.stroke();
      c.restore();
      c.strokeStyle = '#c7d3e2';
      c.lineWidth = 3.4;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(ex, ey);
      c.stroke();
      // 剑格
      c.strokeStyle = trim;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(sx + Math.cos(swordAng + 1.57) * 7, sy + Math.sin(swordAng + 1.57) * 7);
      c.lineTo(sx + Math.cos(swordAng - 1.57) * 7, sy + Math.sin(swordAng - 1.57) * 7);
      c.stroke();
    } else if (!lying) {
      // 背剑
      c.strokeStyle = 'rgba(180, 195, 215, 0.55)';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(-20, -88 + bob);
      c.lineTo(16, -162 + bob);
      c.stroke();
      c.strokeStyle = trim;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-14, -96 + bob);
      c.lineTo(-8, -106 + bob);
      c.stroke();
    }

    // 头
    var headX = 3, headY = -146 + bob;
    c.fillStyle = robe2;
    c.beginPath();
    c.arc(headX, headY, 14, 0, Math.PI * 2);
    c.fill();

    // 头发 / 发髻
    c.fillStyle = flash ? '#ffffff' : '#0a0e15';
    c.beginPath();
    c.arc(headX - 3, headY - 15, 7, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = trim;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(headX - 10, headY - 7);
    c.lineTo(headX - 20, headY - 14);
    c.stroke();

    // 头带
    c.fillStyle = trim;
    c.globalAlpha = 0.9;
    c.fillRect(headX - 12, headY - 6, 26, 4);
    c.globalAlpha = 1;

    // 发光眼
    c.save();
    c.shadowColor = glow;
    c.shadowBlur = 10;
    c.fillStyle = flash ? '#ffffff' : '#fff3da';
    c.fillRect(headX + 5, headY - 1, 8, 2.6);
    c.restore();

    // 格挡气盾
    if (st === 'block') {
      var bg = 0.35 + this.blockGlow * 2;
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = U.clamp(bg, 0.3, 0.85);
      c.strokeStyle = trim;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(18, -95 + bob, 54, -1.35, 1.35);
      c.stroke();
      c.globalAlpha = 0.14;
      c.fillStyle = trim;
      c.beginPath();
      c.arc(18, -95 + bob, 54, -1.35, 1.35);
      c.lineTo(18, -95 + bob);
      c.fill();
      c.restore();
    }

    // 大招蓄力光环
    if (st === 'ult' && this.phase === 'charge') {
      var k = U.clamp(this.ultT / ULT.charge, 0, 1);
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.25 + k * 0.35;
      c.strokeStyle = glow;
      c.lineWidth = 3;
      c.beginPath();
      c.ellipse(0, -4, 40 + k * 46, 12 + k * 16, 0, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }

    c.restore();
  };

  g.Fighter = Fighter;
  g.ATTACKS = ATTACKS;
  g.IMPACTS = IMPACTS;
  g.PROJ = PROJ;
  g.DASH = DASH;
  g.ULT = ULT;
  g.SUB = SUB;
  g.COMBO_GUARD = COMBO_GUARD;
  g.MAX_METER = MAX_METER;
})(window);
