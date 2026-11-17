#!/bin/bash
# Vercel build script for the FixMate API.
# Creates package.json, installs deps, bundles the Express app into the
# serverless function api/[[...slug]].js (self-contained — no node_modules needed at runtime).
set -e

cat > package.json <<'EOF'
{
  "name": "fixmate-server",
  "private": true,
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.21.0",
    "jsonwebtoken": "^9.0.2",
    "mongodb": "^6.10.0",
    "multer": "^2.0.0",
    "stripe": "^17.3.0"
  }
}
EOF

npm i
npx -y esbuild a.ts --bundle --platform=node --outfile='api/[[...slug]].js'
