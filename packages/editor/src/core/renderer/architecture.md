# `core/renderer` — Architecture

A glance-able map of the renderer subsystem. Read top-to-bottom: each section
zooms in one level — from the public interface, down to the GPU render tick,
down to the async frame pipeline and resource ownership rules.

> Source of truth for the contract: [`types.ts`](./types.ts).
> Source of truth for the GPU implementation: [`gpu/README.md`](./gpu/README.md).

---

## 1. Where the renderer sits

The renderer is the **last** stage of the pipeline. It reads only an immutable
`Scene` and writes to a canvas. It never touches `Project`, `Track`,
`TimelineEngine`, `PlaybackEngine`, Zustand, or React.

```mermaid
flowchart LR
    Project[Project / Tracks / Clips] --> Resolver[resolveTimeline]
    Playback[PlaybackEngine<br/>currentFrame] --> Resolver
    Resolver --> Scene[(Scene<br/>flat, immutable)]
    Scene --> Renderer
    Renderer --> Canvas[(Canvas<br/>pixels on screen)]

    subgraph Renderer [Renderer interface]
        direction TB
        Gpu[GpuRenderer ✓]
        Dom[DomRenderer ✗ future]
        C2d[Canvas2DRenderer ✗ future]
        Exp[ExportRenderer ✗ future]
    end

    classDef done fill:#1f6f1f,stroke:#0a0,color:#fff
    classDef todo fill:#444,stroke:#888,color:#ccc,stroke-dasharray:4 3
    class Gpu done
    class Dom,C2d,Exp todo
```

**Hard isolation rules** (every implementation must respect):

- Reads only the `Scene` it receives.
- `render(scene)` is **synchronous** and **idempotent on equal references**.
- `resize` mutates the canvas backing-store; `Scene.stage` is the logical
  coordinate space.

---

## 2. The `Renderer` interface

Four methods. Nothing else is public.

```mermaid
classDiagram
    class Renderer {
        <<interface>>
        +mount(container HTMLElement) void
        +resize(cssW, cssH, dpr?) void
        +render(scene Scene) void
        +dispose() void
    }

    class GpuRenderer {
        +mount()
        +resize()
        +render()
        +dispose()
        +setDebug(enabled)
    }

    Renderer <|.. GpuRenderer
```

Lifecycle, in order:

```mermaid
stateDiagram-v2
    [*] --> Constructed
    Constructed --> Mounted: mount(container)
    Mounted --> Mounted: resize(w, h, dpr)
    Mounted --> Mounted: render(scene)
    Mounted --> Disposed: dispose()
    Disposed --> [*]
    note right of Mounted
        render() is a no-op when:
        • scene === lastScene
        • context is lost
        • not yet mounted
    end note
```

---

## 3. GPU renderer — module map

Everything under `gpu/` collaborates around one idea: turn a `Scene` into a
sorted list of textured-quad draw calls, using GPU memory that is pooled and
async work that never blocks the render path.

```mermaid
flowchart TB
    subgraph public[Public surface]
        GR[GpuRenderer]
    end

    subgraph core[Core pipeline]
        RG[RenderGraph]
        WGL[WebGLContext]
        TP[TexturePool]
        SP[ShaderProgram]
        SH[shaders/<br/>quad.vert + quad.frag]
    end

    subgraph layers[Layers]
        VL[VideoLayer]
        TL[TestLayer]
    end

    subgraph frames[Frame pipeline]
        VFP[VideoFrameProvider<br/>Mock | Synthetic]
        VT[VideoTexture]
        FC[FrameCache]
        VDM[VideoDecoderManager]
        DMX[MediabunnyDemuxer]
    end

    subgraph dbg[debug/]
        Panel[GpuRendererDebugPanel]
        DGR[DebugGpuRenderer]
        Over[DebugOverlay]
        Cnt[GpuDebugCounters]
        PG[playground.ts]
    end

    GR --> WGL
    GR --> TP
    GR --> RG
    GR --> VL
    GR --> Panel

    RG --> VL
    RG --> TL

    VL --> VFP
    VL --> VT
    VL --> SP
    SP --> SH

    VT --> TP

    VFP --> FC
    VFP -.future.-> VDM
    VDM --> DMX
    VDM --> FC

    Panel --> Cnt
    VFP --> Cnt
    VT --> Cnt

    classDef future stroke-dasharray:4 3,color:#aaa
    class VDM,DMX future
```

> The dotted edge `VideoFrameProvider → VideoDecoderManager` is the
> not-yet-wired real backend; today `createVideoFrameProvider()` returns
> `SyntheticVideoFrameProvider` (in browsers) or `MockVideoFrameProvider`
> (in jsdom).

---

## 4. `GpuRenderer` — construction & disposal order

Order is load-bearing. Disposing the pool before the graph would leak
acquired textures.

