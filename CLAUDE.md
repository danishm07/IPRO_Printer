# IPRO Group 1: ZQ630 Plus Studio

This repo is a group project that redesigns the Zebra ZQ630 Plus mobile printer. It holds an interactive 3D viewer of the printer and a "Studio" page where teammates propose changes to it. Most teammates are not programmers. They describe a change in plain words, a GitHub workflow runs Claude to build it on its own branch, and the team previews and votes before the owner merges it.

## Layout

- `site/viewer/index.html`: the 3D viewer. One self-contained page (HTML, CSS and JavaScript inline). This is the file proposals almost always change.
- `site/viewer/*.txt`, `site/viewer/*.jpg`: the scanned 3D model (base64 GLB) and its textures. Never edit, rename, re-encode or delete these.
- `site/index.html`: the Studio page teammates use. Only change it when a request is explicitly about the Studio itself.
- `functions/api/*.js`: Cloudflare Pages Functions behind the Studio. Do not change these from a proposal.
- `.github/workflows/studio.yml`: the build workflow. Do not change it from a proposal.
- `proposals/<number>/`: reference images teammates attached. Read them when the request mentions an image.
- `scripts/check.mjs`: syntax and file check. Run `node scripts/check.mjs` after editing; it must print CHECK PASSED.

## How the viewer is built (site/viewer/index.html)

- three.js r147 loaded as UMD scripts from cdn.jsdelivr.net (`THREE`, `THREE.GLTFLoader`, `THREE.OrbitControls`). No build step, no modules, no npm.
- Coordinates are model millimetres times `MM` (0.001): x is the printer's length (keypad end is +x), y is up (0 at the underside), z is width (the port-cover side is -z).
- Two design states: `mode` is "current" or "planned", and `morph` animates 0 to 1 between them. Things that differ between the stock printer and the team's redesign should read `morph` or `mode`.
- Data tables near the top: `PARTS` (spec cards and hover regions), `CONCEPTS` (tabs), `SETTINGS` (printer menu settings shared by both screen UIs).
- Screen UI: drawn to a 576x480 canvas. `drawCurrentUI` is the stock-style blue icon grid, `drawPlannedUI` is the team's design (idle status screen, list menu, value editor). Navigation is `navCurrent` / `navPlanned`, called from `pressKey(id)` with ids up, down, left, right, ok, softL, softR. Screen changes animate with `ui.push(direction)` and `ui.showToast(text)`.
- Keypad: `KEY_SPECS` gives each key's [r, u, width, height, keyHeight] in mm for current and planned layouts; `updateKeypad` blends them with `morph` and runs the press spring.
- Display module: `buildDisplay` (hinged screen, tilt, glare veil). Port cover: `buildPort` / `updatePort` (rubber flap in current, yellow slider in planned).
- Side panel: one `<section class="view" id="view-...">` per tab. Colors come from CSS tokens on `:root` with dark-mode overrides; reuse them.

## Rules for building a proposal

1. Do everything the request asks, all of it. Keep everything else working exactly as before. Do not skip part of a request because it is awkward: if something is baked into the scan (its colours and shapes come from the texture, such as the yellow latch and labels), change it anyway by adding new geometry over that spot (a thin coloured shell or panel that follows the surface, the way the screen and keypad sit on the scan), by recolouring that region of the texture in the shader or a canvas copy, or by another way that visibly does what was asked. Only leave something out if it is truly impossible, and then say exactly why.
2. Unless the request says otherwise, a design change belongs to the Planned design and Current stays as the stock printer.
   When a reference image shows a new design for a part (a sketch, render or photo of a new latch, cover, button or screen layout), open it with the Read tool and build that part as new geometry that matches the picture's shape, proportions, colours and details as closely as the existing three.js setup allows. Put it where the old part is, hide or cover the old part in Planned, and make any moving piece move (open, slide, press) the way the picture suggests. Use the printer's real size to scale it; if the image gives dimensions, use them.
3. Code style: one statement per line, no chained assignments, no clever one-liners, descriptive names, short comments only where the reason is not obvious.
4. No new libraries or external requests beyond what the page already loads.
5. Run `node scripts/check.mjs` and fix anything it reports.
6. Do not run git. The workflow commits and pushes for you.
7. Finish by writing `.studio/summary.md` for non-programmers, in this shape:
   - One sentence saying what changed overall and where to look (Current or Planned, which tab, what to click or rotate to).
   - Then a short list with one line per change: which part, what it looked like or did before, what it does now, with exact values a teammate could ask to tweak (colours as names plus hex, such as "pink #E8559A", sizes in millimetres, speeds, text). This list is how teammates fine-tune the result in a follow-up ("make the keys a lighter pink"), so leave nothing out.
   - If any part of the request was not done, a last line starting "Not done:" saying what and why.
   No code and no file names.
