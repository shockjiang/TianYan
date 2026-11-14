## goal: I want to build a website that on preview the files of given root directory recursively.
- It has a beautifly UI, which contain a thin top pannel, left pannel, and main (right) pannel
- top pannel allows user input a root directory
- left pannel list all directories and files under the root directory recursively with a tree-like UI structure
- main pannel visualize the contents of file or file tuple. The file can be RGB, depth(Uint16), mask(0/1), Json, text or others.file tuple is combination of files, e.g., RGB-Depth, RGB-Mask, RGB-Depth-Mask,etc. So the visualization type enumerated. The logic of visualizing individual file is easy and can be built-int support. Visualization of file tuple should follow different logics. So define a scalable way that allows me to add new types of file tuple. top pannel can choose the visualization type. 

## existing types of file tuple
- rgb + json (bbox + mask + affordance)
- rgb + mask
- rgb + depth
- rgb + mask + depth
- lm (one lm_batch training dump: images + prompts + action trajectories)

## supported single-file viewers
Each viewer lives in `frontend/src/components/viewers/` and is routed in
`MainPanel.tsx::detectFileType` based on extension sets in `frontend/src/constants.ts`.

| Type    | Extensions                          | Backend routes                                  |
|---------|-------------------------------------|-------------------------------------------------|
| image   | .png .jpg .jpeg .bmp .gif .webp     | `/api/file`                                     |
| depth   | image ext + path contains "depth"   | `/api/file`                                     |
| mask    | image ext + path contains "mask"    | `/api/file`                                     |
| video   | .mp4 .mkv .avi .mov .webm .flv .wmv | `/api/video` (Range)                            |
| json    | .json                               | `/api/file`                                     |
| text    | .txt .py .md .yaml … (see constants)| `/api/file`                                     |
| tabular | .jsonl .parquet .pq                 | `/api/tabular/*`                                |
| pickle  | .pkl .pickle .pth                   | `/api/pickle`                                   |
| npy     | .npy .npz                           | `/api/npy/info`, `/api/npy/frame`               |
| ply     | .ply                                | `/api/file`                                     |
| usd     | .usd .usda .usdc .usdz              | `/api/usd/*`                                    |
| h5      | .h5 .hdf5                           | `/api/h5/info`, `/api/h5/frame`, `/api/h5/preview` |
| lm      | `lm_step_*.h5` `step_*.h5`; any .h5 via dropdown | `/api/lm/info`, `/api/lm/sample`, `/api/lm/frame` |

`lm` is both a `detectFileType` route (LM-named dumps) and a tuple (dropdown
forces it on any `.h5`) — see the notes below.

### adding a new single-file viewer
1. Add ext set to `frontend/src/constants.ts`.
2. Add a branch to `detectFileType` in `MainPanel.tsx` and a render case below.
3. Build the viewer in `frontend/src/components/viewers/<X>Viewer.tsx`.
4. (If parsing/binary) add a backend module under `backend/api/<x>.py`,
   register the router in `backend/main.py`, and add deps to
   `backend/requirements.txt`.
5. After backend changes the dev server auto-reloads. After frontend
   changes the vite dev server (port 15090) hot-reloads; for the FastAPI
   static mount on port 8000, run `cd frontend && npx vite build` to
   refresh `frontend/dist`.

### h5 viewer notes
- Renders any dataset with shape `(N, H, W)` or `(N, H, W, C)` as a
  frame sequence with a play/scrub slider (e.g. `pixels_front`,
  `pixels_left`).
- Renders 2-D datasets where both dims are ≥ 8 as a single image; very
  thin/wide arrays (e.g. `(N, 5)`) fall through to the data-preview pane.
- Shows root-level and dataset-level HDF5 attrs.
- `/api/h5/preview` returns inline JSON for small datasets (≤ 200 items)
  and head + min/max/mean for large ones.

### lm viewer notes
- Previews one loco-manip training dump (`debug_dumps/lm_step_*.h5`, legacy
  `step_*.h5`); the format contract is
  `/manifoldai-infra-infra/shock/loco-manip/docs/lm_batch.md`, and its writer
  `src/openpi/training/debug_dump.py` is the authority when the two disagree.
