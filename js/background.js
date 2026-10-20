(function (g) {
  'use strict';

  var U = g.U;
  var GROUND = U.GROUND;

  // 背景图：1920×1080 的白天庭院。画到 1280×720 画布上时完整覆盖，
  // 再向外多画一圈，避免震屏/镜头移动时露出画布边缘。
  var PLATE_SRC = 'assets/background.webp';
  var PAD_X = 28;
  var PAD_Y = 16;

  function leafShape(c, x, y, len, angle, color, alpha) {
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    c.globalAlpha = alpha == null ? 1 : alpha;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(len * 0.5, -len * 0.26, len, 0);
    c.quadraticCurveTo(len * 0.5, len * 0.26, 0, 0);
    c.fill();
    c.restore();
  }

  function bush(c, x, y, r, color) {
    c.fillStyle = color;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.arc(x + r * 0.8, y + r * 0.2, r * 0.72, 0, Math.PI * 2);
    c.arc(x - r * 0.8, y + r * 0.25, r * 0.66, 0, Math.PI * 2);
    c.fill();
  }

  function Background() {
    this.t = 0;
    this.leaves = [];
    this.flies = [];
    this.image = null;
    this.imageFailed = false;
    this.build();
    this.loadPlate();
    this.seedAmbient();
  }

  // 背景图加载完成前（或加载失败时）的兜底画面：
  // 用低细节的白天庭院色块占位，避免开局闪一帧黑屏。
  Background.prototype.build = function () {
    var cv = document.createElement('canvas');
    cv.width = U.W;
    cv.height = U.H;
    var c = cv.getContext('2d');
    this.paintFallback(c);
    this.static = cv;
  };

  Background.prototype.loadPlate = function () {
    if (typeof Image === 'undefined') return;
    var self = this;
    var img = new Image();
    img.decoding = 'async';
    img.onload = function () {
      self.image = img;
      if (img.decode) img.decode().catch(function () {});
    };
    img.onerror = function () { self.imageFailed = true; };
    img.src = PLATE_SRC;
  };

  Background.prototype.paintFallback = function (c) {
    var i, x;

    // 天空
    var sky = c.createLinearGradient(0, 0, 0, 500);
    sky.addColorStop(0, '#86c2e7');
    sky.addColorStop(0.55, '#b8d9de');
    sky.addColorStop(1, '#d9e2cf');
    c.fillStyle = sky;
    c.fillRect(0, 0, U.W, 520);

    // 院墙
    c.fillStyle = '#c7ccbd';
    c.fillRect(0, 42, U.W, 470);
    var wallLight = c.createLinearGradient(0, 42, 0, 512);
    wallLight.addColorStop(0, 'rgba(238, 242, 226, 0.34)');
    wallLight.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
    wallLight.addColorStop(1, 'rgba(74, 92, 64, 0.18)');
    c.fillStyle = wallLight;
    c.fillRect(0, 42, U.W, 470);
    // 墙面斜光
    c.fillStyle = 'rgba(255, 249, 215, 0.15)';
    c.beginPath();
    c.moveTo(0, 42);
    c.lineTo(560, 42);
    c.lineTo(300, 512);
    c.lineTo(0, 512);
    c.closePath();
    c.fill();
    // 红檐
    c.fillStyle = '#a34a3b';
    c.fillRect(0, 38, U.W, 7);
    c.fillStyle = 'rgba(255, 214, 160, 0.35)';
    c.fillRect(0, 38, U.W, 2);

    // 远处金色殿顶
    c.fillStyle = '#d8ad43';
    c.beginPath();
    c.moveTo(540, 44);
    c.lineTo(596, 12);
    c.lineTo(684, 12);
    c.lineTo(740, 44);
    c.closePath();
    c.fill();
    c.fillStyle = '#b8862f';
    c.fillRect(540, 44, 200, 10);
    c.fillStyle = '#e3c76d';
    c.fillRect(548, 30, 184, 5);

    // 院内小路两侧的灌木/树
    bush(c, 76, 470, 64, '#47742d');
    bush(c, 168, 492, 48, '#416b27');
    bush(c, 1136, 452, 88, '#3e6928');
    bush(c, 1050, 500, 46, '#4c7a30');
    bush(c, 242, 506, 30, '#527f34');
    c.fillStyle = '#6d4a2b';
    c.fillRect(1176, 404, 14, 128);

    // 草地
    var grass = c.createLinearGradient(0, 500, 0, U.H);
    grass.addColorStop(0, '#86a94e');
    grass.addColorStop(0.45, '#6e953f');
    grass.addColorStop(1, '#466a24');
    c.fillStyle = grass;
    c.fillRect(0, 500, U.W, U.H - 500);

    // 土路
    c.fillStyle = '#c6a25c';
    c.beginPath();
    c.moveTo(466, 500);
    c.lineTo(816, 500);
    c.lineTo(1170, U.H);
    c.lineTo(96, U.H);
    c.closePath();
    c.fill();
    var pathLight = c.createLinearGradient(320, 500, 960, U.H);
    pathLight.addColorStop(0, 'rgba(244, 218, 150, 0.5)');
    pathLight.addColorStop(0.55, 'rgba(199, 160, 86, 0.18)');
    pathLight.addColorStop(1, 'rgba(120, 88, 41, 0.2)');
    c.fillStyle = pathLight;
    c.beginPath();
    c.moveTo(466, 500);
    c.lineTo(816, 500);
    c.lineTo(1170, U.H);
    c.lineTo(96, U.H);
    c.closePath();
    c.fill();

    // 零星石块 / 草叶
    for (i = 0; i < 16; i++) {
      x = U.hash(i * 5.3 + 2) * U.W;
      if (x > 470 && x < 810) continue;
      var y = 520 + U.hash(i * 2.7) * 180;
      c.fillStyle = 'rgba(150, 154, 140, ' + (0.28 + U.hash(i) * 0.2) + ')';
      c.beginPath();
      c.ellipse(x, y, 6 + U.hash(i * 3.1) * 10, 3 + U.hash(i * 1.9) * 5, 0, 0, Math.PI * 2);
      c.fill();
    }
    for (i = 0; i < 90; i++) {
      x = U.hash(i * 4.7) * U.W;
      var gy = 508 + U.hash(i * 8.1) * 206;
      if (x > 400 && x < 880 && gy > 512) continue;
      c.strokeStyle = 'rgba(54, 84, 30, ' + (0.16 + U.hash(i * 6.2) * 0.2) + ')';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x, gy);
      c.lineTo(x + (U.hash(i * 9.4) - 0.5) * 6, gy - 4 - U.hash(i * 2.2) * 9);
      c.stroke();
    }
  };

  Background.prototype.seedAmbient = function () {
    var i;
    for (i = 0; i < 16; i++) {
      this.leaves.push(this.makeLeaf(true));
    }
    for (i = 0; i < 12; i++) {
      this.flies.push({
        x: U.rand(80, U.W - 80),
        y: U.rand(GROUND - 260, GROUND - 20),
        phase: U.rand(0, Math.PI * 2),
        speed: U.rand(7, 18),
        size: U.rand(1.1, 2.2)
      });
    }
  };

  Background.prototype.makeLeaf = function (initial) {
    // 与庭院里的黄绿树叶呼应，飘落的是暖金色叶片
    var colors = ['#d9aa44', '#c78d2f', '#e3c25a', '#a9792b', '#8fa544'];
    return {
      x: U.rand(-40, U.W + 40),
      y: initial ? U.rand(60, GROUND) : U.rand(-80, -10),
      vx: U.rand(8, 38),
      vy: U.rand(20, 52),
      rot: U.rand(0, Math.PI * 2),
      vr: U.rand(-1.8, 1.8),
      size: U.rand(4.5, 9),
      sway: U.rand(0, Math.PI * 2),
      color: colors[(Math.random() * colors.length) | 0]
    };
  };

  Background.prototype.update = function (dt) {
    this.t += dt;
    var i, l;
    for (i = 0; i < this.leaves.length; i++) {
      l = this.leaves[i];
      l.sway += dt * 1.7;
      l.x += (l.vx + Math.sin(l.sway) * 24) * dt;
      l.y += l.vy * dt;
      l.rot += l.vr * dt;
      if (l.y > GROUND + 30 || l.x > U.W + 80) {
        this.leaves[i] = this.makeLeaf(false);
      }
    }
    for (i = 0; i < this.flies.length; i++) {
      var f = this.flies[i];
      f.phase += dt * 1.3;
      f.x += Math.cos(f.phase * 1.7) * f.speed * dt;
      f.y += Math.sin(f.phase) * f.speed * 0.5 * dt;
      f.x = U.clamp(f.x, 60, U.W - 60);
      f.y = U.clamp(f.y, GROUND - 300, GROUND - 12);
    }
  };

  Background.prototype.draw = function (c) {
    var src = this.image || this.static;
    // 略微超出 1.04 倍：震屏 + 收缩镜头时也不会露出边缘
    c.drawImage(src, -PAD_X, -PAD_Y, U.W + PAD_X * 2, U.H + PAD_Y * 2);

    // 阳光里的浮尘，压得很淡，只为让静止背景有一点空气感
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.flies.length; i++) {
      var f = this.flies[i];
      var a = 0.18 + 0.3 * (0.5 + 0.5 * Math.sin(f.phase * 2.1));
      c.fillStyle = 'rgba(255, 240, 198, ' + (a * 0.35).toFixed(3) + ')';
      c.beginPath();
      c.arc(f.x, f.y, f.size * 3.4, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255, 247, 220, ' + a.toFixed(3) + ')';
      c.beginPath();
      c.arc(f.x, f.y, f.size, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();

    // 飘落的暖色叶子画在角色身后
    for (var j = 0; j < this.leaves.length; j++) {
      var l = this.leaves[j];
      c.save();
      c.translate(l.x, l.y);
      c.rotate(l.rot);
      c.globalAlpha = 0.5;
      c.fillStyle = l.color;
      c.beginPath();
      c.ellipse(0, 0, l.size, l.size * 0.42, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  };

  g.Background = Background;
})(window);
