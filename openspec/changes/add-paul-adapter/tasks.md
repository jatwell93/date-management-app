## 1. Adapter

- [x] 1.1 Decide the archive mapping and the sidecar file format; record both in design.md.
      Demo: design.md answers each gap in section 4 of `extract-software-factory` design.md.
- [ ] 1.2 Implement `adapters/paul.js` in software-factory and run the contract suite against it.
      Demo: the contract suite passes for `paul`, with a fixture of phase `01-fix-one`, three plans and a sidecar.
      Blocked by: 1.1.
- [ ] 1.3 (owner) Decide how the five skills run for a PAUL project: PAUL's own close step before the tick, and an archive step that writes the `ARCHIVED` marker. Record the decision in design.md.
      Demo: design.md names each skill step that changes for PAUL and what replaces it.
      Blocked by: 1.2.
- [ ] 1.4 Build the skill changes decided in 1.3, in the software-factory repo.
      Demo: `run-spec` on a PAUL fixture project ticks a plan and archives a phase without an `openspec` call.
      Blocked by: 1.3.
- [ ] 1.5 (owner) Run one small change on a real PAUL project through the factory.
      Demo: a merged PR on that project.
      Blocked by: 1.4.
