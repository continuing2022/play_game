(function (g) {
  'use strict';

  var U = g.U;

  function AI(game, me, opp) {
    this.game = game;
    this.me = me;
    this.opp = opp;
    this.plan = 'approach';
    this.planT = 0;
    this.pulseT = 0;
    this.used = {};
    this.strafeDir = 1;
    this.t = 0;
  }

  AI.prototype.reset = function () {
    this.plan = 'approach';
    this.planT = 0;
    this.pulseT = 0;
    this.used = {};
    this.strafeDir = 1;
    this.t = 0;
  };

  AI.prototype.update = function (dt) {
    var me = this.me;
    var opp = this.opp;
    this.t += dt;
    this.planT -= dt;
    this.pulseT -= dt;

    var dx = opp.x - me.x;
    var dy = opp.y - me.y;
    var dist = Math.abs(dx);
    var gap = Math.abs(dy);

    // 快速反应：对手贴近出招时，有一定概率立刻格挡（同一纵深附近才有效）
    if (this.plan !== 'block' && me.state !== 'attack' &&
        me.state !== 'hurt' && me.state !== 'ult' &&
        opp.state === 'attack' && dist < 190 && gap < 70) {
      if (Math.random() < dt * 3.2) {
        this.plan = 'block';
        this.planT = U.rand(0.2, 0.36);
        this.used = {};
      }
    }

    if (this.planT <= 0) this.choose(dist, gap);

    var inp = {
      left: false, right: false, up: false, down: false, block: false,
      justAtk: false, justProj: false, justDash: false, justUlt: false, justSub: false
    };
    var hdir = dx >= 0 ? 1 : -1;
    var vdir = dy >= 0 ? 1 : -1;

    switch (this.plan) {
      case 'approach':
        if (dist > 72) inp[hdir > 0 ? 'right' : 'left'] = true;
        if (gap > 18) inp[vdir > 0 ? 'down' : 'up'] = true;
        break;
      case 'retreat':
        if (dist < 560) inp[hdir > 0 ? 'left' : 'right'] = true;
        if (gap > 26) inp[vdir > 0 ? 'up' : 'down'] = true;
        break;
      case 'strafe':
        inp[this.strafeDir > 0 ? 'down' : 'up'] = true;
        if (dist > 170) inp[hdir > 0 ? 'right' : 'left'] = true;
        break;
      case 'block':
        inp.block = true;
        break;
      case 'attack':
        if (dist > 108) inp[hdir > 0 ? 'right' : 'left'] = true;
        if (gap > 24) inp[vdir > 0 ? 'down' : 'up'] = true;
        if (dist < 128 && gap < (U.DEPTH_HIT - 6) && this.pulseT <= 0) {
          inp.justAtk = true;
          this.pulseT = U.rand(0.14, 0.19);
        }
        break;
      case 'proj':
        if (gap > 32) inp[vdir > 0 ? 'down' : 'up'] = true;
        else if (dist > 150 && this.once('proj')) inp.justProj = true;
        break;
      case 'dash':
        if (gap > 44) inp[vdir > 0 ? 'down' : 'up'] = true;
        else if (dist > 130 && this.once('dash')) inp.justDash = true;
        break;
      case 'ult':
        if (this.once('ult')) inp.justUlt = true;
        break;
      default:
        break;
    }

    // 被连击时用替身术脱身：血少或被打得久时更积极
    if (me.state === 'hurt' || me.state === 'launched' || me.state === 'down') {
      if (me.subCd <= 0 && me.meter >= g.SUB.cost) {
        var escape = me.comboLockT > 0.75 ||
          (me.hp < 400 && me.comboLockT > 0.3) ||
          (me.meter >= 65 && Math.random() < dt * 2.2);
        if (escape) inp.justSub = true;
      }
    }
    return inp;
  };

  AI.prototype.once = function (key) {
    if (this.used[key]) return false;
    this.used[key] = true;
    return true;
  };

  AI.prototype.choose = function (dist, gap) {
    var me = this.me;
    var opp = this.opp;
    this.used = {};
    var lowHp = me.hp < 320;
    var plan = 'approach';

    if (me.meter >= g.MAX_METER && dist < 660 && Math.random() < (lowHp ? 0.8 : 0.6)) {
      plan = 'ult';
    } else if (dist > 430) {
      if (me.projCd <= 0 && gap < 60 && Math.random() < 0.6) plan = 'proj';
      else if (me.dashCd <= 0 && gap < 55 && Math.random() < 0.16) plan = 'dash';
      else plan = 'approach';
    } else if (dist > 210) {
      if (me.projCd <= 0 && gap < 60 && Math.random() < 0.34) plan = 'proj';
      else if (me.dashCd <= 0 && gap < 55 && Math.random() < 0.25) plan = 'dash';
      else plan = 'approach';
    } else if (gap > 55) {
      // 前后错开时先对齐纵深，再考虑出招
      plan = Math.random() < 0.72 ? 'approach' : 'strafe';
    } else {
      var rr = Math.random();
      if (rr < (lowHp ? 0.7 : 0.52)) plan = 'attack';
      else if (rr < 0.72) plan = 'block';
      else if (rr < 0.84) plan = 'retreat';
      else plan = 'strafe';
    }

    // 对手举盾时偶尔换个思路
    if (opp.state === 'block' && plan === 'attack' && Math.random() < 0.4) plan = 'retreat';

    this.plan = plan;
    if (plan === 'strafe') this.strafeDir = Math.random() < 0.5 ? -1 : 1;

    if (plan === 'attack') this.planT = U.rand(0.5, 0.8);
    else if (plan === 'block') this.planT = U.rand(0.25, 0.4);
    else if (plan === 'proj') this.planT = U.rand(0.3, 0.48);
    else this.planT = U.rand(0.18, 0.34);
    this.pulseT = 0;
  };

  g.AI = AI;
})(window);
