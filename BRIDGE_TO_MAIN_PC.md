# Mind4Metal Upgrade Bridge

This repo clone lives at `C:\Projects\Mind4Metal` on this computer. Use this bridge when you are ready to merge the upgraded site into the project folder on your main PC.

## What changed

- `index.html` now has richer social/share metadata, structured data, a better live-player control surface, volume/mute controls, a sticky mobile player, persisted recently played history, Media Session metadata, request-form validation, accessible drawer behavior, reduced-motion support, and clearer stream status/reconnect states.
- `sw.js` should be bumped when the update is finalized so returning visitors refresh cached shell assets.
- `BRIDGE_TO_MAIN_PC.md` and `tools/export-bridge.ps1` exist only to help move the work cleanly.

## Recommended merge path

1. On this computer, from `C:\Projects\Mind4Metal`, review the work:

   ```powershell
   git status
   git diff
   ```

2. Create a portable bridge bundle:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\tools\export-bridge.ps1
   ```

   The script creates `_bridge\mind4metal-upgrade-bridge.zip`.

3. Move that zip to the main PC and extract it beside the main project folder.

4. In the main PC project folder, apply the git patch first:

   ```powershell
   git apply path\to\mind4metal-upgrade.patch
   ```

5. If the patch does not apply cleanly because the main PC folder has newer edits, use the included `changed-files` folder as the manual comparison source. Copy only the sections you want, then run:

   ```powershell
   git diff
   ```

6. After testing on the main PC, commit from the main PC project folder.

## Notes

- The bridge zip includes both a patch and full copies of changed files. The patch is best when the main PC project is close to this clone. The full file copies are best when you need to compare and manually merge.
- Do not copy the `.git` folder between computers.
- If GitHub Pages is serving the site, push the final commit from whichever machine owns the canonical project folder.
