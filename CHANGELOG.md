# Changelog

## [0.2.0](https://github.com/navio/workflow-manager/compare/runner-v0.1.0...runner-v0.2.0) (2026-05-02)


### Features

* add authenticated CLI run telemetry ([a42dc07](https://github.com/navio/workflow-manager/commit/a42dc07ec4ab86f9c0f4b128500326f4f7a42ae2))
* add claude-code executor with streaming output and interactive approval gates ([fa8b7f5](https://github.com/navio/workflow-manager/commit/fa8b7f5d9a934252529d40fb69d5b4a5ea414bdc))
* add curl installer for release binaries ([3b6abc7](https://github.com/navio/workflow-manager/commit/3b6abc7c6f0b870c602cdd04ee29bae2235309e7))
* add curl installer for release binaries ([d4959e0](https://github.com/navio/workflow-manager/commit/d4959e0f1f0e4bf6e777bd79b3f4a8bdf2028b09))
* add dashboard workflow publishing ([1a21075](https://github.com/navio/workflow-manager/commit/1a21075f4153f547e876aaacaa297ef0651038af))
* add JSON workflow support and CLI man help ([fd82495](https://github.com/navio/workflow-manager/commit/fd82495f206bb9773b6c740f7d14240efd1e7e03))
* add real opencode adapter e2e smoke tests ([f06a43c](https://github.com/navio/workflow-manager/commit/f06a43c500592d6f8214560e7f5e80cc7f431c7e))
* add registry dashboard analytics and token management ([4efb4a9](https://github.com/navio/workflow-manager/commit/4efb4a91a5552254bfe6ac26fe704bce3cc7d120))
* add remote registry analytics operations ([90ef199](https://github.com/navio/workflow-manager/commit/90ef199ef68dcd19b3f26008b8d8c498d72b4fba))
* add remote registry CLI commands ([3e8d7cc](https://github.com/navio/workflow-manager/commit/3e8d7cc55722a64f8a64251447dcea3838f03269))
* add remote registry Supabase foundation ([c718e23](https://github.com/navio/workflow-manager/commit/c718e234788efdc4866df17733d0faf55c2b5b8b))
* add remote registry Supabase foundation ([99df91a](https://github.com/navio/workflow-manager/commit/99df91a0fc87420307d85b6f58be3335bec2aa5e))
* add resolveSkill with embedded content tier ([f2e1f53](https://github.com/navio/workflow-manager/commit/f2e1f537b26cc8c26be8518979d69c71a998d3a9))
* add SkillEntry type and skills field to WorkflowDefinition ([508a285](https://github.com/navio/workflow-manager/commit/508a285864e84996f54e4a93569ca43a73ef15e8))
* add workflow version management in dashboard ([4701c5a](https://github.com/navio/workflow-manager/commit/4701c5a86e61421e01b147de8c3e21172a427eea))
* claudeCodeExecutor injects resolved skill content into prompt ([ed8aeb7](https://github.com/navio/workflow-manager/commit/ed8aeb7fb8a83cb0006ff1e5f0bf388b07aa0334))
* harden skill resolution with portable hashes and source policy ([9d9fe39](https://github.com/navio/workflow-manager/commit/9d9fe39a732edd684a8ae3069fde90c07749329c))
* initialize workflow-manager with CLI engine and VitePress docs ([c89d2a1](https://github.com/navio/workflow-manager/commit/c89d2a1e92f2340ae00b1c4aa3d3edafc63dea76))
* parser preserves skills map through normalization ([fc0a5b9](https://github.com/navio/workflow-manager/commit/fc0a5b9466775a9b8150098e6b436a2946fd5c3f))
* publish command bundles local skill source files into workflow JSON ([94af83a](https://github.com/navio/workflow-manager/commit/94af83a0b681ccb79a8d0eb8911886b75241a084))
* **remote-registry:** finalize redesign system and UX polish ([05c3ea1](https://github.com/navio/workflow-manager/commit/05c3ea16d13a5b7780a6ee4e56e0adca8c7413d8))
* **remote-registry:** finalize redesign system and UX polish ([de98dd2](https://github.com/navio/workflow-manager/commit/de98dd23e7ae933b8ee0ef01f68e7b3c680817a1))
* rename the runner package and auto-publish it ([fd0768f](https://github.com/navio/workflow-manager/commit/fd0768f77d64ce93e4dde9f0706e7dfea667d000))
* resolveSkill reads from skills[name].source path ([6c1a14f](https://github.com/navio/workflow-manager/commit/6c1a14f66eb28f5d5ee1d2e9ddfdddeaaa2d0d72))
* resolveSkill supports project, user-global, and npm tiers with name safety ([ccb5d80](https://github.com/navio/workflow-manager/commit/ccb5d805de8a8537e2e245a03dfa147bc01cd5c5))
* ship agent skills with the CLI package ([6eb99df](https://github.com/navio/workflow-manager/commit/6eb99df072321c3370e594be53eb0e06f146632c))
* ship local spec-driven-development skill, update demo workflow to use it ([a77e044](https://github.com/navio/workflow-manager/commit/a77e044b3e836ebc09c2714e72a78a18d324a936))
* skill resolution — workflows ship with their own skills ([2d07916](https://github.com/navio/workflow-manager/commit/2d079169c19c22123c64fc0aee6b09e0aaf57608))
* support JSON workflows and add CLI man help ([e3f9c1b](https://github.com/navio/workflow-manager/commit/e3f9c1b0da2d13c3928543e24bfcaa75a26ed37c))


### Bug Fixes

* correct broken Bun dev script path ([9d9da6d](https://github.com/navio/workflow-manager/commit/9d9da6d2be0efd43fc7b96d8e8130d6ee1fc29bb))
* correct dev script path for bun run ([d9d0719](https://github.com/navio/workflow-manager/commit/d9d071975535734549660511695526aa372910e5))
* correct registry auth redirect and netlify routes ([d24781f](https://github.com/navio/workflow-manager/commit/d24781f427a896a581c370e92a04581946ce4b8d))
* correct skill source references ([0aceb12](https://github.com/navio/workflow-manager/commit/0aceb12297b3df8695a1f8afb5a37afd12cff65a))
* emit waiting event instead of cancelled on confirmation pause ([c24ee22](https://github.com/navio/workflow-manager/commit/c24ee223fdc1dab9a4e4d56b01017c30afb78e43))
* enforce required step fields in workflow validation ([5e9d90e](https://github.com/navio/workflow-manager/commit/5e9d90e9d46e110192e4a780b27d03339c70247e))
* harden real opencode executor input handling ([931ab24](https://github.com/navio/workflow-manager/commit/931ab24dc834def63ed65db8a7b054de55c789bb))
* preserve validation gates and bundled artifacts ([08b576b](https://github.com/navio/workflow-manager/commit/08b576b5c128c62bfbff1f730073aba31d5f3f40))
* route Netlify builds per site target ([8e03fbb](https://github.com/navio/workflow-manager/commit/8e03fbb308d87794a0fee56569683984fdb4de29))
* support Netlify builds from app base dirs ([a9f61a1](https://github.com/navio/workflow-manager/commit/a9f61a1d2ac5ada691770d63e9a3512b762bad72))
* support owner id fallback for remote workflows ([486f4ee](https://github.com/navio/workflow-manager/commit/486f4ee2770dd1d5781ab0389f2d879292155609))
* support Supabase ES256 browser sessions ([850f54c](https://github.com/navio/workflow-manager/commit/850f54c8571bc7f07a0ee62fb5796eba44d2443b))
