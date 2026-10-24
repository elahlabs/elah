# Page example: Orbit 2, 6 s, two scenes, dark-glass tokens

Validates clean (OK, 2 scenes, 13 animations, no warnings). Wrap the two blocks in the envelope from `page.md` with `durationSeconds: 6`, stage 1920x1080, fps 30.

```html
<main class="stage">
  <div class="glow"></div>
  <div class="cam">
    <section class="scene s1" data-scene="open">
      <p class="label l1">ORBIT 2 / PREVIEW</p>
      <h1 class="hero h1">Quiet power.</h1>
      <span class="rule r1"></span>
      <p class="sub u1">All day, every day.</p>
    </section>
    <section class="scene s2" data-scene="close">
      <span class="dot"></span>
      <p class="label l2">AVAILABLE NOW</p>
      <h1 class="hero h2">Orbit 2</h1>
      <span class="rule r2"></span>
      <p class="sub u2">Hear the difference.</p>
    </section>
  </div>
</main>
```

```css
.stage {
  --bg: #0b0f14; --ink: #f4f6f8; --muted: #8a94a3; --accent: #5eead4; --accent-soft: #134e4a; --surface: #151b24;
  --arrive: cubic-bezier(0.19, 1, 0.22, 1);        /* expo-out: hero and text arrivals */
  --pop: cubic-bezier(0.34, 1.56, 0.64, 1);        /* spring:bouncy, scale only */
  --exit: cubic-bezier(0.55, 0.055, 0.675, 0.19);  /* cubic-in */
  --draw: cubic-bezier(0.215, 0.61, 0.355, 1);     /* cubic-out */
  --travel: cubic-bezier(0.65, 0, 0.35, 1);        /* smooth */
  position: absolute; inset: 0; overflow: hidden; background: var(--bg); color: var(--ink);
  font-family: inter, sans-serif; font-weight: 400;
}
.cam, .scene { position: absolute; inset: 0; }
.cam { animation: push 6s var(--travel) 0s both; }
.glow {
  position: absolute; left: 1010px; top: 90px; width: 900px; height: 900px; border-radius: 50%;
  background: radial-gradient(circle, var(--accent-soft) 0%, transparent 68%); opacity: 0.55;
  animation: drift 6s var(--travel) 0s both;
}
.label { position: absolute; left: 160px; margin: 0; font-family: space-grotesk, sans-serif; font-size: 54px; letter-spacing: 6px; color: var(--muted); }
.hero { position: absolute; left: 160px; width: 1300px; margin: 0; font-size: 200px; line-height: 1.05; letter-spacing: 3px; font-weight: 400; }
.sub { position: absolute; left: 160px; margin: 0; font-size: 86px; line-height: 1.1; }
.rule { position: absolute; left: 160px; width: 360px; height: 2px; background: var(--muted); transform-origin: left center; }
.dot { position: absolute; left: 1150px; top: 330px; width: 24px; height: 24px; border-radius: 50%; background: var(--accent); }

.label { top: 330px; } .hero { top: 400px; } .rule { top: 660px; } .sub { top: 700px; }

.s1 { animation: scene-out 0.4s var(--exit) 3s both; }
.s2 { opacity: 0; animation: scene-in 0.4s var(--travel) 3s both; }

.l1 { animation: slide-x 0.6s var(--arrive) 0.25s both; }
.h1 { animation: blur-in 0.9s var(--arrive) -0.15s both; }
.r1 { animation: draw 0.8s var(--draw) 0.9s both; }
.u1 { animation: rise 0.6s var(--arrive) 1.2s both; }

.dot { animation: pop 0.5s var(--pop) 3.3s both; }
.l2 { animation: slide-x 0.6s var(--arrive) 3.25s both; }
.h2 { animation: blur-in 0.9s var(--arrive) 3.35s both; }
.r2 { animation: draw 0.8s var(--draw) 4.1s both; }
.u2 { animation: rise 0.6s var(--arrive) 4.2s both; }

@keyframes push { from { transform: scale(1); } to { transform: scale(1.04); } }
@keyframes drift { from { transform: translate(0, 0); } to { transform: translate(-140px, 40px); } }
@keyframes scene-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes scene-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes slide-x { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: none; } }
@keyframes blur-in { from { opacity: 0; filter: blur(12px); transform: translateY(24px); } to { opacity: 1; filter: blur(0); transform: none; } }
@keyframes rise { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: none; } }
@keyframes draw { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes pop { from { opacity: 0; transform: scale(0.35); } to { opacity: 1; transform: scale(1); } }
```

Beat read: scene 1 0-3.4 s (hero blurs in at t = 0, label slides, rule draws, sub rises 0.3 s apart); scene 2 3.0-6 s (dot pops,
label, hero, rule, sub in order 0.1-0.15 s apart, held 1 s). Validator: `OK: page ... 2 scenes, 13 animations`, no warnings.
