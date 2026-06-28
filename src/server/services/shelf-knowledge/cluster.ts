// ponytail: pure grouping utility. Map-based, O(n). Upgrade to a probabilistic
// fuzzy-topic match (e.g. trigram similarity) if Task 6 emits noisy free-form tags.

export interface TopicTag {
  bookId: string;
  topic: string;
}

export interface TopicCluster {
  topic: string;
  bookIds: string[];
}

function normalize(topic: string): string {
  return topic.toLowerCase().trim().replace(/\s+/g, " ");
}

export function clusterByTopic(tags: TopicTag[]): TopicCluster[] {
  const byTopic = new Map<string, string[]>();
  for (const { bookId, topic } of tags) {
    const key = normalize(topic);
    if (!key) continue;
    const list = byTopic.get(key);
    if (list) {
      if (!list.includes(bookId)) list.push(bookId);
    } else {
      byTopic.set(key, [bookId]);
    }
  }
  const out: TopicCluster[] = [];
  for (const [topic, bookIds] of byTopic) {
    if (bookIds.length >= 2) out.push({ topic, bookIds });
  }
  return out;
}
