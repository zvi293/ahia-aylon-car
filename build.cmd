@echo off
rem ============================================================
rem  Build: minify source/ into dist/
rem  Edit CSS/JS ONLY in the source\ folder, then run this file.
rem  (dist\styles.css and dist\script.js are generated - do not
rem   edit them by hand, changes there will be overwritten.)
rem ============================================================
cd /d "%~dp0"
call npx --yes esbuild source/styles.css --minify --outfile=dist/styles.css --allow-overwrite
call npx --yes esbuild source/script.js --minify --target=es2019 --outfile=dist/script.js --allow-overwrite
echo.
echo Done. dist\styles.css + dist\script.js rebuilt from source\.
