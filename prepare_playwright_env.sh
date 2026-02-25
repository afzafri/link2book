#!/bin/sh
# Install Playwright Chromium browser and its system dependencies.
# Required for containerised environments (Leapcell, Docker, etc.).
# Leapcell build command: sh prepare_playwright_env.sh && npm install
npx playwright install chromium
npx playwright install-deps chromium