```mermaid
sequenceDiagram
    autonumber
    participant App as React shell
    participant GR as GpuRenderer
    participant WGL as WebGLContext
    participant TP as TexturePool
    participant VL as VideoLayer
    participant RG as RenderGraph

    Note over App,RG: mount(container)
    App->>GR: mount(container)
    GR->>WGL: new (canvas + getContext webgl2)
    GR->>TP: new (maxTextures)
    GR->>VL: new (pool, providerFactory)
    GR->>RG: new
    GR->>RG: registerLayer(VL, scene→scene.videos, id, zIndex)
    GR-->>App: mounted

    Note over App,RG: dispose() — reverse order
    App->>GR: dispose()
    GR->>RG: dispose() (releases acquired textures → pool free-list)
    GR->>TP: dispose(gl) (gl.deleteTexture on every free entry)
    GR->>WGL: dispose() (removes listeners, loseContext)
```

---

## 5. The render tick

Called once per RAF tick by the React shell. Synchronous from top to bottom.
Async decode/upload happens out-of-band on **subsequent** ticks.

```mermaid
sequenceDiagram
    autonumber
    participant Shell as RAF loop
    participant GR as GpuRenderer
    participant WGL as WebGLContext
    participant RG as RenderGraph
    participant VL as VideoLayer
    participant VFP as VideoFrameProvider
    participant VT as VideoTexture
    participant GL as WebGL2

    Shell->>GR: render(scene)
    alt scene === lastScene OR context lost
        GR-->>Shell: no-op
    else fresh scene
        GR->>GR: measure FPS, start render timer
        GR->>WGL: clear()
        GR->>RG: execute(scene, ctx)

        loop per registered layer
            RG->>RG: diff active vs scene.videos
            RG->>VL: release(id) for each leaving
            RG->>VL: acquire(item, ctx) for each entering
        end

        RG->>RG: build drawList, sort by zIndex asc

        loop per draw entry
            RG->>VL: draw(item, ctx)
            VL->>VFP: getCurrent(sourceFrame) [sync]
            alt cache hit
                VFP-->>VL: VideoFrame (borrowed)
                VL->>VT: upload(gl, frame)
                VT->>GL: texImage2D
                VT->>VT: frame.close() (always)
            else cache miss
                VFP-->>VL: null
                VL->>VFP: requestFrame(sourceFrame) [fire-and-forget]
                Note over VL: keeps last texture content → no flicker
            end
            VL->>GL: program.use + bind VAO + uniforms + drawArrays
        end

        GR->>GR: lastScene = scene, record duration
    end
```

Key invariants this enforces:

- `render()` never awaits.
- `render()` never throws on a missed frame — it draws the last upload.
- Frame ownership: every frame passed to `upload()` is closed exactly once.

---

## 6. Async frame pipeline (out-of-band)

The provider is the boundary between the synchronous render thread and the
asynchronous decode/generation work. Everything below the dashed line happens
on its own schedule and reports back via the cache.

```mermaid
flowchart LR
    subgraph sync [Synchronous — inside render tick]
        VL[VideoLayer.draw]
        VL -- getCurrent(N) --> VFP
        VFP -- frame or null --> VL
    end

    VFP[(VideoFrameProvider)]
    FC[(FrameCache<br/>LRU, owns frames)]
    VFP --- FC

    subgraph async [Asynchronous — setTimeout / future decoder]
        REQ[requestFrame N]
        SYN[Synthetic: paint to OffscreenCanvas<br/>→ new VideoFrame]
        REAL[Future: VideoDecoderManager<br/>→ VideoDecoder.output]
    end

    VFP -- requestFrame(N) --> REQ
    REQ --> SYN
    REQ -. future .-> REAL
    SYN -- put(N, frame) --> FC
    REAL -. put(N, frame) .-> FC

    classDef future stroke-dasharray:4 3,color:#aaa
    class REAL future

    style sync fill:#143,stroke:#3a3
    style async fill:#332,stroke:#b80
```

Cache rules (see [`FrameCache.ts`](./gpu/FrameCache.ts)):

- `put` transfers ownership to the cache.
- `get` returns a **borrowed** reference — callers must not close it.
- When full, the entry with the **lowest** `sourceFrame` is evicted and closed.
- `VideoTexture.upload` is the only consumer that closes a borrowed frame —
  and only in a `finally` block, so the rule still holds end-to-end.

---

## 7. `VideoLayer` — provider & texture bookkeeping

`VideoLayer` is the only place that knows clips share decoders. Providers are
keyed by `src` and ref-counted across clips; textures are keyed by clip `id`.

