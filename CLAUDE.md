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
