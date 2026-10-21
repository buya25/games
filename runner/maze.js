'use strict';

// Maze generation and geometry for Maze Run. Grid cells are indexed (x, y) with
// x growing east and y growing north. Directions: 0 = N, 1 = E, 2 = S, 3 = W.
window.NeonMaze = (() => {
  const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

  // Recursive backtracker (long winding corridors), then a few extra openings so
  // there is more than one way through and fewer endless dead ends.
  function generate(w, h, loops = 0.08) {
    const cells = [];
    for (let y = 0; y < h; y++) {
      cells.push([]);
      for (let x = 0; x < w; x++) cells[y].push({ walls: [true, true, true, true] });
    }
    const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
    const carve = (x, y, d) => {
      const [dx, dy] = DIRS[d];
      cells[y][x].walls[d] = false;
      cells[y + dy][x + dx].walls[(d + 2) % 4] = false;
    };

    const seen = new Set(['0,0']);
    const stack = [[0, 0]];
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const options = [0, 1, 2, 3].filter((d) => {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        return inside(nx, ny) && !seen.has(`${nx},${ny}`);
      });
      if (!options.length) { stack.pop(); continue; }
      const d = options[(Math.random() * options.length) | 0];
      carve(x, y, d);
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      seen.add(`${nx},${ny}`);
      stack.push([nx, ny]);
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (const d of [0, 1]) {
          const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
          if (inside(nx, ny) && cells[y][x].walls[d] && Math.random() < loops) carve(x, y, d);
        }
      }
    }

    const maze = { w, h, cells, start: { x: 0, y: 0 } };
    // the exit is the cell furthest (by path) from the start
    const dist = distances(maze, 0, 0);
    let best = { x: 0, y: 0, d: 0 };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dist[y][x] > best.d) best = { x, y, d: dist[y][x] };
    maze.exit = { x: best.x, y: best.y };
    maze.pathLength = best.d;
    return maze;
  }

  const isOpen = (m, x, y, d) => x >= 0 && y >= 0 && x < m.w && y < m.h && !m.cells[y][x].walls[d];

  // Breadth-first path lengths (in cells) from (sx, sy) to every cell.
  function distances(m, sx, sy) {
    const dist = m.cells.map((row) => row.map(() => -1));
    dist[sy][sx] = 0;
    const queue = [[sx, sy]];
    while (queue.length) {
      const [x, y] = queue.shift();
      for (let d = 0; d < 4; d++) {
        if (!isOpen(m, x, y, d)) continue;
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        if (dist[ny][nx] < 0) { dist[ny][nx] = dist[y][x] + 1; queue.push([nx, ny]); }
      }
    }
    return dist;
  }

  // Every wall once, as a segment in cell units (corners at half-integers).
  function wallSegments(m) {
    const segs = [];
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const wl = m.cells[y][x].walls;
        if (wl[0]) segs.push({ x0: x - 0.5, y0: y + 0.5, x1: x + 0.5, y1: y + 0.5, cx: x, cy: y });
        if (wl[1]) segs.push({ x0: x + 0.5, y0: y - 0.5, x1: x + 0.5, y1: y + 0.5, cx: x, cy: y });
        if (y === 0 && wl[2]) segs.push({ x0: x - 0.5, y0: y - 0.5, x1: x + 0.5, y1: y - 0.5, cx: x, cy: y });
        if (x === 0 && wl[3]) segs.push({ x0: x - 0.5, y0: y - 0.5, x1: x - 0.5, y1: y + 0.5, cx: x, cy: y });
      }
    }
    return segs;
  }

  // Clip a polygon of {x, z} points to z >= zNear (the camera's near plane).
  function clipNear(pts, zNear) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ain = a.z >= zNear, bin = b.z >= zNear;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (zNear - a.z) / (b.z - a.z);
        out.push({ x: a.x + (b.x - a.x) * t, z: zNear, y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * t });
      }
    }
    return out;
  }

  return { DIRS, generate, isOpen, distances, wallSegments, clipNear };
})();
