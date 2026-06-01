# core/media

Producers of frames and samples for downstream consumers (renderer, exporter).

Subfolders:
- video/   — WebCodecs-backed video decoding (this PR)
- audio/   — planned, Session 4
- text/    — planned, Session 3 (glyph rasterization to bitmaps/atlases)
- image/   — planned, Session 3

Rules:
- This layer must not import from core/renderer/** or core/assets/**.
- Consumers (renderer, exporter) import only the interfaces exposed by each subfolder's barrel.