- Reached two ways. (1) Auto: `detectFileType` routes a file whose name starts
  with `lm_step_` or `step_` straight to the LM viewer in single-file mode —
  `isLmDumpName` in `Lm.tsx` is the single source of truth, imported by
  `MainPanel.tsx`. (2) Manual: the top-panel viz dropdown (**LM**, bookmarkable
  as `?viz=lm`) forces it on any `.h5`, which is how a renamed dump is opened.
  Registered in `frontend/src/tuples/index.ts` with `roles: ['h5']`; the matcher
  takes the selected `.h5`, else the first LM-named one, else the first `.h5`,
  and returns at most one match so it renders full-view.
- TRADEOFF of the auto-route: an `lm_step_*`/`step_*` file is always tried as an
  LM dump first. When the backend rejects it structurally the viewer falls back
  to the generic `H5Viewer`, so an ordinary `.h5` with that name still renders.
- Per sample it shows the stage-labelled camera grid, both prompts
  with the diverging words highlighted, and the action dims as small-multiple
  inline-SVG panels (gt vs pred, state at t=0 marked), plus per-sample /
  per-dim MSE and the state table. No charting library — hand-rolled SVG in
  `frontend/src/components/viewers/LmActionPlot.tsx`.
- The backend accepts on structure only, never on filename, so an LM-named file
  that is not really a dump 4xx's cleanly instead of rendering garbage. Two
  accepted shapes: a sampled dump (`<split>/output/pred_actions` +
  `<split>/model_input/prompt_text`) or a BATCH-ONLY dump (`config/` + `batch/`
  with no `train`/`val` at all) — the latter is what the current writer emits.
- VIEWS are `train`/`val` (legacy sampled splits) plus `batch` and `val_batch`,
  the device-0 batches. `val_batch/` is the held-out batch with prompt
  corruption off, emitted only when the run has val episodes. Both batch groups
  keep `pred_actions` / `per_sample_mse` at the GROUP ROOT, not under `output/`,
  and carry an `action_mse` attr.
- FOUR GENERATIONS coexist on disk and all four must keep working. A: split
  dump (`train`/`val`, full `original/`, no `config/`). B: batch-only
  (`config/` + `batch/`, no `original/` at all). C: + `val_batch/`, with
  `batch/original/` holding ONLY `images/`. D: + root `state_dim_names` /
  `action_dim_names` / `skill_classes`, `original/{images,tokenized_prompt,
  prompt_text}` and `*/skill/`. Every group is OPTIONAL and probed for; the
  generation string is never a branch key (it cannot tell B/C/D apart).
- DIM NAMES come from the FILE when it records them (root `state_dim_names` /
  `action_dim_names`, `(32,)` str, the same 23 names in DIFFERENT slots plus
  `pad23..pad31`); `STATE_DIM_NAMES` / `ACTION_DIM_NAMES` in `lm.py` are the
  FALLBACK only, for dumps that record no layout. `dim_names.source` is
  `file` | `assumed_ti5` | `generic` and the header badge says which
  (`dims: names from file (23/32)` / `dims: assumed ti5 layout` /
  `dims: unnamed`), in WARN colour whenever the labels are assumed or the file
  disagrees with itself; the state table repeats it. Lists are cut to
  `dim_real` as a TRAILING suffix only, so slot k on screen is slot k in the
  file. `dim_real_from` (`original` | `<split>` | `dim_names` | `assumed_ti5` |
  `padded`) is in the badge tooltip, so the slot count is never unattributed.
  A batch-only dump has no `original/` to measure the real dim from
  (`config/action_dim` is the PADDED 32). Its `local_batch_size` is the whole
  local batch (512); only the device-0 shard (`num_samples`, e.g. 64) is in the
  file, and that is what the sample strip and the dropdown label report.
