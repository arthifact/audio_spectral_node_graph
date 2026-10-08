// The original node lifetime uses frames at a reference rate of 60 Hz.
export function isHighlighted(node, currentBurst) {
  return node.burstId === currentBurst && node.age < 45;
}

// Render distant history first and recent white nodes last.
export function nodeRenderOrder(nodes, projections, currentBurst) {
  return nodes
    .map((_, i) => i)
    .sort(
      (a, b) =>
        Number(isHighlighted(nodes[a], currentBurst)) -
          Number(isHighlighted(nodes[b], currentBurst)) ||
        projections[b].depth - projections[a].depth,
    );
}
