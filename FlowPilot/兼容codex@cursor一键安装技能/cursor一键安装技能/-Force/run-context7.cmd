@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%context7-local\node_modules\@upstash\context7-mcp\dist\index.js" %*