- `original/` is NOT the raw file on disk from generation C on: it is the frame
  after the transform stack (resized, normalized, already mirrored) and BEFORE
  in-model augmentation. `pred_actions` was sampled from it on the image axis —
  but with the SERVED (corrupted) `model_input` prompt; `pred_note` says both.
  On B there is no `original/` at all and `model_input/images` (POST-aug) is the
  only column. With augmentation off the two columns are byte-identical, and the
  copy says so only when `config/` asserts it.
- PROMPT CORRUPTION AUDIT — `original/prompt_text` vs `model_input/prompt_text`
  is how skill dropout / swap / clock dropout is checked against the file
  instead of against the config. The panel highlights the diverging words by
  common prefix AND suffix, so only the skill clause lights up. Generation A's
  `original/prompt` is a different thing — the BARE dataset task string, whose
  diff means the clause was ADDED, not corrupted — so it gets neutral wording,
  not a corruption tally. Absent pair = NOT AUDITABLE, never "identical", and
  the strip still prints the configured probabilities. `val_batch` is served
  uncorrupted by design (0/64 differ), so its strip says that instead of
  quoting train-loader knobs.
- SKILL HEAD — `*/skill/{logits,pred,pred_name,target,target_name,in_prompt}`
  with root `skill_classes` as the index->name map. Shown as TEXT (pred vs
  target) plus, from `logits`, the softmax confidence of the predicted class and
  the RANK of the true class, so confident-and-wrong is distinguishable from a
  near-miss. Unlabelled is `target < 0` (NOT `-100`), excluded from every
  accuracy. The headline is the EVIDENCE accuracy: only `in_prompt == False`
  frames had the skill clause withheld from the served prompt, so only those
  measure perception — an `in_prompt == True` frame could copy the answer out of
  its own prompt. The group `acc` attr pools both and is never the headline;
  when the evidence subset is empty (`val_batch`: 64/64 in prompt) it renders
  `n/a`, never the pooled number. `num_classes` is read from the file (the vocab
  has shipped with 4, 5, 7, 8, 9), and `skill_classes` present does NOT imply a
  skill group exists.
- Raw units need `norm_stats.json`: the `norm_stats` query param wins, else the
  exact `config/norm_stats_asset_id` path (`source: "asset"`), else the wildcard
  probe at `<exp>/*/assets/*/norm_stats.json` (highest step dir wins)
  when the dump sits in `debug_dumps/`, else — for a step-0 dump, whose run has
  no checkpoint yet — at `<data>/datasets/lerobot/<norm_stats_asset_id>/`
  (`source: "corpus"`). A dump with no `config/` records no asset id, so it stays
  in normalized units rather than guessing among the corpora; paste a path into
  the norm_stats box to override. All denormalization is backend-side.
- IMAGE STAGES — the format change that matters. `<split>/model_input/images` is
  now POST-augmentation (what the vision encoder trained on); the before-picture
  moved to the optional `model_input/images_preaug/`, written only when
  `aug_image=True` (the key is `aug_crop_rotate_jitter` from generation C).
  `pred_actions` is sampled from the UNAUGMENTED frames, so pred corresponds to
  `images_preaug` on B and to `original/` on C/D, NOT to `images`. The viewer
  therefore labels columns by pipeline stage (`original` / `pre-aug` /
  `post-aug`) instead of by h5 group name, accents the header of the stage pred
  came from, says so again in the plot legend, and defaults to two columns.
  `/api/lm/frame` stage tokens: `original`, `model_input`, `model_input_preaug`,
  `model_input_aug`. The backend decides which stages exist and which are on by
  default (`stages[].default_on`); the frontend has no generation logic.
- RECIPE PANEL — the optional `config/` group (40..55+ attrs, enumerated from
  the file, never a hardcoded key list — the `lr_*`/`opt_*` tail follows the
  schedule/optimizer class) is surfaced both flat and grouped by the backend
  (`config_kv` / `config_groups`) and rendered as a collapsible strip above the
  header (`LmConfigPanel.tsx`), `augmentation` accented. The `doc_*` keys are
  one-line self-describing sentences covering the whole augmentation surface;
  they lead the panel as the `recipe notes` group in PIPELINE order, and any
  future `doc_*` key lands there by prefix.
