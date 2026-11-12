# Public upstream contracts

These unmodified, already-public upstream files let a clean checkout run the contract tests without private research data. Keep one active public copy of each contract and update its pinned source and checksum together.

| Local file | Pinned source | SHA-256 |
| --- | --- | --- |
| [plugin.schema.json](agent-plugins/schemas/1.0.0/plugin.schema.json) | [Agent Plugins `44a0ff84`](https://github.com/agentplugins/agent-plugins-spec/blob/44a0ff84bfdfebccfc649dce9aea9ccc45cbfbf9/schemas/1.0.0/plugin.schema.json) | `0a4aad95ce337878ad38802ebf0daa3fde76abe3f65400c86bcbb1ec0b3ab883` |
| [mcp.schema.json](agent-plugins/schemas/1.0.0/mcp.schema.json) | [Agent Plugins `44a0ff84`](https://github.com/agentplugins/agent-plugins-spec/blob/44a0ff84bfdfebccfc649dce9aea9ccc45cbfbf9/schemas/1.0.0/mcp.schema.json) | `6539175bfcdf43085855183e86da40ea94b166547a72b47ae9a0a390516d3acb` |
| [api-contract.json](weknora/api-contract.json) | [WeKnora `cbdcebab`](https://github.com/Tencent/WeKnora/blob/cbdcebabf48c5ee2d6868b370326aa8341703f62/packages/dsh-weknora/test/fixtures/api-contract.json) | `e697303885ed6b733fc47463daa20c0eecf17ddaa3cd13a4eb2c730fdf9a7f5b` |

Agent Plugins schemas are covered by the retained [Apache-2.0 license](agent-plugins/LICENSE). The WeKnora contract retains its upstream [license and copyright notices](weknora/LICENSE).

The repository attributes preserve the original bytes. These files are test inputs and are excluded from the plugin distribution archive.
