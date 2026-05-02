// Largest-Triangle-Three-Buckets downsampling algorithm.
// Returns at most `threshold` representative points from the input series.

export interface Point {
  x: number; // typically unix ms
  y: number;
}

export function lttb(data: Point[], threshold: number): Point[] {
  if (threshold >= data.length || threshold === 0) return data;

  const sampled: Point[] = [];
  const bucketSize = (data.length - 2) / (threshold - 2);

  sampled.push(data[0]);

  let a = 0;

  for (let i = 0; i < threshold - 2; i++) {
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length);

    let avgX = 0;
    let avgY = 0;
    const avgRangeLength = avgRangeEnd - avgRangeStart;
    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += data[j].x;
      avgY += data[j].y;
    }
    avgX /= avgRangeLength;
    avgY /= avgRangeLength;

    const rangeOffs = Math.floor(i * bucketSize) + 1;
    const rangeTo = Math.floor((i + 1) * bucketSize) + 1;

    let maxArea = -1;
    let maxAreaPoint = data[rangeOffs];

    for (let j = rangeOffs; j < rangeTo; j++) {
      const area = Math.abs(
        (data[a].x - avgX) * (data[j].y - data[a].y) -
        (data[a].x - data[j].x) * (avgY - data[a].y)
      ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        maxAreaPoint = data[j];
        a = j;
      }
    }

    sampled.push(maxAreaPoint);
  }

  sampled.push(data[data.length - 1]);
  return sampled;
}

// Convenience: downsample an array of [ts, value] pairs
export function lttbPairs(pairs: [number, number][], threshold: number): [number, number][] {
  const points: Point[] = pairs.map(([x, y]) => ({ x, y }));
  return lttb(points, threshold).map((p) => [p.x, p.y]);
}
