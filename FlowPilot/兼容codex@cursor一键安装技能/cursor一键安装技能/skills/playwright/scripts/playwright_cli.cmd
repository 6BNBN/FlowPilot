@echo off
setlocal
npx --yes --package @playwright/cli playwright-cli %*
