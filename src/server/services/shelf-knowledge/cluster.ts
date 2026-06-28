// ponytail: pure grouping utility. Clusters books whose topic word-sets overlap
// (Jaccard ≥ 0.5) via connected components. n is small (≤~30 books), so the
// O(n²) pairwise scan is fine here. Upgrade to a heavier fuzzy match only if
// the shelf grows past hundreds of books or Jaccard 0.5 stops separating themes.

export interface TopicTag {
  bookId: string;
  topic: string;
}

export interface TopicCluster {
  topic: string;
  bookIds: string[];
}

// ponytail: small stopword set. "guide"/"strategy" are dropped because LLMs
// append them vacuously to many unrelated topics ("X Guide", "Y Strategy");
// the rest are common filler. Kept small — over-pruning would collapse
// distinct topics that happen to share a preposition.
const STOPWORDS = new Set([
  "a", "the", "of", "and", "or", "to", "in", "on", "for", "with", "guide", "strategy",
]);

const SIMILARITY_THRESHOLD = 0.5;

function topicWords(topic: string): Set<string> {
  const words = topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
  return new Set(words);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function clusterByTopic(tags: TopicTag[]): TopicCluster[] {
  // One node per (bookId, topic) tag with a non-empty word-set.
  const nodes = tags
    .map((t) => ({ bookId: t.bookId, topic: t.topic, words: topicWords(t.topic) }))
    .filter((n) => n.words.size > 0);

  const n = nodes.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]; // path compression
      i = parent[i];
    }
    return i;
  }
  function union(i: number, j: number) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }

  // ponytail: O(n²) pairwise similarity. n ≤ ~30 books → ≤ 435 comparisons,
  // trivial. Connect edges at Jaccard ≥ 0.5; connected components = clusters.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (jaccard(nodes[i].words, nodes[j].words) >= SIMILARITY_THRESHOLD) {
        union(i, j);
      }
    }
  }

  // Group node indices by root in first-seen order → deterministic output.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = groups.get(r);
    if (list) list.push(i);
    else groups.set(r, [i]);
  }

  const out: TopicCluster[] = [];
  for (const indices of groups.values()) {
    // Cluster's reported topic = the topic string of the first book in the
    // component (a representative label). Dedupe bookIds within the cluster.
    const topic = nodes[indices[0]].topic;
    const bookIds: string[] = [];
    for (const idx of indices) {
      const id = nodes[idx].bookId;
      if (!bookIds.includes(id)) bookIds.push(id);
    }
    if (bookIds.length >= 2) {
      out.push({ topic, bookIds });
    }
  }
  return out;
}
