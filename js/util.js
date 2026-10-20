(function (g) {
  'use strict';

  var U = {
    W: 1280,
    H: 720,
    GROUND: 612,

    // 2.5D 庭院：y 不再表示跳跃高度，而是「纵深」位置（脚底所在的地面线）。
    // 往上走 = 靠近远处院墙，往下走 = 靠近镜头。
    DEPTH_MIN: 510,
    DEPTH_MAX: 660,
    DEPTH_HIT: 58,

    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    rand: function (a, b) { return a + Math.random() * (b - a); },
    randInt: function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
    choice: function (arr) { return arr[(Math.random() * arr.length) | 0]; },
    sign: function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); },

    // 根据纵深给角色做轻微透视缩放：越靠前越大。
    depthScale: function (y) {
      var t = U.clamp((y - U.DEPTH_MIN) / (U.DEPTH_MAX - U.DEPTH_MIN), 0, 1);
      return 0.86 + t * 0.22;
    },

    rects: function (a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    },

    dist: function (a, b) { return Math.abs(a - b); },

    easeOutCubic: function (t) { t = 1 - t; return 1 - t * t * t; },
    easeInCubic: function (t) { return t * t * t; },
    easeOutQuint: function (t) { t = 1 - t; return 1 - t * t * t * t * t; },
    easeOutBack: function (t) {
      var c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    easeInOutSine: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; },

    // 确定性伪随机（背景山脊等静态元素用）
    hash: function (n) {
      var x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
      return x - Math.floor(x);
    },

    drawTextSpaced: function (c, text, x, y, spacing) {
      // letterSpacing 在旧版浏览器没有，手动实现兜底
      if ('letterSpacing' in c) {
        var old = c.letterSpacing;
        c.letterSpacing = spacing + 'px';
        c.fillText(text, x, y);
        c.letterSpacing = old;
      } else {
        var total = 0;
        for (var i = 0; i < text.length; i++) total += c.measureText(text[i]).width + spacing;
        var cx = x - total / 2 + spacing / 2;
        for (var j = 0; j < text.length; j++) {
          c.fillText(text[j], cx, y);
          cx += c.measureText(text[j]).width + spacing;
        }
      }
    }
  };

  g.U = U;
})(window);
