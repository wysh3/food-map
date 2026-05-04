# Web Mercator Projection Verification

## Current Formula
```javascript
const xtile = (lon + 180) / 360 * n;
const latRad = lat * Math.PI / 180;
const ytile = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
```

## Standard Web Mercator (EPSG:3857) Formula
For tile coordinates at zoom level z:
- x = (lon + 180) / 360 * 2^z
- y = (1 - ln(tan(lat_rad) + sec(lat_rad)) / π) / 2 * 2^z

Where:
- lat_rad = lat * π / 180
- sec(lat_rad) = 1 / cos(lat_rad)
- tan(lat_rad) + sec(lat_rad) = tan(lat_rad) + 1/cos(lat_rad)

## Test Cases
Mumbai: 19.0760°N, 72.8777°E at zoom 6
- Expected tile: Should be in tile 46/28 or nearby
- x_tile = (72.8777 + 180) / 360 * 64 = 45.04
- y_tile calculation...

The formula looks correct!

## Potential Issues
1. Database returning strings instead of numbers ✓ FIXED
2. Coordinate system mismatch (WGS84 vs Web Mercator) - restaurants stored in WGS84, tiles use Web Mercator ✓ CORRECT
3. Tile bounds calculation incorrect?
4. MVT encoding issue?
