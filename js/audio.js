(function (g) {
  'use strict';

  // 全部音效由 WebAudio 实时合成，不依赖任何音频素材
  function AudioSys() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.noiseBuf = null;
    this.bgmT = 0;
    this.bgmStep = 0;
    this.bgmOn = true;
  }

  AudioSys.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} }
      return true;
    }
    var AC = g.AudioContext || g.webkitAudioContext;
    if (!AC) return false;
    try { this.ctx = new AC(); } catch (e) { return false; }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0.0001 : 0.65;
    this.master.connect(this.ctx.destination);
    this.noiseBuf = this.makeNoise(1.0);
    return true;
  };

  AudioSys.prototype.makeNoise = function (seconds) {
    var len = Math.floor(this.ctx.sampleRate * seconds);
    var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  };

  AudioSys.prototype.tone = function (freq, dur, type, gain, slideTo, delay) {
    if (!this.ctx || this.muted) return;
    var c = this.ctx;
    var t0 = c.currentTime + (delay || 0);
    var o = c.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    var gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.012);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(gn);
    gn.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  };

  AudioSys.prototype.noise = function (dur, opt) {
    if (!this.ctx || this.muted) return;
    opt = opt || {};
    var c = this.ctx;
    var t0 = c.currentTime + (opt.delay || 0);
    var src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    var f = c.createBiquadFilter();
    f.type = opt.type || 'lowpass';
    f.frequency.setValueAtTime(Math.max(30, opt.freq || 1000), t0);
    if (opt.slideTo) f.frequency.exponentialRampToValueAtTime(Math.max(30, opt.slideTo), t0 + dur);
    f.Q.value = opt.q || 1;
    var gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, opt.gain || 0.2), t0 + 0.008);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(gn);
    gn.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  };

  // ---- 具体音效 ----
  AudioSys.prototype.punch = function () {
    this.noise(0.07, { type: 'lowpass', freq: 900, gain: 0.22 });
    this.tone(150, 0.08, 'sine', 0.22, 86);
  };
  AudioSys.prototype.swish = function (heavy) {
    this.noise(heavy ? 0.16 : 0.1, { type: 'bandpass', freq: heavy ? 1600 : 2400, q: 0.7, gain: heavy ? 0.16 : 0.1, slideTo: 500 });
  };
  AudioSys.prototype.hit = function (tier) {
    tier = tier || 1;
    if (tier >= 4) {
      var finish = tier === 5;
      this.noise(finish ? 0.25 : 0.18, { type: 'lowpass', freq: finish ? 520 : 700, gain: finish ? 0.38 : 0.3 });
      this.tone(finish ? 72 : 95, finish ? 0.3 : 0.22, 'sine', finish ? 0.42 : 0.34, finish ? 30 : 42);
      this.tone(finish ? 240 : 320, 0.06, 'square', finish ? 0.1 : 0.08, 100);
    } else {
      this.noise(0.06 + tier * 0.02, { type: 'bandpass', freq: 1500 - tier * 200, q: 0.8, gain: 0.14 + tier * 0.04 });
      this.tone(280 - tier * 40, 0.06 + tier * 0.02, 'triangle', 0.08 + tier * 0.04, 110 - tier * 15);
    }
  };
  AudioSys.prototype.block = function (tier) {
    var gain = 1 + ((tier || 1) - 1) * 0.08;
    this.tone(1400, 0.05, 'square', 0.07 * gain, 900);
    this.noise(0.05, { type: 'highpass', freq: 3000, gain: 0.12 * gain });
  };
  AudioSys.prototype.shoot = function () {
    this.noise(0.18, { type: 'bandpass', freq: 600, q: 1.2, gain: 0.16, slideTo: 2800 });
    this.tone(680, 0.16, 'triangle', 0.07, 260);
  };
  AudioSys.prototype.projectileHit = function () {
    this.noise(0.2, { type: 'lowpass', freq: 1400, gain: 0.24, slideTo: 200 });
    this.tone(220, 0.18, 'sine', 0.16, 70);
  };
  AudioSys.prototype.dash = function () {
    this.noise(0.18, { type: 'highpass', freq: 400, gain: 0.14, slideTo: 2600 });
    this.tone(300, 0.12, 'triangle', 0.06, 900);
  };
  AudioSys.prototype.land = function () {
    this.noise(0.06, { type: 'lowpass', freq: 260, gain: 0.12 });
  };
  // 替身术：一声轻响 + 木头/烟雾的摩擦声
  AudioSys.prototype.substitute = function () {
    this.noise(0.22, { type: 'highpass', freq: 900, gain: 0.16, slideTo: 3200 });
    this.tone(520, 0.16, 'triangle', 0.08, 1180);
    this.tone(240, 0.3, 'sine', 0.09, 86, 0.03);
  };
  // 连击保护：护体震开
  AudioSys.prototype.guardBreak = function () {
    this.tone(660, 0.1, 'square', 0.06, 990);
    this.tone(990, 0.3, 'triangle', 0.07, 1320, 0.05);
    this.noise(0.3, { type: 'bandpass', freq: 1200, q: 1.1, gain: 0.13, slideTo: 3400 });
  };
  AudioSys.prototype.charge = function () {
    if (!this.ctx) return;
    this.tone(110, 0.9, 'sawtooth', 0.09, 520);
    this.noise(0.9, { type: 'bandpass', freq: 220, q: 1.4, gain: 0.12, slideTo: 2200 });
    this.tone(55, 0.9, 'sine', 0.14, 110);
  };
  AudioSys.prototype.ultBoom = function () {
    this.noise(0.7, { type: 'lowpass', freq: 1600, gain: 0.34, slideTo: 120 });
    this.tone(62, 0.8, 'sine', 0.4, 30);
    this.tone(1400, 0.5, 'triangle', 0.06, 240);
  };
  AudioSys.prototype.ultTick = function () {
    this.noise(0.06, { type: 'highpass', freq: 2400, gain: 0.08 });
    this.tone(880, 0.06, 'triangle', 0.05, 400);
  };
  AudioSys.prototype.ko = function () {
    this.tone(196, 1.4, 'sine', 0.26, 90);
    this.tone(98, 1.8, 'sine', 0.22, 49);
    this.noise(0.9, { type: 'lowpass', freq: 500, gain: 0.22, slideTo: 80 });
  };
  AudioSys.prototype.ui = function () {
    this.tone(760, 0.06, 'triangle', 0.06, 620);
  };
  AudioSys.prototype.ready = function () {
    this.tone(520, 0.12, 'triangle', 0.08, 520);
  };
  AudioSys.prototype.fight = function () {
    this.tone(780, 0.1, 'square', 0.07, 780);
    this.tone(1040, 0.18, 'triangle', 0.08, 1040, 0.06);
  };

  AudioSys.prototype.toggleMute = function () {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0.0001 : 0.65;
    return this.muted;
  };

  // 极简古风背景乐：五声音阶拨弦 + 低音持续音 + 稀疏鼓点
  AudioSys.prototype.updateBGM = function (dt) {
    if (!this.ctx || this.muted || !this.bgmOn) return;
    this.bgmT -= dt;
    if (this.bgmT > 0) return;
    this.bgmT = 0.42 + Math.random() * 0.3;
    this.bgmStep++;
    var scale = [146.83, 164.81, 196.0, 220.0, 261.63, 293.66, 329.63];
    var note = scale[(Math.random() * scale.length) | 0] * (Math.random() < 0.32 ? 2 : 1);
    var c = this.ctx;
    var t0 = c.currentTime + 0.03;
    var o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(note, t0);
    var gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(0.038, t0 + 0.02);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
    o.connect(gn);
    gn.connect(this.master);
    o.start(t0);
    o.stop(t0 + 1.6);

    if (this.bgmStep % 8 === 0) this.tone(73.42, 3.8, 'sine', 0.05);
    if (this.bgmStep % 4 === 0) this.noise(0.28, { type: 'lowpass', freq: 140, gain: 0.05 });
  };

  g.AudioSys = AudioSys;
})(window);
