(function (g) {
  'use strict';

  var U = g.U;
  var MAX_METER = g.MAX_METER;
  var ULT = g.ULT;

  var PALETTES = [
    { name: '墨影', tag: 'P1', trim: '#e05a4e', glow: '#ff8a6b', rgb: '255, 138, 107', sword: '#ffe0ab', robe: '#151a24', robe2: '#0d1219' },
    { name: '影从', tag: 'P2', trim: '#4fb8c9', glow: '#7fe6ee', rgb: '127, 230, 238', sword: '#c8f5ff', robe: '#141c22', robe2: '#0c1216' }
  ];

  var P1_KEYS = { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS', block: 'KeyQ', atk: 'KeyJ', proj: 'KeyK', dash: 'KeyL', ult: 'KeyU', sub: 'KeyI' };
  var P2_KEYS = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', block: 'ShiftRight', atk: 'KeyM', proj: 'Comma', dash: 'Period', ult: 'Slash', sub: 'KeyN' };

  var EMPTY = {
    left: false, right: false, up: false, down: false, block: false,
    justAtk: false, justProj: false, justDash: false, justUlt: false, justSub: false
  };

  var MENU_BUTTONS = [
    { mode: 1, cx: 640, cy: 374, w: 380, h: 62, title: '开始对战', sub: '单人 · 挑战 AI' },
    { mode: 2, cx: 640, cy: 452, w: 380, h: 62, title: '双人对战', sub: '同一键盘 · 各守一边' }
  ];

  var RESULT_BTN = { cx: 640, cy: 500, w: 230, h: 56, title: '再 战', sub: '按 R' };

  // 技能栏：顺序固定，HUD 与冷却展示共用
  var SKILLS = [
    { id: 'atk', name: '连斩', p1: 'J', p2: 'M' },
    { id: 'proj', name: '剑气', p1: 'K', p2: ',' },
    { id: 'dash', name: '残影步', p1: 'L', p2: '.' },
    { id: 'ult', name: '万剑归宗', p1: 'U', p2: '/' },
    { id: 'sub', name: '替身术', p1: 'I', p2: 'N' }
  ];

  var KNOWN = {};
  (function () {
    var arr = [P1_KEYS, P2_KEYS], i, k;
    for (i = 0; i < arr.length; i++) {
      for (k in arr[i]) KNOWN[arr[i][k]] = true;
    }
    ['Enter', 'Space', 'Escape', 'KeyR', 'KeyB', 'Digit1', 'Digit2'].forEach(function (c) { KNOWN[c] = true; });
  })();

  function font(size, weight) {
    return (weight || 'bold') + ' ' + size + "px 'Songti SC','STKaiti','KaiTi','SimSun',serif";
  }

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ============================ Game ============================

  function Game(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.audio = new g.AudioSys();
    this.bg = new g.Background();
    this.fx = new g.FXSystem();
    this.fighters = [
      new g.Fighter(this, 0, PALETTES[0]),
      new g.Fighter(this, 1, PALETTES[1])
    ];
    this.projectiles = [];
    this.decoys = [];
    this.ai = [null, null];
    this.mode = 1;
    this.demo = false;
    this.still = false;
    this.paused = false;
    this.demoSeconds = 0;
    this.scenario = null;
    try {
      var qs = location.search || '';
      this.demo = /(?:^|[?&])demo\b/.test(qs);
      this.still = /(?:^|[?&])still\b/.test(qs);
      var dm = /demo=([\d.]+)/.exec(qs);
      this.demoSeconds = dm ? parseFloat(dm[1]) : 0;
      var sm = /scenario=(\w+)/.exec(qs);
      this.scenario = sm ? sm[1] : null;
    } catch (e) {}

    this.state = 'menu';
    this.time = 0;
    this.last = 0;
    this.acc = 0;
    this.timer = 90;
    this.fullTime = 90;
    this.timeScale = 1;
    this.hitstop = 0;
    this.shake = 0;
    this.flash = 0;
    this.zoom = 1;
    this.zoomTarget = 1;
    this.zoomHold = 0;
    this.roundOver = false;
    this.banner = null;
    this.toast = null;
    this.readyT = 0;
    this.readySfx1 = false;
    this.readySfx2 = false;
    this.koT = 0;
    this.resultT = 0;
    this.result = null;
    this.hintT = 0;
    this.menuT = 0;
    this.castGlow = 0;
    this.ultCaster = null;

    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: -100, y: -100 };
    this.clicked = false;

    this.fighters[0].place(470, 1, 600);
    this.fighters[1].place(810, -1, 624);
    this.fx.reset();

    this.vignette = this.makeVignette();

    this.bind();
    this.resize();
    var self = this;
    window.addEventListener('resize', function () { self.resize(); });
  }

  // ---------------- 启动 / 尺寸 / 输入 ----------------

  Game.prototype.start = function () {
    var self = this;
    if (this.scenario === 'ult') {
      this.setupUltScene();
    } else if (this.scenario === 'proj') {
      this.setupProjScene();
    } else if (this.scenario === 'skills') {
      this.setupSkillsScene();
    } else if (this.scenario === 'depth') {
      this.setupDepthScene();
    } else if (this.scenario === 'sub') {
      this.setupSubScene();
    } else if (this.scenario === 'guard') {
      this.setupGuardScene();
    } else if (this.demo) {
      this.startMatch(0);
      var n = Math.floor((this.demoSeconds || 0) * 60);
      for (var i = 0; i < n; i++) this.step(1 / 60);
      if (this.still) this.paused = true;
    }
    this.last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    function loop(now) {
      requestAnimationFrame(loop);
      var dt = Math.min(0.05, (now - self.last) / 1000);
      self.last = now;
      self.acc += dt;
      var guard = 0;
      while (self.acc >= 1 / 60 && guard < 5) {
        self.step(1 / 60);
        self.acc -= 1 / 60;
        guard++;
      }
      if (guard >= 5) self.acc = 0;
      self.render();
    }
    requestAnimationFrame(loop);
  };

  Game.prototype.resize = function () {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var vw = window.innerWidth || U.W;
    var vh = window.innerHeight || U.H;
    var s = Math.min(vw / U.W, vh / U.H);
    var cssW = Math.floor(U.W * s);
    var cssH = Math.floor(U.H * s);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.max(2, Math.floor(U.W * s * dpr));
    this.canvas.height = Math.max(2, Math.floor(U.H * s * dpr));
    this.scale = this.canvas.width / U.W;
  };

  Game.prototype.toLogical = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) / (rect.width || 1) * U.W;
    var y = (e.clientY - rect.top) / (rect.height || 1) * U.H;
    return { x: x, y: y };
  };

  Game.prototype.bind = function () {
    var self = this;
    window.addEventListener('keydown', function (e) {
      if (KNOWN[e.code]) e.preventDefault();
      if (self.audio.ensure()) self.audio.bgmOn = true;
      if (e.repeat) return;
      self.pressed.add(e.code);
      self.keys.add(e.code);
    });
    window.addEventListener('keyup', function (e) {
      self.keys.delete(e.code);
    });
    window.addEventListener('blur', function () {
      self.keys.clear();
    });
    this.canvas.addEventListener('mousemove', function (e) {
      var m = self.toLogical(e);
      self.mouse.x = m.x;
      self.mouse.y = m.y;
    });
    this.canvas.addEventListener('mousedown', function (e) {
      self.audio.ensure();
      var m = self.toLogical(e);
      self.mouse.x = m.x;
      self.mouse.y = m.y;
      self.clicked = true;
    });
  };

  Game.prototype.hitBtn = function (b) {
    return Math.abs(this.mouse.x - b.cx) <= b.w / 2 && Math.abs(this.mouse.y - b.cy) <= b.h / 2;
  };

  // ---------------- 每帧 ----------------

  Game.prototype.step = function (dt) {
    if (this.paused) {
      this.pressed.clear();
      this.clicked = false;
      return;
    }
    this.time += dt;
    this.updateCamera(dt);
    this.updateBanner(dt);
    this.updateToast(dt);
    this.audio.updateBGM(dt);

    if (this.pressed.has('KeyB')) {
      this.audio.ensure();
      var muted = this.audio.toggleMute();
      this.toast = { text: muted ? '已静音' : '声音开启', t: 0, dur: 1.2 };
    }

    if (this.state === 'menu') this.updateMenu(dt);
    else if (this.state === 'result') this.updateResult(dt);
    else this.updateMatch(dt);

    this.pressed.clear();
    this.clicked = false;
  };

  Game.prototype.updateCamera = function (dt) {
    if (this.zoomHold > 0) {
      this.zoomHold = Math.max(0, this.zoomHold - dt);
      if (this.zoomHold === 0) this.zoomTarget = 1;
    }
    this.shake *= Math.exp(-5.2 * dt);
    if (this.shake < 0.4) this.shake = 0;
    this.flash = Math.max(0, this.flash - dt * 2.9);
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 7);
    if (this.castGlow > 0) this.castGlow = Math.max(0, this.castGlow - dt);
  };

  Game.prototype.updateBanner = function (dt) {
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > (this.banner.dur || 1.2)) this.banner = null;
    }
  };

  Game.prototype.updateToast = function (dt) {
    if (this.toast) {
      this.toast.t += dt;
      if (this.toast.t > this.toast.dur) this.toast = null;
    }
  };

  // ---------------- 状态：菜单 ----------------

  Game.prototype.updateMenu = function (dt) {
    this.menuT += dt;
    this.bg.update(dt);
    this.fx.update(dt);
    this.fighters[0].update(dt, EMPTY);
    this.fighters[1].update(dt, EMPTY);

    if (this.pressed.has('Digit1') || this.pressed.has('Enter') || this.pressed.has('Space')) {
      this.startMatch(1);
      return;
    }
    if (this.pressed.has('Digit2')) {
      this.startMatch(2);
      return;
    }
    if (this.clicked) {
      for (var i = 0; i < MENU_BUTTONS.length; i++) {
        if (this.hitBtn(MENU_BUTTONS[i])) {
          this.startMatch(MENU_BUTTONS[i].mode);
          return;
        }
      }
    }
  };

  // ---------------- 状态：对局 ----------------

  Game.prototype.startMatch = function (mode) {
    this.mode = mode;
    this.fighters[0].place(440, 1, 600);
    this.fighters[1].place(840, -1, 624);
    this.projectiles.length = 0;
    this.decoys.length = 0;
    this.fx.reset();
    this.timer = this.fullTime = 90;
    this.state = 'ready';
    this.readyT = 0;
    this.readySfx1 = false;
    this.readySfx2 = false;
    this.roundOver = false;
    this.timeScale = 1;
    this.hitstop = 0;
    this.shake = 0;
    this.flash = 0;
    this.zoom = 1;
    this.zoomTarget = 1;
    this.zoomHold = 0;
    this.banner = null;
    this.result = null;
    this.hintT = 0;
    this.koT = 0;
    this.resultT = 0;
    this.castGlow = 0;
    this.ultCaster = null;
    this.ai[0] = mode === 0 ? new g.AI(this, this.fighters[0], this.fighters[1]) : null;
    this.ai[1] = (mode === 0 || mode === 1) ? new g.AI(this, this.fighters[1], this.fighters[0]) : null;
    // 人类玩家松手后保持朝向；AI 需要空闲时自动转向对手才能正常瞄准
    this.fighters[0].autoFace = !!this.ai[0];
    this.fighters[1].autoFace = !!this.ai[1];
    this.audio.ensure();
    this.audio.ui();
  };

  Game.prototype.setupUltScene = function () {
    this.startMatch(2);
    var i;
    for (i = 0; i < 120; i++) this.step(1 / 60);
    var f = this.fighters[0];
    f.x = 430;
    this.fighters[1].x = 830;
    f.meter = 100;
    this.pressed.add('KeyU');
    this.step(1 / 60);
    for (i = 0; i < 96; i++) this.step(1 / 60);
    this.paused = true;
  };

  Game.prototype.setupProjScene = function () {
    this.startMatch(2);
    var i;
    for (i = 0; i < 120; i++) this.step(1 / 60);
    this.fighters[0].x = 260;
    this.fighters[1].x = 980;
    this.pressed.add('KeyK');
    this.step(1 / 60);
    for (i = 0; i < 22; i++) this.step(1 / 60);
    this.paused = true;
  };

  // 自检用：展示技能栏（冷却 / 内力）与「按住左右方向朝该方向出招」
  Game.prototype.setupSkillsScene = function () {
    this.startMatch(2);
    var i;
    for (i = 0; i < 110; i++) this.step(1 / 60);
    var f0 = this.fighters[0];
    var f1 = this.fighters[1];
    f0.x = 620;
    f1.x = 860;
    f0.meter = 63;
    f1.meter = 100;
    // P1 按住 A：朝左放剑气（剑气向左飞）
    this.keys.add('KeyA');
    this.pressed.add('KeyK');
    this.step(1 / 60);
    // P2 按住 →：朝右放剑气（另一边冷却 + 方向展示）
    this.keys.add('ArrowRight');
    this.pressed.add('Comma');
    this.step(1 / 60);
    for (i = 0; i < 12; i++) this.step(1 / 60);
    this.paused = true;
  };

  // 自检用：展示四向移动的纵深透视（后小前大 / 前后遮挡）
  Game.prototype.setupDepthScene = function () {
    this.startMatch(2);
    var i;
    for (i = 0; i < 110; i++) this.step(1 / 60);
    var f0 = this.fighters[0];
    var f1 = this.fighters[1];
    f0.x = 450;
    f0.y = U.DEPTH_MIN + 18;
    f1.x = 830;
    f1.y = U.DEPTH_MAX - 18;
    f0.facing = 1;
    f1.facing = -1;
    this.hintT = 0;
    this.banner = null;
    this.paused = true;
  };

  // 自检用：替身术瞬间（木桩 + 瞬身到对手背后）
  Game.prototype.setupSubScene = function () {
    this.startMatch(2);
    var i;
    for (i = 0; i < 120; i++) this.step(1 / 60);
    var a = this.fighters[0];
    var b = this.fighters[1];
    a.x = 560;
    b.x = 760;
    a.facing = 1;
    b.facing = -1;
    a.meter = 100;
    a.state = 'hurt';
    a.hurtT = 1.2;
    a.hurtWindowT = 0;
    this.pressed.add('KeyI');
    this.step(1 / 60);
    for (i = 0; i < 5; i++) this.step(1 / 60);
    this.paused = true;
  };

  // 自检用：连击保护触发瞬间（护体气罩）
  Game.prototype.setupGuardScene = function () {
    this.startMatch(2);
    var i;
    for (i = 0; i < 120; i++) this.step(1 / 60);
    var a = this.fighters[0];
    var b = this.fighters[1];
    a.x = 620;
    b.x = 730;
    for (i = 0; i < 240 && b.protectT <= 0; i++) {
      if (i % 9 === 0) {
        this.resolveHit(a, b, g.ATTACKS.a1, 'melee', { x: b.x, y: b.y - 100, w: 1, h: 1 });
      }
      this.step(1 / 60);
    }
    for (i = 0; i < 4; i++) this.step(1 / 60);
    this.paused = true;
  };

  Game.prototype.toMenu = function () {
    this.state = 'menu';
    this.result = null;
    this.banner = null;
    this.roundOver = false;
    this.timeScale = 1;
    this.zoom = 1;
    this.zoomTarget = 1;
    this.zoomHold = 0;
    this.shake = 0;
    this.flash = 0;
    this.hitstop = 0;
    this.castGlow = 0;
    this.ultCaster = null;
    this.projectiles.length = 0;
    this.decoys.length = 0;
    this.fx.reset();
    this.ai[0] = null;
    this.ai[1] = null;
    this.fighters[0].place(470, 1, 600);
    this.fighters[1].place(810, -1, 624);
    this.timer = this.fullTime;
    this.menuT = 0;
    this.audio.ui();
  };

  Game.prototype.inputFor = function (idx, dt) {
    if (this.ai[idx]) return this.ai[idx].update(dt);
    if (this.mode === 1 && idx === 1) return EMPTY;
    return this.humanInput(idx);
  };

  Game.prototype.humanInput = function (idx) {
    var m = idx === 0 ? P1_KEYS : P2_KEYS;
    return {
      left: this.keys.has(m.left),
      right: this.keys.has(m.right),
      up: this.keys.has(m.up),
      down: this.keys.has(m.down),
      block: this.keys.has(m.block),
      justAtk: this.pressed.has(m.atk),
      justProj: this.pressed.has(m.proj),
      justDash: this.pressed.has(m.dash),
      justUlt: this.pressed.has(m.ult),
      justSub: this.pressed.has(m.sub)
    };
  };

  Game.prototype.updateMatch = function (dt) {
    this.bg.update(dt);
    this.updateDecoys(dt);

    if (this.state === 'ready') {
      this.readyT += dt;
      if (!this.readySfx1) {
        this.readySfx1 = true;
        this.audio.ready();
      }
      if (!this.readySfx2 && this.readyT > 0.85) {
        this.readySfx2 = true;
        this.audio.fight();
        this.flash = 0.22;
      }
      this.fighters[0].update(dt, EMPTY);
      this.fighters[1].update(dt, EMPTY);
      this.fx.update(dt);
      if (this.readyT >= 1.5) {
        this.state = 'fight';
        this.hintT = 8;
      }
      return;
    }

    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return;
    }

    if (this.state === 'ko') {
      this.koT += dt;
      this.timeScale = this.koT < 0.75 ? 0.3 : 1;
      if (this.koT > 1.9) {
        this.state = 'result';
        this.resultT = 0;
        this.zoomTarget = 1;
        this.timeScale = 1;
      }
    }

    var wdt = dt * this.timeScale;
    var in0 = this.state === 'fight' ? this.inputFor(0, wdt) : EMPTY;
    var in1 = this.state === 'fight' ? this.inputFor(1, wdt) : EMPTY;
    this.fighters[0].update(wdt, in0);
    this.fighters[1].update(wdt, in1);
    this.separate();
    this.updateProjectiles(wdt);

    if (this.state === 'fight') {
      this.timer -= wdt;
      this.hintT = Math.max(0, this.hintT - dt);
      if (this.timer <= 0) {
        this.timer = 0;
        this.timeUp();
      }
      this.checkKO();
    }

    this.fx.update(wdt);

    if (this.pressed.has('Escape')) {
      this.toMenu();
    }
  };

  Game.prototype.separate = function () {
    var a = this.fighters[0];
    var b = this.fighters[1];
    if (a.state === 'dash' || b.state === 'dash') return;
    if (Math.abs(a.y - b.y) > 52) return;
    var dx = b.x - a.x;
    var min = 58;
    if (Math.abs(dx) < min) {
      // 墙边瞬身可能暂时重叠，按出击朝向恢复间距，避免分离时绕背。
      var s = dx === 0 ? a.facing : (dx > 0 ? 1 : -1);
      var push = (min - Math.abs(dx)) / 2;
      a.x = U.clamp(a.x - s * push, 70, U.W - 70);
      b.x = U.clamp(b.x + s * push, 70, U.W - 70);
    }
  };

  Game.prototype.checkKO = function () {
    if (this.state !== 'fight' || this.roundOver) return;
    var f0 = this.fighters[0];
    var f1 = this.fighters[1];
    if (f0.hp <= 0 || f1.hp <= 0) {
      this.enterKO(f0.hp <= 0 ? f0 : f1);
    }
  };

  Game.prototype.enterKO = function (loser) {
    if (this.roundOver) return;
    this.roundOver = true;
    this.state = 'ko';
    this.koT = 0;
    this.timeScale = 0.3;
    this.audio.ko();
    this.shake = 30;
    this.flash = 0.5;
    this.zoomTarget = 1.06;

    var bothDead = this.fighters[0].hp <= 0 && this.fighters[1].hp <= 0;
    var winner = this.opponentOf(loser);
    var winnerIdx = bothDead ? -1 : (winner ? winner.idx : -1);
    this.result = { winner: winnerIdx, reason: 'ko' };

    for (var i = 0; i < 2; i++) {
      if (this.fighters[i].hp <= 0) {
        this.fighters[i].state = 'ko';
        this.fighters[i].koDown = true;
        this.fighters[i].flash = 0.18;
      }
    }
    loser.vx = (winner && loser.x < winner.x) ? -380 : 380;
    loser.vy = 0;

    this.fx.burst(loser.x, loser.y - 90, { n: 30, color: '#fff3e0', speed: 480, life: 0.7, size: 8 });
    this.fx.ring(loser.x, loser.y - 90, 'rgba(255,225,190,0.7)', 12, 190, 0.5);
    this.banner = { text: 'K.O.', color: '#ffcf9a', t: 0, dur: 1.7, ko: true };
  };

  Game.prototype.timeUp = function () {
    if (this.roundOver) return;
    this.roundOver = true;
    this.state = 'ko';
    this.koT = 0;
    this.timeScale = 1;
    var f0 = this.fighters[0];
    var f1 = this.fighters[1];
    var winner = f0.hp === f1.hp ? -1 : (f0.hp > f1.hp ? 0 : 1);
    this.result = { winner: winner, reason: 'time' };
    this.audio.ko();
    this.banner = { text: '时间到', color: '#e9e2d2', t: 0, dur: 1.6 };
    this.zoomTarget = 1.02;
  };

  Game.prototype.updateResult = function (dt) {
    this.resultT += dt;
    this.bg.update(dt);
    this.updateDecoys(dt);
    this.fx.update(dt);
    this.fighters[0].update(dt, EMPTY);
    this.fighters[1].update(dt, EMPTY);

    if (this.pressed.has('KeyR')) { this.startMatch(this.mode); return; }
    if (this.pressed.has('Escape')) { this.toMenu(); return; }
    if (this.clicked && this.hitBtn(RESULT_BTN)) {
      this.startMatch(this.mode);
      return;
    }
    if (this.demo && this.resultT > 1.2 && !this.still) this.startMatch(0);
  };

  // ---------------- 伤害结算 ----------------

  Game.prototype.opponentOf = function (f) {
    return this.fighters[0] === f ? this.fighters[1] : this.fighters[0];
  };

  Game.prototype.resolveHit = function (att, target, def, source, point) {
    if (this.roundOver || !target || target.state === 'ko' || target.invuln > 0 ||
        (target.state === 'dash' && target.dashHidden)) return 'whiff';
    var blocked = target.state === 'block' && target.invuln <= 0;
    if (blocked) {
      target.blockHit(def, source, point);
      return 'block';
    }
    var ok = target.takeHit(att, def, source, point);
    if (ok && att) {
      att.combo++;
      att.comboT = 2.0;
      if (att.combo > att.maxCombo) att.maxCombo = att.combo;
    }
    return ok ? 'hit' : 'whiff';
  };

  Game.prototype.onHit = function (att, target, def, hitPoint) {
    var tier = def.tier || 1;
    var impact = g.IMPACTS[tier];
    var light = !!def.light;
    var px = hitPoint ? hitPoint.x : target.x;
    var py = hitPoint ? hitPoint.y : target.y - 100;
    this.hitstop = Math.max(this.hitstop, light ? 0.012 : impact.stop);
    this.shake = Math.max(this.shake, light ? 2 : impact.shake);
    this.flash = Math.min(0.85, this.flash + (light ? 0.015 : tier * 0.035));
    if (!light && impact.zoom > 1) {
      this.zoomTarget = Math.max(this.zoomTarget, impact.zoom);
      this.zoomHold = 0.32;
    }
    if (light) this.audio.ultTick();
    else this.audio.hit(tier);
    this.fx.burst(px, py, {
      n: light ? 4 : impact.dots,
      color: '#26303b',
      speed: light ? 140 : 180 + tier * 70,
      life: 0.4,
      size: light ? 2.5 : 2.5 + tier
    });
    if (!light) this.fx.ring(px, py, target.pal.glow, 4, 28 + tier * 20, 0.24);
    this.fx.text(target.x, target.y - 178, '-' + def.dmg,
      tier >= 4 ? '#ffd7a1' : '#ffffff', light ? 18 : 20 + tier * 3);
  };

  Game.prototype.onBlock = function (target, def, point) {
    var opp = this.opponentOf(target);
    var dir = opp && opp.x > target.x ? 1 : -1;
    var tier = def.tier || 1;
    this.audio.block(tier);
    this.fx.scrape(point ? point.x : target.x + dir * 34,
      point ? point.y : target.y - 100, dir, tier, !!def.light);
    this.fx.text(target.x, target.y - 168, '格挡', '#9fc4e8', 18);
    this.shake = Math.max(this.shake, def.light ? 1 : 1 + tier * 0.6);
    this.hitstop = Math.max(this.hitstop, def.light ? 0.01 : g.IMPACTS[tier].blockStop);
  };

  // ---------------- 替身术 / 连击保护 ----------------

  // 在被击打的位置留下一个木桩替身
  Game.prototype.spawnDecoy = function (f, x, y) {
    var dy = U.clamp(y, U.DEPTH_MIN, U.DEPTH_MAX);
    this.decoys.push({
      x: x,
      y: dy,
      facing: f.facing,
      pal: f.pal,
      t: 0,
      life: 1.0
    });
    var s = U.depthScale(dy);
    var py = dy - 92 * s;
    this.fx.burst(x, py, { n: 20, color: '#dfeaf7', speed: 330, life: 0.5, size: 6 });
    this.fx.dust(x, 0, dy);
    this.fx.ring(x, dy - 18 * s, 'rgba(205, 232, 255, 0.65)', 8 * s, 108 * s, 0.36);
  };

  Game.prototype.updateDecoys = function (dt) {
    for (var i = this.decoys.length - 1; i >= 0; i--) {
      var d = this.decoys[i];
      d.t += dt;
      if (d.t >= d.life) this.decoys.splice(i, 1);
    }
  };

  Game.prototype.onSubstitute = function (f, oldX, oldY) {
    this.hitstop = Math.max(this.hitstop, 0.045);
    this.shake = Math.max(this.shake, 7);
    this.flash = Math.min(0.6, this.flash + 0.1);
    this.audio.substitute();
    this.fx.text(oldX, oldY - 188, '替身术', '#bfe6ff', 24);
    this.fx.ring(f.x, f.y - 92, 'rgba(200, 232, 255, 0.6)', 8, 86, 0.3);
    this.fx.burst(f.x, f.y - 96, { n: 12, color: '#cfe6ff', speed: 260, life: 0.4, size: 4 });
  };

  // 连续被打太久 → 自动挣脱（时间保护）
  Game.prototype.onComboGuard = function (f, opp) {
    this.hitstop = Math.max(this.hitstop, 0.03);
    this.shake = Math.max(this.shake, 6);
    this.flash = Math.min(0.5, this.flash + 0.06);
    this.audio.guardBreak();
    this.fx.ring(f.x, f.y - 88, '#9fe8ff', 20, 152, 0.45);
    this.fx.ring(f.x, f.y - 88, 'rgba(215, 243, 255, 0.85)', 10, 104, 0.34);
    this.fx.burst(f.x, f.y - 92, { n: 20, color: '#bfefff', speed: 420, life: 0.5, size: 5 });
    this.fx.text(f.x, f.y - 246, '连击保护', '#aef0ff', 26);
    if (opp) {
      opp.combo = 0;
      opp.comboT = 0;
      opp.vx = (opp.x < f.x ? -1 : 1) * 150;
      this.fx.text(opp.x, opp.y - 172, '连击中断', '#cfe0f0', 17);
    }
  };

  // ---------------- 技能演出 ----------------

  Game.prototype.spawnProjectile = function (f) {
    var s = f.depthScale();
    this.projectiles.push({
      owner: f,
      x: f.x + f.facing * 46 * s,
      y: f.y - 104 * s,
      depth: f.y,
      dir: f.facing,
      t: 0,
      life: 1.7,
      trailT: 0
    });
  };

  Game.prototype.updateProjectiles = function (dt) {
    for (var i = this.projectiles.length - 1; i >= 0; i--) {
      var p = this.projectiles[i];
      var oldX = p.x;
      p.t += dt;
      p.x += p.dir * g.PROJ.speed * dt;
      p.trailT -= dt;
      if (p.trailT <= 0) {
        p.trailT = 0.026;
        this.fx.burst(p.x, p.y, {
          n: 1, color: p.owner.pal.glow, speed: 22, life: 0.24, size: 3.4, gravity: 0
        });
      }

      // 木桩只消耗轨迹，不触发命中墨爆、伤害数字或顿帧。
      var decoyHit = this.decoys.some(function (d) {
        return d.pal !== p.owner.pal && Math.abs(d.y - p.depth) <= U.DEPTH_HIT &&
          Math.max(oldX, p.x) + 18 >= d.x - 30 && Math.min(oldX, p.x) - 18 <= d.x + 30;
      });
      if (decoyHit) { this.projectiles.splice(i, 1); continue; }

      var opp = this.opponentOf(p.owner);
      if (opp && opp.state !== 'ko' && !this.roundOver) {
        var hb = opp.hurtbox();
        var box = { x: Math.min(oldX, p.x) - 18, y: p.y - 12, w: Math.abs(p.x - oldX) + 36, h: 24 };
        if (Math.abs(opp.y - p.depth) <= U.DEPTH_HIT && U.rects(box, hb)) {
          var contactX = U.clamp(p.dir > 0 ? hb.x : hb.x + hb.w, Math.min(oldX, p.x), Math.max(oldX, p.x));
          var result = this.resolveHit(p.owner, opp, g.PROJ, 'proj', { x: contactX, y: p.y });
          if (result !== 'whiff') {
            this.projectiles.splice(i, 1);
            continue;
          }
        }
      }

      if (p.x < 30 || p.x > U.W - 30 || p.t > p.life) {
        this.fx.burst(p.x, p.y, { n: 5, color: p.owner.pal.glow, speed: 120, life: 0.25, size: 3, gravity: 0 });
        this.projectiles.splice(i, 1);
      }
    }
  };

  Game.prototype.onUltStart = function (f) {
    this.audio.charge();
    this.shake = Math.max(this.shake, 3);
  };

  Game.prototype.onUltCast = function (f) {
    var opp = this.opponentOf(f);
    // 固定在落剑开始时的位置；离开横向范围或纵深即可躲过这一剑。
    f.rainArea = { x: opp ? opp.x : f.x, y: opp ? opp.y : f.y };
    this.flash = 0.18;
    this.shake = Math.max(this.shake, 4);
    this.audio.swish(true);
    this.castGlow = 1.5;
    this.ultCaster = f;
    this.banner = { text: '万 剑 归 宗', color: f.pal.glow, sub: '内力爆发', t: 0, dur: 1.5 };
    this.fx.ring(f.rainArea.x, f.rainArea.y - 8, f.pal.glow, 20, ULT.rainHalfWidth, 0.6);
  };

  Game.prototype.inSwordRain = function (f, target) {
    return !!(target && f.rainArea && Math.abs(target.x - f.rainArea.x) <= ULT.rainHalfWidth &&
      Math.abs(target.y - f.rainArea.y) <= U.DEPTH_HIT);
  };

  Game.prototype.onUltTick = function (f) {
    if (this.roundOver) return;
    var opp = this.opponentOf(f);
    if (!this.inSwordRain(f, opp)) return 'whiff';
    return this.resolveHit(f, opp, ULT.tick, 'rain', { x: opp.x, y: opp.y - 100 });
  };

  Game.prototype.onUltFinish = function (f) {
    if (this.roundOver) return;
    var opp = this.opponentOf(f);
    var area = f.rainArea;
    if (area) this.fx.slash(area.x, area.y, f.facing, f.pal.glow, 5);
    if (!this.inSwordRain(f, opp)) return 'whiff';
    return this.resolveHit(f, opp, ULT.final, 'ult', { x: opp.x, y: opp.y - 80 });
  };

  // ---------------- 渲染 ----------------

  Game.prototype.makeVignette = function () {
    var cv = document.createElement('canvas');
    cv.width = U.W;
    cv.height = U.H;
    var c = cv.getContext('2d');
    var grd = c.createRadialGradient(U.W / 2, U.H * 0.55, U.H * 0.32, U.W / 2, U.H * 0.55, U.H * 0.96);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.44)');
    c.fillStyle = grd;
    c.fillRect(0, 0, U.W, U.H);
    return cv;
  };

  Game.prototype.render = function () {
    var c = this.ctx;
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.fillStyle = '#04060a';
    c.fillRect(0, 0, U.W, U.H);

    var sh = this.shake;
    var ox = (Math.random() * 2 - 1) * sh;
    var oy = (Math.random() * 2 - 1) * sh * 0.7;
    c.save();
    c.translate(U.W / 2 + ox, U.H / 2 + oy);
    c.scale(this.zoom, this.zoom);
    c.translate(-U.W / 2, -U.H / 2);

    this.bg.draw(c);
    this.drawDecoys(c);
    this.drawProjectiles(c);
    // 纵深越靠前（y 越大）越后画，形成前后遮挡
    var order = this.fighters.slice().sort(function (a, b) { return a.y - b.y; });
    for (var oi = 0; oi < order.length; oi++) order[oi].draw(c);
    this.fx.draw(c);

    if (this.castGlow > 0 && this.ultCaster) {
      var uf = this.ultCaster;
      var al = Math.min(1, this.castGlow) * 0.6;
      var rg = c.createRadialGradient(uf.x, uf.y - 100, 30, uf.x, uf.y - 100, 470);
      rg.addColorStop(0, 'rgba(' + uf.pal.rgb + ', ' + (al * 0.7).toFixed(3) + ')');
      rg.addColorStop(0.45, 'rgba(' + uf.pal.rgb + ', ' + (al * 0.24).toFixed(3) + ')');
      rg.addColorStop(1, 'rgba(' + uf.pal.rgb + ', 0)');
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = rg;
      c.fillRect(0, 0, U.W, U.H);
      c.restore();
    }
    c.restore();

    if (this.flash > 0.001) {
      c.globalAlpha = Math.min(0.85, this.flash);
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, U.W, U.H);
      c.globalAlpha = 1;
    }

    if (this.vignette) c.drawImage(this.vignette, 0, 0);

    if (this.state === 'menu') {
      this.drawMenu(c);
    } else {
      this.drawHUD(c);
      this.drawBanners(c);
      if (this.state === 'result') this.drawResult(c);
    }

    if (this.toast) this.drawToast(c);
  };

  Game.prototype.drawProjectiles = function (c) {
    for (var i = 0; i < this.projectiles.length; i++) {
      var p = this.projectiles[i];
      c.save();
      c.translate(p.x, p.y);
      if (p.dir < 0) c.rotate(Math.PI);
      var width = g.IMPACTS[g.PROJ.tier].width;
      c.strokeStyle = '#202a35';
      c.lineWidth = width;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(-44, 0);
      c.lineTo(20, 0);
      c.stroke();
      var grd = c.createLinearGradient(-44, 0, 26, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.55, p.owner.pal.glow);
      grd.addColorStop(1, '#ffffff');
      c.strokeStyle = grd;
      c.lineWidth = width * 0.3;
      c.beginPath();
      c.moveTo(-44, 0);
      c.lineTo(20, 0);
      c.stroke();
      c.fillStyle = p.owner.pal.glow;
      c.beginPath();
      c.moveTo(26, 0);
      c.lineTo(7, -10);
      c.lineTo(7, 10);
      c.closePath();
      c.fill();
      c.restore();
    }
  };

  // 替身留下的木桩（画在角色后方）
  Game.prototype.drawDecoys = function (c) {
    for (var i = 0; i < this.decoys.length; i++) {
      var d = this.decoys[i];
      var k = U.clamp(1 - d.t / d.life, 0, 1);
      var a = Math.min(1, k * 1.8);
      var s = U.depthScale(d.y);
      c.save();
      c.globalAlpha = a;
      c.fillStyle = 'rgba(0, 0, 0, 0.35)';
      c.beginPath();
      c.ellipse(d.x, d.y + 6, 34 * s, 9 * s, 0, 0, Math.PI * 2);
      c.fill();
      c.translate(d.x, d.y);
      c.scale(s, s);

      var grd = c.createLinearGradient(-17, 0, 17, 0);
      grd.addColorStop(0, '#46301e');
      grd.addColorStop(0.45, '#7c5631');
      grd.addColorStop(1, '#3a2818');
      c.fillStyle = grd;
      roundRect(c, -17, -134, 34, 134, 7);
      c.fill();
      c.strokeStyle = 'rgba(30, 20, 12, 0.55)';
      c.lineWidth = 1.4;
      c.stroke();

      // 年轮
      c.strokeStyle = 'rgba(226, 199, 150, 0.4)';
      c.lineWidth = 1.6;
      c.beginPath();
      c.ellipse(0, -134, 15, 5, 0, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.ellipse(0, -134, 8, 2.6, 0, 0, Math.PI * 2);
      c.stroke();

      // 草绳
      c.fillStyle = '#b9a06a';
      c.fillRect(-19, -98, 38, 7);
      c.fillRect(-19, -54, 38, 7);
      c.fillStyle = 'rgba(60, 42, 26, 0.35)';
      c.fillRect(-19, -96, 38, 2);
      c.fillRect(-19, -52, 38, 2);

      // 顶部草束
      c.strokeStyle = '#9c8a5d';
      c.lineWidth = 3;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(-6, -136);
      c.lineTo(-15, -152);
      c.moveTo(0, -137);
      c.lineTo(0, -156);
      c.moveTo(6, -136);
      c.lineTo(15, -151);
      c.stroke();

      // 替身符纸
      c.save();
      c.translate(0, -112);
      c.rotate(-0.12);
      c.fillStyle = 'rgba(236, 228, 200, ' + (0.8 * a).toFixed(2) + ')';
      c.fillRect(-8, -14, 16, 28);
      c.fillStyle = 'rgba(150, 40, 34, 0.85)';
      c.fillRect(-5, -8, 10, 2);
      c.fillRect(-5, -2, 10, 2);
      c.fillRect(-5, 4, 10, 2);
      c.restore();

      c.restore();
    }
  };

  // ---------------- HUD ----------------

  Game.prototype.drawBar = function (c, x, y, w, f, dir) {
    var h = 26;
    var i;

    c.save();
    c.fillStyle = 'rgba(4, 7, 12, 0.7)';
    roundRect(c, x - 4, y - 4, w + 8, h + 46, 7);
    c.fill();

    c.fillStyle = 'rgba(255, 255, 255, 0.055)';
    c.fillRect(x, y, w, h);

    var ratio = U.clamp(f.hp / f.maxHp, 0, 1);
    var grd = c.createLinearGradient(x, y, x + w, y);
    if (dir === 1) {
      grd.addColorStop(0, f.pal.trim);
      grd.addColorStop(1, f.pal.glow);
    } else {
      grd.addColorStop(0, f.pal.glow);
      grd.addColorStop(1, f.pal.trim);
    }
    c.fillStyle = grd;
    if (dir === 1) c.fillRect(x, y, w * ratio, h);
    else c.fillRect(x + w * (1 - ratio), y, w * ratio, h);

    c.fillStyle = 'rgba(255, 255, 255, 0.13)';
    if (dir === 1) c.fillRect(x, y, w * ratio, 8);
    else c.fillRect(x + w * (1 - ratio), y, w * ratio, 8);

    c.strokeStyle = 'rgba(220, 232, 250, 0.24)';
    c.lineWidth = 2;
    c.strokeRect(x, y, w, h);

    c.strokeStyle = 'rgba(0, 0, 0, 0.32)';
    c.lineWidth = 1;
    for (i = 1; i < 10; i++) {
      var lx = x + (w * i) / 10;
      c.beginPath();
      c.moveTo(lx, y + 2);
      c.lineTo(lx, y + h - 2);
      c.stroke();
    }

    c.font = font(18);
    c.textAlign = dir === 1 ? 'left' : 'right';
    c.fillStyle = 'rgba(238, 232, 216, 0.92)';
    // 白天背景偏亮，给血条上方的角色名加一层阴影保证可读性
    c.shadowColor = 'rgba(0, 0, 0, 0.75)';
    c.shadowBlur = 8;
    c.fillText(f.name, dir === 1 ? x : x + w, y - 12);
    c.shadowBlur = 0;

    var tag = (this.ai[0] === null && this.ai[1] === null) ? '' : (this.ai[f.idx] ? 'AI' : '');
    if (tag) {
      c.font = font(13, 'normal');
      c.fillStyle = 'rgba(210, 225, 240, 0.42)';
      c.textAlign = dir === 1 ? 'right' : 'left';
      c.fillText('AI 对手', dir === 1 ? x + w - 4 : x + 4, y - 12);
      c.textAlign = dir === 1 ? 'left' : 'right';
    }

    // 内力条
    var mw = w * 0.6;
    var my = y + h + 8;
    var mh = 8;
    var mx = dir === 1 ? x : x + w - mw;
    c.fillStyle = 'rgba(255,255,255,0.06)';
    c.fillRect(mx, my, mw, mh);
    var mr = U.clamp(f.meter / MAX_METER, 0, 1);
    c.fillStyle = f.pal.glow;
    if (dir === 1) c.fillRect(mx, my, mw * mr, mh);
    else c.fillRect(mx + mw * (1 - mr), my, mw * mr, mh);
    c.strokeStyle = 'rgba(220, 232, 250, 0.18)';
    c.lineWidth = 1;
    c.strokeRect(mx, my, mw, mh);

    if (mr >= 1) {
      var pulse = 0.5 + 0.5 * Math.sin(this.time * 7);
      c.save();
      c.globalAlpha = 0.45 + pulse * 0.55;
      c.font = font(13);
      c.fillStyle = f.pal.glow;
      c.textAlign = dir === 1 ? 'left' : 'right';
      c.textBaseline = 'alphabetic';
      c.fillText('内力已满', dir === 1 ? mx + mw + 10 : mx - 10, my + mh);
      c.restore();
    }

    c.restore();
    c.textAlign = 'left';
  };

  Game.prototype.drawTimer = function (c) {
    var t = Math.ceil(this.timer);
    var danger = this.timer < 10 && this.state === 'fight';
    c.save();
    c.translate(640, 76);
    c.fillStyle = 'rgba(4, 7, 12, 0.72)';
    c.beginPath();
    c.arc(0, 0, 40, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = danger ? 'rgba(255, 120, 100, 0.9)' : 'rgba(220, 232, 250, 0.35)';
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(0, 0, 40, 0, Math.PI * 2);
    c.stroke();
    // 进度环
    c.strokeStyle = danger ? 'rgba(255, 120, 100, 0.5)' : 'rgba(200, 220, 245, 0.22)';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(0, 0, 33, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (this.timer / this.fullTime));
    c.stroke();

    c.font = font(40);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = danger ? '#ff9a80' : '#f0ead8';
    c.fillText('' + t, 0, 2);
    c.restore();
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
  };

  Game.prototype.drawCombo = function (c, idx) {
    var f = this.fighters[idx];
    if (f.combo < 2 || f.comboT <= 0) return;
    var a = U.clamp(f.comboT / 0.45, 0, 1);
    var x = idx === 0 ? 190 : U.W - 190;
    c.save();
    c.globalAlpha = a;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = font(38);
    c.shadowColor = f.pal.glow;
    c.shadowBlur = 18;
    c.fillStyle = f.pal.glow;
    c.fillText(f.combo + ' 连击', x, 238);
    c.restore();
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
  };

  Game.prototype.drawHint = function (c) {
    if (this.hintT <= 0 || (this.state !== 'fight' && this.state !== 'ready')) return;
    var a = U.clamp(this.hintT / 1.2, 0, 1) * 0.8;
    var th = 62;
    c.save();
    c.fillStyle = 'rgba(8, 12, 18, 0.5)';
    roundRect(c, 640 - 420, U.H - th - 16, 840, th, 8);
    c.fill();
    c.globalAlpha = a;
    c.textAlign = 'center';
    c.font = font(15, 'normal');
    c.fillStyle = 'rgba(222, 234, 247, 0.88)';
    c.fillText('J 连斩 · K 剑气 · L 残影步 · U 万剑归宗 · I 替身 · Q 格挡', 640, U.H - 42);
    c.fillText(this.mode === 2
      ? 'P1：WASD 四向移动 · P2：方向键四向移动 · 左右决定朝向（松手保持）· 被击中时按替身键脱身'
      : 'WASD 四向移动 · 左右决定朝向（松手保持）· Q 格挡 · 被击中时按 I 替身脱身（耗内力）', 640, U.H - 64);
    c.restore();
    c.textAlign = 'left';
  };

  // ---------------- 技能栏 ----------------

  // 供 HUD 与测试共用：返回每个技能的冷却/内力状态
  Game.prototype.skillRows = function (f) {
    var rows = [];
    for (var i = 0; i < SKILLS.length; i++) {
      var s = SKILLS[i];
      var kind = 'none';
      var cd = 0;
      var max = 0;
      if (s.id === 'proj') {
        kind = 'cd';
        cd = f.projCd;
        max = g.PROJ.cooldown;
      } else if (s.id === 'dash') {
        kind = 'cd';
        cd = f.dashCd;
        max = g.DASH.cd;
      } else if (s.id === 'ult') {
        kind = 'meter';
        cd = MAX_METER - f.meter;
        max = MAX_METER;
      } else if (s.id === 'sub') {
        kind = 'cd';
        cd = f.subCd;
        max = g.SUB.cd;
      }
      var ratio = kind === 'none' ? 1 : (kind === 'meter' ? f.meter / MAX_METER : 1 - cd / max);
      rows.push({
        id: s.id,
        name: s.name,
        key: f.idx === 0 ? s.p1 : s.p2,
        kind: kind,
        cd: U.clamp(cd, 0, max),
        max: max,
        ratio: U.clamp(ratio, 0, 1),
        cost: s.id === 'sub' ? g.SUB.cost : 0,
        ready: s.id === 'sub'
          ? (f.subCd <= 0 && f.meter >= g.SUB.cost)
          : (kind === 'meter' ? f.meter >= MAX_METER : cd <= 0),
        active: !!(f.castFx && f.castFx.id === s.id)
      });
    }
    return rows;
  };

  Game.prototype.drawSkillTile = function (c, x, y, w, h, row, f, keyLabel) {
    var rgb = f.pal.rgb;
    var accent = f.pal.glow;
    var pulse = 0.5 + 0.5 * Math.sin(this.time * 6 + f.idx * 1.7);

    c.save();

    // 底板
    c.fillStyle = 'rgba(5, 9, 15, 0.8)';
    roundRect(c, x, y, w, h, 8);
    c.fill();

    // 内力页：从底部涨起来的微光；冷却页：整体压暗
    if (row.kind === 'meter' && row.ratio > 0) {
      c.save();
      roundRect(c, x, y, w, h, 8);
      c.clip();
      var gh = h * row.ratio;
      var grd = c.createLinearGradient(0, y + h - gh, 0, y + h);
      grd.addColorStop(0, 'rgba(' + rgb + ', 0.05)');
      grd.addColorStop(1, 'rgba(' + rgb + ', 0.38)');
      c.fillStyle = grd;
      c.fillRect(x, y + h - gh, w, gh);
      c.restore();
    } else if (row.kind === 'cd' && !row.ready) {
      c.save();
      roundRect(c, x, y, w, h, 8);
      c.clip();
      c.fillStyle = 'rgba(2, 5, 9, 0.5)';
      c.fillRect(x, y, w, h);
      c.restore();
    }

    // 边框：就绪时亮起（大招满内力的呼吸光更强）
    var ultReady = row.id === 'ult' && row.ready;
    if (row.ready) {
      c.shadowColor = accent;
      c.shadowBlur = ultReady ? 13 + pulse * 10 : 7;
      c.strokeStyle = 'rgba(' + rgb + ', ' + (ultReady ? 0.55 + pulse * 0.35 : 0.42).toFixed(2) + ')';
      c.lineWidth = 1.6;
    } else {
      c.strokeStyle = 'rgba(205, 220, 238, 0.16)';
      c.lineWidth = 1.2;
    }
    roundRect(c, x, y, w, h, 8);
    c.stroke();
    c.shadowBlur = 0;

    // 刚施放的一瞬间闪一下
    if (row.active && f.castFx) {
      var k = U.clamp(f.castFx.t / 0.24, 0, 1);
      c.save();
      roundRect(c, x, y, w, h, 8);
      c.clip();
      c.globalAlpha = k * 0.24;
      c.fillStyle = accent;
      c.fillRect(x, y, w, h);
      c.restore();
    }

    // 键位徽章 / 名称
    var tx = x + 10;
    if (keyLabel) {
      c.fillStyle = 'rgba(255, 255, 255, 0.06)';
      roundRect(c, x + 7, y + 6, 21, 20, 5);
      c.fill();
      c.strokeStyle = row.ready ? 'rgba(230, 240, 255, 0.42)' : 'rgba(205, 220, 238, 0.2)';
      c.lineWidth = 1;
      roundRect(c, x + 7, y + 6, 21, 20, 5);
      c.stroke();
      c.font = font(12);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = row.ready ? '#eef4ff' : 'rgba(220, 230, 245, 0.45)';
      c.fillText(keyLabel, x + 17.5, y + 16.5);
      tx = x + 35;
    }

    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.font = font(13);
    c.fillStyle = row.ready ? '#f0e9d8' : 'rgba(216, 226, 240, 0.5)';
    c.fillText(row.name, tx, y + 22);

    // 状态文字
    var status;
    var scol;
    if (row.id === 'ult') {
      if (f.state === 'ult') {
        status = '释放中';
        scol = accent;
      } else if (row.ready) {
        status = '可释放';
        scol = accent;
      } else {
        status = '内力 ' + Math.floor(f.meter) + '%';
        scol = 'rgba(220, 228, 240, 0.6)';
      }
    } else if (row.id === 'sub') {
      if (f.state === 'sub') {
        status = '脱身中';
        scol = accent;
      } else if (f.subCd > 0) {
        status = f.subCd.toFixed(1) + 's';
        scol = 'rgba(232, 238, 248, 0.82)';
      } else if (f.meter < g.SUB.cost) {
        status = '内力不足';
        scol = 'rgba(220, 228, 240, 0.5)';
      } else {
        status = '受击可用';
        scol = 'rgba(222, 234, 247, 0.55)';
      }
    } else if (row.ready) {
      status = '就绪';
      scol = 'rgba(222, 234, 247, 0.55)';
    } else {
      status = row.cd.toFixed(1) + 's';
      scol = 'rgba(232, 238, 248, 0.82)';
    }
    c.font = font(11, 'normal');
    c.fillStyle = scol;
    c.fillText(status, x + 10, y + 38);

    // 冷却 / 内力进度条
    c.fillStyle = 'rgba(255, 255, 255, 0.07)';
    c.fillRect(x + 10, y + h - 8, w - 20, 3);
    c.fillStyle = row.ready ? accent : 'rgba(' + rgb + ', 0.6)';
    c.fillRect(x + 10, y + h - 8, (w - 20) * row.ratio, 3);

    c.restore();
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
  };

  Game.prototype.drawSkillBar = function (c, idx) {
    var f = this.fighters[idx];
    var rows = this.skillRows(f);
    var showKeys = !this.ai[idx]; // 1P 模式 P2 是 AI，不显示按键
    var W = 100;
    var H = 48;
    var GAP = 6;
    var totalW = W * SKILLS.length + GAP * (SKILLS.length - 1);
    var x0 = idx === 0 ? 54 : U.W - 54 - totalW;
    var y0 = 120;
    for (var i = 0; i < rows.length; i++) {
      this.drawSkillTile(c, x0 + i * (W + GAP), y0, W, H, rows[i], f,
        showKeys ? rows[i].key : '');
    }
  };

  Game.prototype.drawHUD = function (c) {
    this.drawBar(c, 54, 46, 470, this.fighters[0], 1);
    this.drawBar(c, U.W - 54 - 470, 46, 470, this.fighters[1], -1);
    this.drawSkillBar(c, 0);
    this.drawSkillBar(c, 1);
    this.drawTimer(c);
    this.drawCombo(c, 0);
    this.drawCombo(c, 1);
    this.drawHint(c);
  };

  Game.prototype.bigText = function (c, text, x, y, size, color, alpha, scale, spacing) {
    c.save();
    c.globalAlpha = U.clamp(alpha, 0, 1);
    c.translate(x, y);
    c.scale(scale, scale);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = font(size);
    c.shadowColor = color;
    c.shadowBlur = 28;
    c.fillStyle = color;
    U.drawTextSpaced(c, text, 0, 0, spacing || 0);
    c.restore();
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
  };

  Game.prototype.drawBanners = function (c) {
    if (this.state === 'ready') {
      if (this.readyT < 0.85) {
        var k = U.clamp(this.readyT / 0.22, 0, 1);
        this.bigText(c, 'READY', 640, 300, 74, '#e8e0cd', k, 0.82 + 0.18 * U.easeOutBack(k), 12);
      } else {
        var k2 = U.clamp((this.readyT - 0.85) / 0.2, 0, 1);
        this.bigText(c, 'FIGHT!', 640, 300, 96, '#ffb48f', 1, 1.18 - 0.18 * k2, 16);
      }
    }
    if (this.banner) {
      var b = this.banner;
      var p = U.clamp(b.t / 0.18, 0, 1);
      var fade = U.clamp((b.dur - b.t) / 0.4, 0, 1);
      var sc = b.ko ? (1.6 - 0.6 * U.easeOutCubic(p)) : (0.7 + 0.3 * U.easeOutBack(p));
      this.bigText(c, b.text, 640, b.ko ? 292 : 262, b.ko ? 122 : 62, b.color, fade, sc, b.ko ? 22 : 10);
      if (b.sub) {
        c.save();
        c.globalAlpha = fade * 0.7;
        c.textAlign = 'center';
        c.font = font(18, 'normal');
        c.fillStyle = 'rgba(235, 228, 210, 0.85)';
        c.fillText(b.sub, 640, 318);
        c.restore();
        c.textAlign = 'left';
      }
    }
  };

  // ---------------- 菜单 / 结算 ----------------

  Game.prototype.drawButton = function (c, b, tint) {
    var hover = this.hitBtn(b);
    var x = b.cx - b.w / 2;
    var y = b.cy - b.h / 2;
    c.save();
    if (hover) {
      c.shadowColor = tint || 'rgba(255, 150, 110, 0.55)';
      c.shadowBlur = 26;
    }
    var grd = c.createLinearGradient(x, y, x, y + b.h);
    if (tint && hover) {
      grd.addColorStop(0, 'rgba(52, 46, 56, 0.96)');
      grd.addColorStop(1, 'rgba(28, 24, 32, 0.96)');
    } else if (hover) {
      grd.addColorStop(0, 'rgba(62, 34, 30, 0.96)');
      grd.addColorStop(1, 'rgba(36, 20, 18, 0.96)');
    } else {
      grd.addColorStop(0, 'rgba(18, 24, 34, 0.92)');
      grd.addColorStop(1, 'rgba(10, 14, 21, 0.92)');
    }
    c.fillStyle = grd;
    roundRect(c, x, y, b.w, b.h, 10);
    c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = hover ? 'rgba(255, 176, 136, 0.85)' : 'rgba(200, 215, 235, 0.26)';
    c.lineWidth = 1.6;
    roundRect(c, x, y, b.w, b.h, 10);
    c.stroke();

    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = hover ? '#ffe6d2' : '#e6dfcf';
    c.font = font(26);
    c.fillText(b.title, b.cx, b.cy - 7);
    if (b.sub) {
      c.font = font(14, 'normal');
      c.fillStyle = 'rgba(200, 215, 232, 0.55)';
      c.fillText(b.sub, b.cx, b.cy + 17);
    }
    c.restore();
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
  };

  Game.prototype.drawMenu = function (c) {
    var grd = c.createLinearGradient(0, 0, 0, U.H);
    grd.addColorStop(0, 'rgba(3, 5, 10, 0.34)');
    grd.addColorStop(0.55, 'rgba(3, 5, 10, 0.5)');
    grd.addColorStop(1, 'rgba(3, 5, 10, 0.8)');
    c.fillStyle = grd;
    c.fillRect(0, 0, U.W, U.H);

    this.bigText(c, '墨 影', 640, 196, 112, '#f2e9d8', 1, 1, 10);

    c.save();
    c.textAlign = 'center';
    c.font = font(20, 'normal');
    c.fillStyle = 'rgba(222, 232, 245, 0.78)';
    c.shadowColor = 'rgba(0, 0, 0, 0.55)';
    c.shadowBlur = 6;
    c.fillText('一 对 一 · 古 风 决 斗', 640, 272);
    c.shadowBlur = 0;

    // 印章
    c.translate(806, 158);
    c.rotate(-0.05);
    c.fillStyle = 'rgba(150, 40, 34, 0.92)';
    roundRect(c, -27, -27, 54, 54, 6);
    c.fill();
    c.fillStyle = '#f4e5cf';
    c.font = font(30);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('影', 0, 2);
    c.restore();
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';

    for (var i = 0; i < MENU_BUTTONS.length; i++) this.drawButton(c, MENU_BUTTONS[i]);

    c.save();
    c.textAlign = 'center';
    c.font = font(15, 'normal');
    c.fillStyle = 'rgba(200, 215, 232, 0.5)';
    c.fillText('WASD 四向移动 · Q 格挡 · J 连斩 · K 剑气 · L 残影步 · U 万剑归宗 · I 替身', 640, 566);
    c.fillText('P2：方向键四向移动 · 右Shift 格挡 · M 连斩 · , 剑气 · . 残影步 · / 万剑归宗 · N 替身', 640, 594);
    c.fillStyle = 'rgba(200, 215, 232, 0.38)';
    c.fillText('被连击时按替身脱身（耗 20 内力）· 连续被打 1.5 秒自动触发连击保护', 640, 624);
    c.fillStyle = 'rgba(200, 215, 232, 0.3)';
    c.font = font(14, 'normal');
    c.fillText('按 1 或 Enter 开始 · 按 2 双人 · B 开关声音 · Esc 返回主菜单', 640, 682);
    c.restore();
    c.textAlign = 'left';
  };

  Game.prototype.drawResult = function (c) {
    c.save();
    c.fillStyle = 'rgba(2, 4, 8, 0.6)';
    c.fillRect(0, 0, U.W, U.H);

    var w = 720;
    var h = 440;
    var x = (U.W - w) / 2;
    var y = 140;
    c.fillStyle = 'rgba(9, 13, 20, 0.94)';
    roundRect(c, x, y, w, h, 16);
    c.fill();
    c.strokeStyle = 'rgba(215, 215, 195, 0.22)';
    c.lineWidth = 1.5;
    roundRect(c, x, y, w, h, 16);
    c.stroke();
    c.strokeStyle = 'rgba(224, 90, 78, 0.55)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x + 60, y + 26);
    c.lineTo(x + w - 60, y + 26);
    c.stroke();

    var r = this.result || { winner: -1, reason: 'ko' };
    var title = r.winner < 0 ? '平  局' : (this.fighters[r.winner].name + '  胜');
    var col = r.winner < 0 ? '#d8d2c2' : this.fighters[r.winner].pal.glow;
    this.bigText(c, title, 640, y + 118, 64, col, 1, 1, 8);

    c.textAlign = 'center';
    c.font = font(21, 'normal');
    c.fillStyle = 'rgba(225, 220, 205, 0.75)';
    c.fillText(r.reason === 'ko' ? 'K.O. — 一击定胜负' : '时间到 — 血量多者胜', 640, y + 174);

    var f0 = this.fighters[0];
    var f1 = this.fighters[1];
    var rows = [
      [f0.name, f0.pal.glow, '血量 ' + Math.max(0, Math.ceil(f0.hp)) + '　连击 ' + f0.maxCombo + '　替身 ' + f0.subCount],
      [f1.name, f1.pal.glow, '血量 ' + Math.max(0, Math.ceil(f1.hp)) + '　连击 ' + f1.maxCombo + '　替身 ' + f1.subCount]
    ];
    for (var i = 0; i < rows.length; i++) {
      c.textAlign = 'left';
      c.font = font(18);
      c.fillStyle = rows[i][1];
      c.fillText(rows[i][0], x + 150, y + 244 + i * 36);
      c.font = font(17, 'normal');
      c.fillStyle = 'rgba(220, 228, 240, 0.75)';
      c.fillText(rows[i][2], x + 250, y + 244 + i * 36);
    }

    this.drawButton(c, RESULT_BTN, 'rgba(160, 170, 200, 0.5)');

    c.textAlign = 'center';
    c.font = font(15, 'normal');
    c.fillStyle = 'rgba(200, 215, 232, 0.45)';
    c.fillText('Esc 返回主菜单', 640, y + 418);
    c.restore();
    c.textAlign = 'left';
  };

  Game.prototype.drawToast = function (c) {
    var a = U.clamp(1 - this.toast.t / this.toast.dur, 0, 1) * 0.8;
    c.save();
    c.globalAlpha = a;
    c.font = font(15, 'normal');
    c.textAlign = 'center';
    c.fillStyle = 'rgba(235, 240, 250, 0.9)';
    c.fillText(this.toast.text, 640, U.H - 92);
    c.restore();
    c.textAlign = 'left';
  };

  g.Game = Game;
})(window);
