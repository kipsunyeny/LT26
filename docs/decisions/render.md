# Render & audio decisions (agent: render)

- **Talilei's drawn ball is erased at load time.** The brand art has a ball between his feet; a canvas `destination-out` pass (traced leg edge + circle, `processTalileiImage`) removes it so only the real 3D ball shows. The source asset is untouched.
- **Talilei is hidden under the title camera, and so are trails/ghost/aim.** The title UI shows its own 2D Talilei over a dimmed backdrop; a second 3D one would duplicate him.
- **Kick camera: 4.5 m behind, 2.3 m high, shifted 0.5 m away from the taker, pitch chosen so the resting ball sits at NDC y = −0.55.** This puts Talilei (placed left of the ball by the sim) in the lower-left and the crossbar in the top third at every distance from 11 to 35 m. The taker side is inferred from `world.taker.p`, so left-footers mirror automatically.
- **Kick camera anchor follows the ball only while it rests (< 1 m/s, y < 0.25) with the taker within 4 m of it,** smoothed (τ = 0.25 s), and snaps on `setMode`/`setCamera('kick')`. The camera follows spot changes in setup but stays put when the ball stops in the net or a long-shot push rolls away.
- **`setTrail(points)` with `ghost` undefined leaves the ghost unchanged; `null` clears it.** The UI can then update the live trail every frame without passing the ghost again.
- **Ball spin integrates over the snapshot clock (`world.t` delta) when it advances, else over render dt.** Replays played at 0.35× therefore spin at 0.35× too.
- **`getStats().frameMs` is an EMA of the wall-clock interval between `render()` calls** (the frame period), not CPU time.
- **`createScene` returns `SceneDebugApi` (a `SceneApi` plus `ready: Promise` and `setDynamicVisible`).** The harness uses these to wait for the sprite and to measure the static scene on its own. It is still assignable to `SceneApi`.
- **The far half of the pitch and the far goal are built, merged into the same meshes (no extra draw calls),** so replay/title cameras never see an empty end.
- **Night stadium with a single rounded "bowl" of stands (one crowd mesh, one 2048×1024 canvas texture), no shadow maps.** Blob shadows are one InstancedMesh. Lambert/Basic materials only.
- **Replay orbit sweeps ±18° with a 30 s period (< 4°/s), high side view on the side opposite the ball's start, distance fitted to the path's bounding sphere.**
- **Audio `play('crowd', i)`: i < 0.5 (default 0.3) keeps the murmur loop running; i ≥ 0.5 also adds a cheer swell.** The contract has one `crowd` name for both. A murmur requested before `unlock()` starts once the context resumes.
- **The AudioContext is created in `unlock()`, not in `createAudio()`,** so Chrome never warns about an autoplay-blocked context.
- **No `tests/e2e/render.spec.ts`.** The E2E suite runs against the production build, which doesn't include the harness; the harness is checked with `tests/harness/shoot.mjs` instead, as briefed.
