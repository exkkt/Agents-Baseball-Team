// 描画の速さと切り離して、動作の時間を固定刻み（1/60 秒）で進める。ゲーム内の時計は Club.rate で同時に進む。
// 速度 1×・2×・4× や早送りは 1 フレームあたりの刻みの数が変わるだけなので、同じゲーム内時間なら同じ計算結果になる。DOM に依存しない
export const STEP = 1 / 60;
export class Stepper {
  constructor({ maxFrame = 0.1, maxSteps = 64 } = {}) { this.acc = 0; this.maxFrame = maxFrame; this.maxSteps = maxSteps; this.steps = 0; }
  advance(club, realDt, speed = 1, paused = false) {
    if (paused) return 0; // 一時停止中はゲーム内時間・練習・成長・分析作業も止まる
    this.acc += Math.min(this.maxFrame, Math.max(0, realDt)) * speed;
    let n = 0;
    while (this.acc >= STEP - 1e-9 && n < this.maxSteps) { club.step(STEP); this.acc -= STEP; n++; }
    this.steps += n;
    return n;
  }
  // 早送り：通常と同じ刻みを、時間の許す限りまとめて実行する（時計だけを飛ばさない）。
  // until はゲーム内の分。stop() が真を返したら途中で止める。戻り値 { steps, done, stopped }
  fastForward(club, until, { budgetMs = 24, now = () => Date.now(), stop = () => false, maxSteps = 200000 } = {}) {
    const t0 = now(); let n = 0, stopped = false;
    this.acc = 0;
    while (club.minutes < until && n < maxSteps) {
      club.step(STEP); n++;
      if (n % 60 === 0) { if (stop()) { stopped = true; break; } if (now() - t0 > budgetMs) break; }
    }
    this.steps += n;
    return { steps: n, done: club.minutes >= until, stopped };
  }
}
