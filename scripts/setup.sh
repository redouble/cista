#!/bin/bash

# Cista (密匣) — Zero-knowledge E2EE file sharing system
# One-click development setup script

set -e

echo "🔒 Cista (密匣) — Setup Script"
echo "=============================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
cd "$(dirname "$0")/.."

# Root
npm install

# Server
cd server
npm install
cd ..

# Client
cd client
npm install
cd ..

echo ""
echo "✅ Dependencies installed"

# Create data directories
mkdir -p server/data
echo "✅ Data directories created"

# Run database migrations
echo ""
echo "🗄️  Running database migrations..."
cd server
npx tsx src/db/migrate.ts
cd ..

# ⚠️  Default admin credentials (admin@cista.local / Admin123!) are for
#    development and testing only. CHANGE them before any production use
#    by setting ADMIN_EMAIL and ADMIN_PASSWORD environment variables.

# Seed admin user
echo ""
echo "👤 Seeding admin user..."
cd server
npx tsx src/db/seed.ts
cd ..

echo ""
echo "=========================================="
echo "🚀 Cista (密匣) is ready to run!"
echo ""
echo "   Start the development server:"
echo "     npm run dev"
echo ""
echo "   Or start individually:"
echo "     npm run dev:server   # Backend on http://localhost:3000"
echo "     npm run dev:client   # Frontend on http://localhost:5173"
echo ""
echo "   Default admin credentials (dev-only — change in production):"
echo "     Email:    admin@cista.local"
echo "     Password: Admin123!"
echo "=========================================="