```mermaid
flowchart TB
    subgraph clips[Active clips in Scene]
        C1[clipA &nbsp; src=a.mp4]
        C2[clipB &nbsp; src=a.mp4]
        C3[clipC &nbsp; src=b.mp4]
    end

    subgraph providers[_providers map &nbsp; key = src]
        Pa[ProviderEntry a.mp4<br/>refCount = 2]
        Pb[ProviderEntry b.mp4<br/>refCount = 1]
    end

    subgraph textures[_textures map &nbsp; key = clip id]
        Ta[VideoTexture clipA]
        Tb[VideoTexture clipB]
        Tc[VideoTexture clipC]
    end

    C1 --> Pa
    C2 --> Pa
    C3 --> Pb

    C1 --> Ta
    C2 --> Tb
    C3 --> Tc

    Ta --> Pool[(TexturePool)]
    Tb --> Pool
    Tc --> Pool
```

- `acquire(item)` → new `VideoTexture`, bump or create the provider entry.
- `release(id)`   → dispose the texture, decrement refCount, `markIdle()` at 0.
- `draw(item)`    → see render-tick diagram above.

---

## 8. `VideoDecoderManager` state machine

Not yet wired into the live render path, but fully implemented and tested.
One instance per unique source URL. Holds **no** GL objects, so it is immune
to context loss.

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Opening: open(src)
    Opening --> Ready: configure OK
    Opening --> Errored: open/configure fail

    Ready --> Decoding: requestFrame(N)
    Decoding --> Ready: queue drained
    Decoding --> Seeking: seek(N)
    Ready --> Seeking: seek(N)
    Seeking --> Ready: keyframe found
    Seeking --> Errored: demux fail

    Ready --> Draining: drain()
    Decoding --> Draining: drain()
    Draining --> Idle: flush done
    Draining --> Errored: flush fail

    Errored --> Idle: reopen(src)
    Errored --> [*]: dispose()
    Idle --> [*]: dispose()
    Ready --> [*]: dispose()
    Decoding --> [*]: dispose()
    Seeking --> [*]: dispose()
    Draining --> [*]: dispose()
```

Behavioural guarantees enforced by `_assertTransition`:

- Duplicate `requestFrame(N)` calls coalesce into one decode (the second
  awaits the first's promise).
- `seek()` rejects every pending decode with a `seek cancelled` error.
- `drain()` rejects every pending decode with a `drain cancelled` error.

---

## 9. Context loss & recovery

Browser GPU context loss can happen at any time (tab backgrounded, driver
reset, alt-tab). The renderer survives it because no module silently assumes
its GL handles are still valid.

```mermaid
sequenceDiagram
    autonumber
    participant Browser
    participant WGL as WebGLContext
    participant GR as GpuRenderer
    participant TP as TexturePool
    participant VL as VideoLayer
    participant VT as VideoTexture
    participant RG as RenderGraph

    Browser->>WGL: webglcontextlost (event)
    WGL->>WGL: e.preventDefault(), _lost=true, _gl=null
    WGL->>GR: onLost()
    GR->>TP: handleContextLost() (clear bookkeeping, no GL deletes)
    GR->>VL: notifyContextLost()
    VL->>VT: handleContextLost() (null _entry for each)
    VL->>VL: program=null, vao=null
    GR->>RG: notifyContextLost() (release all active items)
    GR->>GR: _lastScene = null

    Note over Browser,RG: ... context restoration ...

    Browser->>WGL: webglcontextrestored
    WGL->>WGL: re-acquire gl, _initGLState()
    WGL->>GR: onRestore()
    GR->>GR: reapply clearColor, _lastScene stays null

    Note over GR: next render(scene):
    GR->>RG: execute(scene, ctx) — every clip is "entering"
    RG->>VL: acquire() each clip
    VL->>VL: _ensurePipeline() rebuilds program + VAO
    VL->>VT: upload() re-acquires fresh PoolTexture
```

| Module                | Holds GL? | Recovery strategy                                 |
|-----------------------|:--------:|---------------------------------------------------|
| `WebGLContext`        | yes (the context itself) | re-`getContext` on restore, re-run `_initGLState` |
| `TexturePool`         | yes      | `handleContextLost()` clears handles, no deletes  |
| `VideoTexture`        | yes      | `handleContextLost()` nulls `_entry`; re-acquires on next upload |
| `VideoLayer`          | yes (program + VAO) | nulls them; `_ensurePipeline()` rebuilds         |
| `RenderGraph`         | no       | releases all active items; next tick re-acquires  |
| `FrameCache`          | no       | unchanged                                          |
| `VideoDecoderManager` | no       | unchanged                                          |

---

## 10. Frame ownership — single rule, end-to-end

This is the one rule that, if violated, leaks GPU memory.

```mermaid
flowchart LR
    A[Source: Synthetic paint<br/>or VideoDecoder.output] -->|new VideoFrame| FC
    FC[FrameCache<br/>OWNS frames] -->|borrow via get| VL[VideoLayer.draw]
    VL -->|hand off to| VT[VideoTexture.upload]
    VT -->|finally close| X((frame.close))

    FC -.LRU evict.-> X
    FC -.dispose / clear.-> X

    classDef owner fill:#143,stroke:#3a3
    class FC owner