- BATCH BROWSER — the optional `batch/` group is the real per-process training
  batch (B >> the handful of dumped samples). It shows up as an extra
  `batch (B=…)` entry in the split select and reuses `/api/lm/sample` and
  `/api/lm/frame` with `split=batch`. `pred_actions` / `per_sample_mse` sit at
  the GROUP ROOT there, not under `output/`, and the strip paginates 256 tiles
  so B=512 never mounts 512 nodes.
- BACK-COMPAT — `config/`, `batch/` and `images_preaug/` are all optional and
  probed for, never assumed. An old dump (none of the three) renders as it
  always did: the same two-column `original` / `model_input` grid, the old stage
  tokens resolving to the same h5 paths, `recipe: not recorded (old-format
  dump)`, and no batch entry. Every new `/api/lm/info` key is always present
  with a null/empty/false value, so the frontend codes against one shape.
- The state table lists dims in STATE order and the action plot in ACTION order,
  i.e. each in its own file order. The only permutation is the t=0 state marker
  drawn on the action plot, which must share that axis. The table shows `norm`
  and one raw-units column sourced from `original/state` when the dump has it,
  else from the denormalized `model_input/state` (verified equal to 2.1e-08) —
  a view with no `original/state` (every batch group) has only that fallback.
- `state` and `action` dim orders differ (the grippers sit in different slots);
  the backend returns both name lists and permutes the t=0 state into action
  order for the plot BY NAME, never by index, so the frontend never reorders
  anything. No names (`generic`) means no marker, with `state_t0.reason` saying
  why.

## running the dev servers
`./start.sh` runs both:
- backend: uvicorn on `0.0.0.0:8000` (also serves the prod build of the
  frontend at `frontend/dist/`)
- frontend: vite dev on `0.0.0.0:15090` (HMR for live edits)
Logs go to `/tmp/tianyan.log` when launched via nohup.

## caching gotcha
The FastAPI SPA route serves `index.html` with `Cache-Control: no-cache`,
so users always pick up the latest bundle hashes. After editing the
frontend, run `npx vite build` if you want users on port 8000 (not 15090)
to see the change without a hard refresh.

## sub-page: experiment board (`<base>/exps`)
- Routed in `frontend/src/main.tsx` (pathname `/exps` → `exps/ExpsPage.tsx`, else the file browser).
- Backend `backend/api/exps.py` (`GET /api/exps`, `GET /api/exps/{exp}/curves`) imports
  `manifold_model/framework/scripts/exp_board.py` by path, so the tmux board
  (`exp_board.py --watch 30`) and this page share one source for status / loss / val MSE / probe MSE.
  Version, commit, datasets and data/train tags are derived from each run's `config.json`
  (`_tags`); add a rule there when a new config switch should be filterable.
- Charts: hand-rolled SVG in `frontend/src/exps/LineChart.tsx` (no charting library, as in `LmActionPlot`).

## sub-page: experiment comparison (`<base>/running`)
- `frontend/src/running/RunningPage.tsx`: ① filter (version chips, #tags, the same Claude chat as /exps) →
  candidates; ④ per run tick 最新 (newest ckpt) and/or 最佳 (lowest if_probe val MSE) — selection in `?sel=exp:last,exp:best`;
  ② comparison table, ③ curves (steps cumulative from the pi0.5 base, ancestors dashed) + bar small multiples.
  Run names open the /exps detail drawer (`Detail` and the filter widgets are exported from `exps/ExpsPage.tsx`).
- Backend `backend/api/running.py` (`POST /api/running/compare`) imports manifold_model's
  `.claude/skills/compare-exp/compare_exps.py` by path and fills its spec from the runs: warm-start chain from
  config `pretrained_model`, verdict / endpoint from a hand-written `compare-exp/specs/*.json` naming the same run
  (else locating-good / real-good / *-bad and ep-* tags), box-probe rows only where such a spec probed the same step.
