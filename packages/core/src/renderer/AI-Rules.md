You are working inside a browser-native GPU media runtime codebase.

Before implementing anything:

1. Read:

- evolution.md
- architecture.md
- README.md
- all nearby architecture files
- relevant tests
- related renderer/layer/provider/engine abstractions

2. Preserve all architectural invariants.
   Do NOT violate:

- synchronous render invariant
- Scene immutability
- renderer isolation
- frame ownership contracts
- single clock authority
- RenderGraph ownership model

3. Any new subsystem MUST:

- include README.md updates
- include architecture.md updates
- include evolution.md updates
- include JSDoc comments
- include lifecycle documentation
- include tests
- include future extension seams where relevant

4. If a folder lacks:

- README.md
- architecture.md

create them.

5. Add:

- sequence diagrams
- lifecycle diagrams
- ownership notes
- threading notes
  where useful.

6. Add Vitest coverage for:

- happy path
- lifecycle
- stress conditions
- cleanup/disposal
- edge cases
- invariant enforcement

7. Never introduce:

- React inside renderer
- async inside render()
- multiple clock authorities
- direct store access from renderer
- singleton GPU resources
- hidden ownership semantics

8. Update evolution.md with:

- date
- subsystem added
- architectural reasoning
- tradeoffs
- invariants preserved
- future implications
- known risks

9. Keep implementation production-oriented.
   Avoid temporary hacks unless explicitly marked.

10. If architectural drift appears:
    STOP and propose a cleaner abstraction before implementation.
