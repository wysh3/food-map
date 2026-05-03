#!/bin/bash

echo "🚀 Setting up Food Delivery Map Project"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

echo -e "${BLUE}Step 1: Starting PostGIS database...${NC}"
docker-compose up -d
echo -e "${GREEN}✅ PostGIS started${NC}"
echo ""

echo -e "${BLUE}Step 2: Waiting for database to be ready...${NC}"
sleep 10
echo -e "${GREEN}✅ Database ready${NC}"
echo ""

echo -e "${BLUE}Step 3: Installing dependencies...${NC}"

# Install tile-server dependencies
echo "  📦 Installing tile-server dependencies..."
cd tile-server
npm install
cd ..

# Install scripts dependencies
echo "  📦 Installing scripts dependencies..."
cd scripts
npm install
cd ..

# Install frontend dependencies
echo "  📦 Installing frontend dependencies..."
cd map-frontend
npm install
cd ..

echo -e "${GREEN}✅ All dependencies installed${NC}"
echo ""

echo -e "${BLUE}Step 4: Generating restaurant data...${NC}"
cd scripts
node generate-indian-data.js
cd ..
echo -e "${GREEN}✅ Data generated and loaded${NC}"
echo ""

echo "========================================"
echo -e "${GREEN}🎉 Setup complete!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo ""
echo "1. Start the tile server:"
echo "   cd tile-server && npm start"
echo ""
echo "2. In another terminal, start the frontend:"
echo "   cd map-frontend && npm run dev"
echo ""
echo "3. Open http://localhost:5173 in your browser"
echo ""
echo "========================================"