```

Every arrow into `X` happens **exactly once per frame**, and they are mutually
exclusive: the cache stops owning a frame the moment it is given to
`VideoTexture.upload`, and the upload always closes it in `finally`.

---

## 11. Debug pipeline (optional)

Imported only when needed. Zero impact on production rendering.

```mermaid
flowchart LR
    PG[playground.ts<br/>loadDebugScenario A..E] --> DGR[DebugGpuRenderer]
    DGR --> TL[TestLayer<br/>solid-colour quads]
    DGR --> Overlay[DebugOverlay<br/>FPS + bboxes]

    GR[GpuRenderer] -.setDebug true.-> Panel[GpuRendererDebugPanel<br/>polls every 100ms]
    Panel --> Snap[DebugPanelSnapshot<br/>fps, clips, textures, cache hit ratio, render ms]

    Cnt[(GpuDebugCounters)]
    VFP[VideoFrameProvider] --> Cnt
    VT[VideoTexture] --> Cnt
    VDM[VideoDecoderManager] --> Cnt
    Cnt --> Panel
    Cnt --> Overlay
```

The debug renderer is a **parallel** implementation that shares only
`WebGLContext`, `TexturePool`, and `RenderGraph` — it exists to exercise the
shader / transform / zIndex paths without any decode plumbing.

---

## 12. What is done vs. what is next

```mermaid
graph LR
    subgraph done[Done — usable today]
        D1[Renderer interface]
        D2[WebGLContext + context-loss recovery]
        D3[TexturePool LRU 16-cap]
        D4[ShaderProgram + quad shaders]
        D5[RenderGraph diff/acquire/release/zSort]
        D6[VideoLayer Scene→draw with transform/opacity]
        D7[VideoTexture frame-ownership invariant]
        D8[FrameCache LRU + onPut/onEvict hooks]
        D9[VideoFrameProvider Mock + Synthetic]
        D10[VideoDecoderManager state machine + tests]
        D11[MediabunnyDemuxer adapter shape]
        D12[Debug overlay + scenarios A..E]
        D13[18 vitest suites green]
    end

    subgraph next[Next]
        N1[Wire VideoDecoderManager into provider]
        N2[Implement createDefaultBackend mediabunny]
        N3[DomRenderer for cheap MVP]
        N4[ExportRenderer Worker + VideoEncoder]
        N5[Wire setDebug into apps/playground/GpuPreview]
    end

    done --> next

    classDef done fill:#1f6f1f,stroke:#0a0,color:#fff
    classDef next fill:#444,stroke:#888,color:#ccc,stroke-dasharray:4 3
    class D1,D2,D3,D4,D5,D6,D7,D8,D9,D10,D11,D12,D13 done
    class N1,N2,N3,N4,N5 next
```

---

## File index (quick jump)

| Concern                   | File                                                                 |
|---------------------------|----------------------------------------------------------------------|
| Public interface          | [`types.ts`](./types.ts)                                             |
| GPU entry point           | [`gpu/GpuRenderer.ts`](./gpu/GpuRenderer.ts)                         |
| Scene diff / dispatch     | [`gpu/RenderGraph.ts`](./gpu/RenderGraph.ts)                         |
| GL context + recovery     | [`gpu/WebGLContext.ts`](./gpu/WebGLContext.ts)                       |
| Texture allocator         | [`gpu/TexturePool.ts`](./gpu/TexturePool.ts)                         |
| Shader helper             | [`gpu/ShaderProgram.ts`](./gpu/ShaderProgram.ts) + [`gpu/shaders/`](./gpu/shaders) |
| Video layer               | [`gpu/layers/VideoLayer.ts`](./gpu/layers/VideoLayer.ts)             |
| Per-clip GPU texture      | [`gpu/VideoTexture.ts`](./gpu/VideoTexture.ts)                       |
| Frame access boundary     | [`gpu/VideoFrameProvider.ts`](./gpu/VideoFrameProvider.ts)           |
| Decoded-frame cache       | [`gpu/FrameCache.ts`](./gpu/FrameCache.ts)                           |
| Decoder + state machine   | [`gpu/VideoDecoderManager.ts`](./gpu/VideoDecoderManager.ts)         |
| Demuxer adapter           | [`gpu/demuxer/MediabunnyDemuxer.ts`](./gpu/demuxer/MediabunnyDemuxer.ts) |
| Debug renderer & overlay  | [`gpu/debug/`](./gpu/debug)                                          |
| Tests (162 across 18 files) | [`gpu/__tests__/`](./gpu/__tests__)                                |
