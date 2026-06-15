# Changelog

## [0.4.1](https://github.com/navio/workflow-manager/compare/v0.4.0...v0.4.1) (2026-06-15)


### Bug Fixes

* **runner:** warn instead of silently mocking claude-code/opencode ([#75](https://github.com/navio/workflow-manager/issues/75)) ([2c4cfbf](https://github.com/navio/workflow-manager/commit/2c4cfbf848749578ec478ec7d6c61cc34c13c8f1))

## [0.4.0](https://github.com/navio/workflow-manager/compare/v0.3.0...v0.4.0) (2026-06-13)


### ⚠ BREAKING CHANGES

* **cli:** the `wfm agent` command is removed. Use `wfm skill install` to install WFM usage guidance for agents instead.

### Features

* **cli:** replace wfm agent with wfm skill install ([#73](https://github.com/navio/workflow-manager/issues/73)) ([de89a70](https://github.com/navio/workflow-manager/commit/de89a70f5ebf3c776eea008acfddb0537922dfbf))

## [0.3.0](https://github.com/navio/workflow-manager/compare/runner-v0.2.0...runner-v0.3.0) (2026-06-12)


### ⚠ BREAKING CHANGES

* **runner:** the default pi-agent command is now `pi` and custom commands receive input/output paths via WFM_PI_INPUT_FILE and WFM_PI_OUTPUT_FILE environment variables instead of --input/--output argv flags.

### Features

* add authenticated CLI run telemetry ([a42dc07](https://github.com/navio/workflow-manager/commit/a42dc07ec4ab86f9c0f4b128500326f4f7a42ae2))
* add claude-code executor with streaming output and interactive approval gates ([fa8b7f5](https://github.com/navio/workflow-manager/commit/fa8b7f5d9a934252529d40fb69d5b4a5ea414bdc))
* add curl installer for release binaries ([3b6abc7](https://github.com/navio/workflow-manager/commit/3b6abc7c6f0b870c602cdd04ee29bae2235309e7))
* add curl installer for release binaries ([d4959e0](https://github.com/navio/workflow-manager/commit/d4959e0f1f0e4bf6e777bd79b3f4a8bdf2028b09))
* add dashboard workflow publishing ([1a21075](https://github.com/navio/workflow-manager/commit/1a21075f4153f547e876aaacaa297ef0651038af))
* add JSON workflow support and CLI man help ([fd82495](https://github.com/navio/workflow-manager/commit/fd82495f206bb9773b6c740f7d14240efd1e7e03))
* add live runner attach API ([ffb8dc5](https://github.com/navio/workflow-manager/commit/ffb8dc51897dcaf4b515a7d3ff6bf5bb125eae02))
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
* **cli:** add agent rules command ([#64](https://github.com/navio/workflow-manager/issues/64)) ([89411f3](https://github.com/navio/workflow-manager/commit/89411f3533b167b7392ad8e1b1978869bce57eaa))
* **cli:** add inline approval review prompts ([4d79771](https://github.com/navio/workflow-manager/commit/4d79771e18d7a09c572a0fd85b7b6865ffa53dcc))
* **cli:** add live workflow progress output ([8b055ee](https://github.com/navio/workflow-manager/commit/8b055ee66a808eae34f7d1b40ca7c3375f4c74a4))
* **cli:** add live workflow progress output ([68db1dc](https://github.com/navio/workflow-manager/commit/68db1dc57b1193693639afe66199bdaccf24516c))
* **cli:** add workflow-manager command alias ([d3dca2f](https://github.com/navio/workflow-manager/commit/d3dca2f3a8139e845594426ffeea58af09cf0e98))
* harden skill resolution with portable hashes and source policy ([9d9fe39](https://github.com/navio/workflow-manager/commit/9d9fe39a732edd684a8ae3069fde90c07749329c))
* initialize workflow-manager with CLI engine and VitePress docs ([c89d2a1](https://github.com/navio/workflow-manager/commit/c89d2a1e92f2340ae00b1c4aa3d3edafc63dea76))
* parser preserves skills map through normalization ([fc0a5b9](https://github.com/navio/workflow-manager/commit/fc0a5b9466775a9b8150098e6b436a2946fd5c3f))
* publish command bundles local skill source files into workflow JSON ([94af83a](https://github.com/navio/workflow-manager/commit/94af83a0b681ccb79a8d0eb8911886b75241a084))
* **remote-registry:** add handle onboarding and first-run dashboard state ([5409b7a](https://github.com/navio/workflow-manager/commit/5409b7ab9c673fd03e0de32a79cd9cd4de629585))
* **remote-registry:** complete signup/auth redesign with onboarding + regression smokes ([bf08bc2](https://github.com/navio/workflow-manager/commit/bf08bc2a490e6b15d22e4d7ab44fbfda5fdaa74d))
* **remote-registry:** finalize redesign system and UX polish ([05c3ea1](https://github.com/navio/workflow-manager/commit/05c3ea16d13a5b7780a6ee4e56e0adca8c7413d8))
* **remote-registry:** finalize redesign system and UX polish ([de98dd2](https://github.com/navio/workflow-manager/commit/de98dd23e7ae933b8ee0ef01f68e7b3c680817a1))
* **remote-registry:** implement auth guards and phase 3 auth flows ([e13a73a](https://github.com/navio/workflow-manager/commit/e13a73a21be0fe0b84c2e4b345854a8eb71a3ec7))
* rename the runner package and auto-publish it ([fd0768f](https://github.com/navio/workflow-manager/commit/fd0768f77d64ce93e4dde9f0706e7dfea667d000))
* resolveSkill reads from skills[name].source path ([6c1a14f](https://github.com/navio/workflow-manager/commit/6c1a14f66eb28f5d5ee1d2e9ddfdddeaaa2d0d72))
* resolveSkill supports project, user-global, and npm tiers with name safety ([ccb5d80](https://github.com/navio/workflow-manager/commit/ccb5d805de8a8537e2e245a03dfa147bc01cd5c5))
* run tasks with pi-agent by default ([a29eb5e](https://github.com/navio/workflow-manager/commit/a29eb5ed5d86b3fce6217d0540901c5eb1db1456))
* run tasks with pi-agent by default ([75e126f](https://github.com/navio/workflow-manager/commit/75e126fcbbe3798c7d251be9aa8c1c3f3bcc68c1))
* **runner:** drive the pi coding agent CLI from the default pi-agent adapter ([#67](https://github.com/navio/workflow-manager/issues/67)) ([ff7bf9b](https://github.com/navio/workflow-manager/commit/ff7bf9b36dee38c5de11aead719a5dba1ffba5a8))
* ship agent skills with the CLI package ([6eb99df](https://github.com/navio/workflow-manager/commit/6eb99df072321c3370e594be53eb0e06f146632c))
* ship local spec-driven-development skill, update demo workflow to use it ([a77e044](https://github.com/navio/workflow-manager/commit/a77e044b3e836ebc09c2714e72a78a18d324a936))
* skill resolution — workflows ship with their own skills ([2d07916](https://github.com/navio/workflow-manager/commit/2d079169c19c22123c64fc0aee6b09e0aaf57608))
* support JSON workflows and add CLI man help ([e3f9c1b](https://github.com/navio/workflow-manager/commit/e3f9c1b0da2d13c3928543e24bfcaa75a26ed37c))


### Bug Fixes

* address open runner and registry bugs ([#57](https://github.com/navio/workflow-manager/issues/57)) ([cefd4e7](https://github.com/navio/workflow-manager/commit/cefd4e75edb2d5b147506a497b297c2cef23f684))
* align Supabase migration history ([45e24ef](https://github.com/navio/workflow-manager/commit/45e24eff20ad6cc6f3e2bab41391604f197e0803))
* allow CI lint on migration-only changes ([73da04f](https://github.com/navio/workflow-manager/commit/73da04fb7318523902dc922942b2a92adf2fcd13))
* **ci:** resolve lint and remote-registry frozen lock failures ([9d14171](https://github.com/navio/workflow-manager/commit/9d141713d263b128b063282055ef1a88a67a2f79))
* **ci:** use release-safe test target ([#62](https://github.com/navio/workflow-manager/issues/62)) ([6b89b73](https://github.com/navio/workflow-manager/commit/6b89b73853e9bf25a2c90c8847c85862149c3f75))
* clarify draft workflow visibility ([7f8489e](https://github.com/navio/workflow-manager/commit/7f8489eed4ac34031617b0375b4b4eb7375122f8))
* **cli:** let terminal and API resolve waits ([9ce6c33](https://github.com/navio/workflow-manager/commit/9ce6c3347e51426bb7740fe22cc4d295f2321d7c))
* **cli:** pause progress heartbeat during prompts ([d082ee2](https://github.com/navio/workflow-manager/commit/d082ee2c01b68f3dfeeb50bcb23a1f8927c53c42))
* **cli:** prompt inline for external validation ([5291d45](https://github.com/navio/workflow-manager/commit/5291d4539fc3d43a4a928c7dabe61504acd1e36f))
* correct broken Bun dev script path ([9d9da6d](https://github.com/navio/workflow-manager/commit/9d9da6d2be0efd43fc7b96d8e8130d6ee1fc29bb))
* correct dev script path for bun run ([d9d0719](https://github.com/navio/workflow-manager/commit/d9d071975535734549660511695526aa372910e5))
* correct registry auth redirect and netlify routes ([d24781f](https://github.com/navio/workflow-manager/commit/d24781f427a896a581c370e92a04581946ce4b8d))
* correct skill source references ([0aceb12](https://github.com/navio/workflow-manager/commit/0aceb12297b3df8695a1f8afb5a37afd12cff65a))
* emit waiting event instead of cancelled on confirmation pause ([c24ee22](https://github.com/navio/workflow-manager/commit/c24ee223fdc1dab9a4e4d56b01017c30afb78e43))
* enforce required step fields in workflow validation ([5e9d90e](https://github.com/navio/workflow-manager/commit/5e9d90e9d46e110192e4a780b27d03339c70247e))
* harden real opencode executor input handling ([931ab24](https://github.com/navio/workflow-manager/commit/931ab24dc834def63ed65db8a7b054de55c789bb))
* improve curl installer shell visibility ([642219f](https://github.com/navio/workflow-manager/commit/642219fc2d07fd34f9a4f365152ef0da8f1837f4))
* keep public workflows discoverable across drafts ([c2fb13d](https://github.com/navio/workflow-manager/commit/c2fb13db3302d305e132f69f814875dcfcad2638))
* preserve validation gates and bundled artifacts ([08b576b](https://github.com/navio/workflow-manager/commit/08b576b5c128c62bfbff1f730073aba31d5f3f40))
* **remote-registry:** add workflow share metadata ([08f9ccc](https://github.com/navio/workflow-manager/commit/08f9ccc1fa9864a78d2b8202a19de0d58bd085c0))
* **remote-registry:** add workflow share metadata ([6c24175](https://github.com/navio/workflow-manager/commit/6c24175d7b74ff4ad5219bcda2e4a8515aeedc45))
* **remote-registry:** block duplicate signup for existing emails ([a1edad2](https://github.com/navio/workflow-manager/commit/a1edad2b9f2720c9034318e80b9df1e1d3e29f9d))
* **remote-registry:** detect existing email during signup ([01a3b2a](https://github.com/navio/workflow-manager/commit/01a3b2a36edd31223024db57d074fdf87e768021))
* **remote-registry:** hide auth-only header actions ([e0a5e51](https://github.com/navio/workflow-manager/commit/e0a5e518638f1bb54e0d72614b53add22fbf05d9))
* **remote-registry:** improve share previews and auth header nav ([f7fa385](https://github.com/navio/workflow-manager/commit/f7fa3857ebca33833200cc9476b7dc0a6c122981))
* **remote-registry:** make local auth links reliable and gate google oauth ([65d9f1b](https://github.com/navio/workflow-manager/commit/65d9f1b853de6cb778fa8b4cdba4b30fdeacdb12))
* **remote-registry:** prefill handle onboarding from profile display name ([3456e07](https://github.com/navio/workflow-manager/commit/3456e07cbc113658f9036a69ac5883082ca89a62))
* restore public workflow discoverability ([56f1cfe](https://github.com/navio/workflow-manager/commit/56f1cfe05e56ab35db838f0a3cf3caf44204d552))
* route Netlify builds per site target ([8e03fbb](https://github.com/navio/workflow-manager/commit/8e03fbb308d87794a0fee56569683984fdb4de29))
* **runner:** resolve approval deadlock and stale pi-agent output reuse ([#65](https://github.com/navio/workflow-manager/issues/65)) ([efd4461](https://github.com/navio/workflow-manager/commit/efd44611e6325f56619005aa845f8588128eeef2))
* **runner:** validate host adapter runtime requirements ([#63](https://github.com/navio/workflow-manager/issues/63)) ([0e67ebb](https://github.com/navio/workflow-manager/commit/0e67ebb45c8e667882a4893669332a9da9741319))
* scope PR lint to changed files ([d845d30](https://github.com/navio/workflow-manager/commit/d845d30fde8ff9c31896cf1fd42561170c9c8474))
* support Netlify builds from app base dirs ([a9f61a1](https://github.com/navio/workflow-manager/commit/a9f61a1d2ac5ada691770d63e9a3512b762bad72))
* support owner id fallback for remote workflows ([486f4ee](https://github.com/navio/workflow-manager/commit/486f4ee2770dd1d5781ab0389f2d879292155609))
* support Supabase ES256 browser sessions ([850f54c](https://github.com/navio/workflow-manager/commit/850f54c8571bc7f07a0ee62fb5796eba44d2443b))

## [0.2.0](https://github.com/navio/workflow-manager/compare/runner-v0.1.0...runner-v0.2.0) (2026-05-28)


### Features

* add authenticated CLI run telemetry ([a42dc07](https://github.com/navio/workflow-manager/commit/a42dc07ec4ab86f9c0f4b128500326f4f7a42ae2))
* add claude-code executor with streaming output and interactive approval gates ([fa8b7f5](https://github.com/navio/workflow-manager/commit/fa8b7f5d9a934252529d40fb69d5b4a5ea414bdc))
* add curl installer for release binaries ([3b6abc7](https://github.com/navio/workflow-manager/commit/3b6abc7c6f0b870c602cdd04ee29bae2235309e7))
* add curl installer for release binaries ([d4959e0](https://github.com/navio/workflow-manager/commit/d4959e0f1f0e4bf6e777bd79b3f4a8bdf2028b09))
* add dashboard workflow publishing ([1a21075](https://github.com/navio/workflow-manager/commit/1a21075f4153f547e876aaacaa297ef0651038af))
* add JSON workflow support and CLI man help ([fd82495](https://github.com/navio/workflow-manager/commit/fd82495f206bb9773b6c740f7d14240efd1e7e03))
* add live runner attach API ([ffb8dc5](https://github.com/navio/workflow-manager/commit/ffb8dc51897dcaf4b515a7d3ff6bf5bb125eae02))
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
* **cli:** add inline approval review prompts ([4d79771](https://github.com/navio/workflow-manager/commit/4d79771e18d7a09c572a0fd85b7b6865ffa53dcc))
* **cli:** add live workflow progress output ([8b055ee](https://github.com/navio/workflow-manager/commit/8b055ee66a808eae34f7d1b40ca7c3375f4c74a4))
* **cli:** add live workflow progress output ([68db1dc](https://github.com/navio/workflow-manager/commit/68db1dc57b1193693639afe66199bdaccf24516c))
* **cli:** add workflow-manager command alias ([d3dca2f](https://github.com/navio/workflow-manager/commit/d3dca2f3a8139e845594426ffeea58af09cf0e98))
* harden skill resolution with portable hashes and source policy ([9d9fe39](https://github.com/navio/workflow-manager/commit/9d9fe39a732edd684a8ae3069fde90c07749329c))
* initialize workflow-manager with CLI engine and VitePress docs ([c89d2a1](https://github.com/navio/workflow-manager/commit/c89d2a1e92f2340ae00b1c4aa3d3edafc63dea76))
* parser preserves skills map through normalization ([fc0a5b9](https://github.com/navio/workflow-manager/commit/fc0a5b9466775a9b8150098e6b436a2946fd5c3f))
* publish command bundles local skill source files into workflow JSON ([94af83a](https://github.com/navio/workflow-manager/commit/94af83a0b681ccb79a8d0eb8911886b75241a084))
* **remote-registry:** add handle onboarding and first-run dashboard state ([5409b7a](https://github.com/navio/workflow-manager/commit/5409b7ab9c673fd03e0de32a79cd9cd4de629585))
* **remote-registry:** complete signup/auth redesign with onboarding + regression smokes ([bf08bc2](https://github.com/navio/workflow-manager/commit/bf08bc2a490e6b15d22e4d7ab44fbfda5fdaa74d))
* **remote-registry:** finalize redesign system and UX polish ([05c3ea1](https://github.com/navio/workflow-manager/commit/05c3ea16d13a5b7780a6ee4e56e0adca8c7413d8))
* **remote-registry:** finalize redesign system and UX polish ([de98dd2](https://github.com/navio/workflow-manager/commit/de98dd23e7ae933b8ee0ef01f68e7b3c680817a1))
* **remote-registry:** implement auth guards and phase 3 auth flows ([e13a73a](https://github.com/navio/workflow-manager/commit/e13a73a21be0fe0b84c2e4b345854a8eb71a3ec7))
* rename the runner package and auto-publish it ([fd0768f](https://github.com/navio/workflow-manager/commit/fd0768f77d64ce93e4dde9f0706e7dfea667d000))
* resolveSkill reads from skills[name].source path ([6c1a14f](https://github.com/navio/workflow-manager/commit/6c1a14f66eb28f5d5ee1d2e9ddfdddeaaa2d0d72))
* resolveSkill supports project, user-global, and npm tiers with name safety ([ccb5d80](https://github.com/navio/workflow-manager/commit/ccb5d805de8a8537e2e245a03dfa147bc01cd5c5))
* run tasks with pi-agent by default ([a29eb5e](https://github.com/navio/workflow-manager/commit/a29eb5ed5d86b3fce6217d0540901c5eb1db1456))
* run tasks with pi-agent by default ([75e126f](https://github.com/navio/workflow-manager/commit/75e126fcbbe3798c7d251be9aa8c1c3f3bcc68c1))
* ship agent skills with the CLI package ([6eb99df](https://github.com/navio/workflow-manager/commit/6eb99df072321c3370e594be53eb0e06f146632c))
* ship local spec-driven-development skill, update demo workflow to use it ([a77e044](https://github.com/navio/workflow-manager/commit/a77e044b3e836ebc09c2714e72a78a18d324a936))
* skill resolution — workflows ship with their own skills ([2d07916](https://github.com/navio/workflow-manager/commit/2d079169c19c22123c64fc0aee6b09e0aaf57608))
* support JSON workflows and add CLI man help ([e3f9c1b](https://github.com/navio/workflow-manager/commit/e3f9c1b0da2d13c3928543e24bfcaa75a26ed37c))


### Bug Fixes

* align Supabase migration history ([45e24ef](https://github.com/navio/workflow-manager/commit/45e24eff20ad6cc6f3e2bab41391604f197e0803))
* allow CI lint on migration-only changes ([73da04f](https://github.com/navio/workflow-manager/commit/73da04fb7318523902dc922942b2a92adf2fcd13))
* **ci:** resolve lint and remote-registry frozen lock failures ([9d14171](https://github.com/navio/workflow-manager/commit/9d141713d263b128b063282055ef1a88a67a2f79))
* clarify draft workflow visibility ([7f8489e](https://github.com/navio/workflow-manager/commit/7f8489eed4ac34031617b0375b4b4eb7375122f8))
* **cli:** let terminal and API resolve waits ([9ce6c33](https://github.com/navio/workflow-manager/commit/9ce6c3347e51426bb7740fe22cc4d295f2321d7c))
* **cli:** pause progress heartbeat during prompts ([d082ee2](https://github.com/navio/workflow-manager/commit/d082ee2c01b68f3dfeeb50bcb23a1f8927c53c42))
* **cli:** prompt inline for external validation ([5291d45](https://github.com/navio/workflow-manager/commit/5291d4539fc3d43a4a928c7dabe61504acd1e36f))
* correct broken Bun dev script path ([9d9da6d](https://github.com/navio/workflow-manager/commit/9d9da6d2be0efd43fc7b96d8e8130d6ee1fc29bb))
* correct dev script path for bun run ([d9d0719](https://github.com/navio/workflow-manager/commit/d9d071975535734549660511695526aa372910e5))
* correct registry auth redirect and netlify routes ([d24781f](https://github.com/navio/workflow-manager/commit/d24781f427a896a581c370e92a04581946ce4b8d))
* correct skill source references ([0aceb12](https://github.com/navio/workflow-manager/commit/0aceb12297b3df8695a1f8afb5a37afd12cff65a))
* emit waiting event instead of cancelled on confirmation pause ([c24ee22](https://github.com/navio/workflow-manager/commit/c24ee223fdc1dab9a4e4d56b01017c30afb78e43))
* enforce required step fields in workflow validation ([5e9d90e](https://github.com/navio/workflow-manager/commit/5e9d90e9d46e110192e4a780b27d03339c70247e))
* harden real opencode executor input handling ([931ab24](https://github.com/navio/workflow-manager/commit/931ab24dc834def63ed65db8a7b054de55c789bb))
* improve curl installer shell visibility ([642219f](https://github.com/navio/workflow-manager/commit/642219fc2d07fd34f9a4f365152ef0da8f1837f4))
* keep public workflows discoverable across drafts ([c2fb13d](https://github.com/navio/workflow-manager/commit/c2fb13db3302d305e132f69f814875dcfcad2638))
* preserve validation gates and bundled artifacts ([08b576b](https://github.com/navio/workflow-manager/commit/08b576b5c128c62bfbff1f730073aba31d5f3f40))
* **remote-registry:** add workflow share metadata ([08f9ccc](https://github.com/navio/workflow-manager/commit/08f9ccc1fa9864a78d2b8202a19de0d58bd085c0))
* **remote-registry:** add workflow share metadata ([6c24175](https://github.com/navio/workflow-manager/commit/6c24175d7b74ff4ad5219bcda2e4a8515aeedc45))
* **remote-registry:** block duplicate signup for existing emails ([a1edad2](https://github.com/navio/workflow-manager/commit/a1edad2b9f2720c9034318e80b9df1e1d3e29f9d))
* **remote-registry:** detect existing email during signup ([01a3b2a](https://github.com/navio/workflow-manager/commit/01a3b2a36edd31223024db57d074fdf87e768021))
* **remote-registry:** hide auth-only header actions ([e0a5e51](https://github.com/navio/workflow-manager/commit/e0a5e518638f1bb54e0d72614b53add22fbf05d9))
* **remote-registry:** improve share previews and auth header nav ([f7fa385](https://github.com/navio/workflow-manager/commit/f7fa3857ebca33833200cc9476b7dc0a6c122981))
* **remote-registry:** make local auth links reliable and gate google oauth ([65d9f1b](https://github.com/navio/workflow-manager/commit/65d9f1b853de6cb778fa8b4cdba4b30fdeacdb12))
* **remote-registry:** prefill handle onboarding from profile display name ([3456e07](https://github.com/navio/workflow-manager/commit/3456e07cbc113658f9036a69ac5883082ca89a62))
* restore public workflow discoverability ([56f1cfe](https://github.com/navio/workflow-manager/commit/56f1cfe05e56ab35db838f0a3cf3caf44204d552))
* route Netlify builds per site target ([8e03fbb](https://github.com/navio/workflow-manager/commit/8e03fbb308d87794a0fee56569683984fdb4de29))
* scope PR lint to changed files ([d845d30](https://github.com/navio/workflow-manager/commit/d845d30fde8ff9c31896cf1fd42561170c9c8474))
* support Netlify builds from app base dirs ([a9f61a1](https://github.com/navio/workflow-manager/commit/a9f61a1d2ac5ada691770d63e9a3512b762bad72))
* support owner id fallback for remote workflows ([486f4ee](https://github.com/navio/workflow-manager/commit/486f4ee2770dd1d5781ab0389f2d879292155609))
* support Supabase ES256 browser sessions ([850f54c](https://github.com/navio/workflow-manager/commit/850f54c8571bc7f07a0ee62fb5796eba44d2443b))
