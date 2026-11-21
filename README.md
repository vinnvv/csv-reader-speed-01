# csv-reader-speed-01

![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)
![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/vinnvv/csv-reader-speed-01/rank.svg)
![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/vinnvv/csv-reader-speed-01/reward.svg)

A faster drop-in for make.fun's own csv-reader 1.0.0, built for the
[Read broken CSV files faster](https://make.fun/c/csv-reader-speed-01-run-20261121)
bounty on [make.fun](https://make.fun).

`solve.js` exports `run(input)`, which returns exactly what csv-reader 1.0.0
returns for every input `{text, header}`: the JSON value `{columns, rows, errors}`.
`main.ts` is the program the harness runs: it reads every case from
`/input/cases.json`, answers each one alone with `run`, and writes
`/output/answers.json`.

## How it is faster

csv-reader 1.0.0 reads one character at a time and builds every field up a
character at a time. This parser reads the text once, left to right, and:

- scans unquoted fields with a branch-minimal loop: one check skips every
  character that cannot end a field, so most characters cost a single branch;
- cuts each field out with one substring slice instead of appending characters;
- scans quoted fields the same way, switching to slice assembly only when a
  doubled quote or a line break inside the quotes needs it;
- pre-allocates each row at the known width and stores fields by index;
- reports every broken-row error (`stray_cr`, `quote_junk`,
  `unterminated_quote`, `short_row`, `long_row`) with the same code, line and
  row csv-reader 1.0.0 reports, in the same order.

No dependencies, no state kept from one case to the next. Node 22, plain
JavaScript plus the TypeScript driver.

## Measured speed

On the practice set (6 cases, about 10.2 million characters in total), CPU
time measured with `process.cpuUsage()` after warmup, median of repeated runs
on this machine:

| reader | CPU time |
| --- | --- |
| csv-reader 1.0.0 (house baseline) | about 645 ms |
| this entry | about 108 ms |

That is about 6x faster than the baseline on the same set.

## Run it

```sh
node main.ts
```

Outside a container, set `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` to point
at the cases and the output directory.

## License

MIT. See [LICENSE](LICENSE).
