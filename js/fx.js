(function (g) {
  'use strict';

  var U = g.U;
  var GROUND = U.GROUND;

  function FXSystem() {
    this.reset();
  }

  FXSystem.prototype.reset = function () {
    this.parts = [];
    this.slashes = [];
    this.texts = [];
    this.swords = [];
    this.rings = [];
  };

  FXSystem.prototype.burst = function (x, y, opt) {
    opt = opt || {};
    var n = opt.n || 10;
    var speed = opt.speed || 260;
    var life = opt.life || 0.4;
    var size = opt.size || 4;
    for (var i = 0; i < n; i++) {
      var a = U.rand(0, Math.PI * 2);
      var sp = U.rand(speed * 0.25, speed);
      this.parts.push({
        x: x + U.rand(-3, 3),
        y: y + U.rand(-3, 3),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (opt.up || 0),
        life: U.rand(life * 0.45, life),
        max: life,
        size: U.rand(size * 0.45, size),
        color: opt.color || '#ffffff',
        gravity: opt.gravity == null ? 620 : opt.gravity,
        drag: 2.4,
        mode: 'spark'
      });
    }
    this.cap();
  };

  FXSystem.prototype.dust = function (x, dir, y) {
    var base = y == null ? GROUND : y;
    for (var i = 0; i < 7; i++) {
      this.parts.push({
        x: x + U.rand(-16, 16),
        y: base - U.rand(0, 10),
        vx: U.rand(-50, 50) - (dir || 0) * 40,
        vy: -U.rand(20, 90),
        life: U.rand(0.25, 0.55),
        max: 0.55,
        size: U.rand(6, 16),
        color: 'rgba(160, 178, 200, 0.30)',
        gravity: -30,
        drag: 3.2,
        mode: 'smoke'
      });
    }
    this.cap();
  };

  FXSystem.prototype.aura = function (x, y, color) {
    for (var i = 0; i < 3; i++) {
      this.parts.push({
        x: x + U.rand(-54, 54),
        y: y - U.rand(0, 150),
        vx: U.rand(-26, 26),
        vy: -U.rand(80, 230),
        life: U.rand(0.3, 0.65),
        max: 0.65,
        size: U.rand(2, 5),
        color: color,
        gravity: -90,
        drag: 0.8,
        mode: 'spark'
      });
    }
    this.cap();
  };

  FXSystem.prototype.muzzle = function (x, y, color, dir) {
    this.burst(x + (dir || 0) * 10, y, { n: 8, color: color, speed: 200, life: 0.22, size: 5 });
  };

  FXSystem.prototype.slash = function (x, y, facing, color, heavy) {
    this.slashes.push({
      x: x + facing * 16,
      y: y - 104,
      facing: facing,
      color: color,
      life: heavy ? 0.24 : 0.17,
      max: heavy ? 0.24 : 0.17,
      radius: heavy ? 128 : 98,
      width: heavy ? 18 : 11,
      angle: U.rand(-0.5, -0.15),
      spin: 1.5,
      heavy: !!heavy
    });
  };

  FXSystem.prototype.swordRain = function (x, delay, color) {
    this.swords.push({
      x: x,
      y: -120 + U.rand(-40, 0),
      vy: U.rand(1600, 2100),
      rot: U.rand(-0.35, 0.35),
      vr: U.rand(-0.8, 0.8),
      delay: delay || 0,
      color: color || '#ffe0ab',
      len: U.rand(96, 138)
    });
  };

  FXSystem.prototype.ring = function (x, y, color, r0, r1, life) {
    this.rings.push({ x: x, y: y, color: color, r0: r0, r1: r1, life: life, max: life });
    this.cap();
  };

  FXSystem.prototype.text = function (x, y, str, color, size) {
    this.texts.push({
      x: x + U.rand(-8, 8),
      y: y,
      str: str,
      color: color || '#ffffff',
      life: 0.85,
      max: 0.85,
      size: size || 24,
      vy: -74
    });
  };

  FXSystem.prototype.cap = function () {
    var overflow = this.parts.length - 760;
    if (overflow > 0) this.parts.splice(0, overflow);
  };

  FXSystem.prototype.update = function (dt) {
    var i, p;
    for (i = this.parts.length - 1; i >= 0; i--) {
      p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.vx -= p.vx * p.drag * dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.mode === 'spark' && p.y > GROUND) { p.vy *= -0.35; p.y = GROUND; p.vx *= 0.7; }
    }
    for (i = this.slashes.length - 1; i >= 0; i--) {
      this.slashes[i].life -= dt;
      if (this.slashes[i].life <= 0) this.slashes.splice(i, 1);
    }
    for (i = this.texts.length - 1; i >= 0; i--) {
      var t = this.texts[i];
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= Math.exp(-3 * dt);
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    for (i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].life -= dt;
      if (this.rings[i].life <= 0) this.rings.splice(i, 1);
    }
    for (i = this.swords.length - 1; i >= 0; i--) {
      var s = this.swords[i];
      if (s.delay > 0) { s.delay -= dt; continue; }
      s.y += s.vy * dt;
      s.rot += s.vr * dt;
      if (s.y > GROUND + 24) {
        this.burst(s.x, GROUND - 6, { n: 12, color: s.color, speed: 320, life: 0.34, size: 5, up: 60 });
        this.ring(s.x, GROUND - 10, 'rgba(180, 215, 255, 0.5)', 6, heavyRingRadius(), 0.3);
        this.swords.splice(i, 1);
      }
    }
  };

  function heavyRingRadius() { return 46; }

  FXSystem.prototype.draw = function (c) {
    var i, p;

    // 烟尘
    for (i = 0; i < this.parts.length; i++) {
      p = this.parts[i];
      if (p.mode !== 'smoke') continue;
      var k = p.life / p.max;
      c.globalAlpha = k * 0.55;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, p.size * (1.6 - k * 0.6), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    c.save();
    c.globalCompositeOperation = 'lighter';

    // 冲击环
    for (i = 0; i < this.rings.length; i++) {
      var r = this.rings[i];
      var pr = 1 - r.life / r.max;
      c.globalAlpha = (1 - pr) * 0.7;
      c.strokeStyle = r.color;
      c.lineWidth = 2 + (1 - pr) * 4;
      c.beginPath();
      c.arc(r.x, r.y, U.lerp(r.r0, r.r1, U.easeOutCubic(pr)), 0, Math.PI * 2);
      c.stroke();
    }

    // 剑雨
    for (i = 0; i < this.swords.length; i++) {
      var s = this.swords[i];
      if (s.delay > 0) continue;
      c.save();
      c.translate(s.x, s.y);
      c.rotate(s.rot);
      c.globalAlpha = 0.95;
      c.strokeStyle = s.color;
      c.lineWidth = 2.8;
      c.beginPath();
      c.moveTo(0, -s.len);
      c.lineTo(0, 2);
      c.stroke();
      c.globalAlpha = 0.3;
      c.lineWidth = 14;
      c.strokeStyle = '#ffd9a0';
      c.beginPath();
      c.moveTo(0, -s.len);
      c.lineTo(0, 2);
      c.stroke();
      // 剑尖朝下
      c.globalAlpha = 1;
      c.fillStyle = '#fff3dd';
      c.beginPath();
      c.moveTo(-3.4, 2);
      c.lineTo(3.4, 2);
      c.lineTo(0, 12);
      c.closePath();
      c.fill();
      // 剑格
      c.strokeStyle = '#ffe6b8';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(-7, -s.len + 14);
      c.lineTo(7, -s.len + 14);
      c.stroke();
      c.restore();
    }

    // 斩击弧光
    for (i = 0; i < this.slashes.length; i++) {
      var sl = this.slashes[i];
      var q = 1 - sl.life / sl.max;
      c.save();
      c.translate(sl.x, sl.y);
      c.scale(sl.facing, 1);
      c.rotate(sl.angle - sl.spin * q);
      c.globalAlpha = Math.pow(1 - q, 0.7);
      c.lineCap = 'round';

      c.strokeStyle = sl.color;
      c.lineWidth = sl.width * (1 - q * 0.5);
      c.beginPath();
      c.arc(0, 0, sl.radius, -1.15, 1.15);
      c.stroke();

      c.strokeStyle = '#ffffff';
      c.lineWidth = Math.max(2, sl.width * 0.3);
      c.beginPath();
      c.arc(0, 0, sl.radius, -1.0, 1.0);
      c.stroke();
      c.restore();
    }

    // 火花
    for (i = 0; i < this.parts.length; i++) {
      p = this.parts[i];
      if (p.mode === 'smoke') continue;
      var a = U.clamp(p.life / p.max, 0, 1);
      c.globalAlpha = a;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, Math.max(0.4, p.size * (0.35 + a * 0.65)), 0, Math.PI * 2);
      c.fill();
    }

    c.restore();
    c.globalAlpha = 1;

    // 伤害数字
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (i = 0; i < this.texts.length; i++) {
      var tx = this.texts[i];
      var ta = U.clamp(tx.life / tx.max, 0, 1);
      c.globalAlpha = ta;
      c.font = 'bold ' + tx.size + "px 'Songti SC', 'STKaiti', serif";
      c.fillStyle = tx.color;
      c.fillText(tx.str, tx.x, tx.y);
    }
    c.globalAlpha = 1;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
  };

  g.FXSystem = FXSystem;
})(window);
