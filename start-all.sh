#!/bin/bash

echo "🚀 Starting Food Delivery Map"
echo "=============================="
echo ""

# Check if setup has been run
if [ ! -d "tile-server/node_modules" ]; then
    echo "❌ Dependencies not installed. Please run ./setup.sh first"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Start PostGIS if not running
if ! docker ps | grep -q foodmap-postgis; then
    echo "📦 Starting PostGIS..."
    docker-compose up -d
    sleep 5
fi

echo "Starting services..."
echo ""

# Start tile server in background
echo "🗺️  Starting tile server on http://localhost:3000"
cd tile-server
npm start &
TILE_PID=$!
cd ..

# Wait for tile server to be ready
sleep 3

# Start frontend
echo "🎨 Starting frontend on http://localhost:5173"
cd map-frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "=============================="
echo "✅ All services started!"
echo ""
echo "📍 Tile Server: http://localhost:3000"
echo "🌐 Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop all services"
echo "=============================="

# Wait for Ctrl+C
trap "echo ''; echo 'Stopping services...'; kill $TILE_PID $FRONTEND_PID; exit" INT
wait
