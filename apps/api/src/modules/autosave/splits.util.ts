export interface GoalSplit {
  goalId: string;
  percent: number;
}

export function normalizeSplits(splits: GoalSplit[]): GoalSplit[] {
  const filtered = splits.filter((s) => s.percent > 0);
  if (!filtered.length) return [];
  const total = filtered.reduce((a, s) => a + s.percent, 0);
  if (total === 100) return filtered;
  const scaled = filtered.map((s) => ({ goalId: s.goalId, percent: Math.floor((s.percent / total) * 100) }));
  const drift = 100 - scaled.reduce((a, s) => a + s.percent, 0);
  if (drift !== 0) {
    scaled.sort((a, b) => b.percent - a.percent);
    scaled[0].percent += drift;
  }
  return scaled;
}

export function allocateCents(amountCents: bigint, splits: GoalSplit[]): { goalId: string; cents: bigint }[] {
  if (!splits.length) return [];
  const allocations = splits.map((s) => ({
    goalId: s.goalId,
    cents: (amountCents * BigInt(s.percent)) / 100n,
  }));
  const sum = allocations.reduce((a, x) => a + x.cents, 0n);
  const leftover = amountCents - sum;
  if (leftover !== 0n && allocations.length) {
    let largestIdx = 0;
    for (let i = 1; i < splits.length; i++) {
      if (splits[i].percent > splits[largestIdx].percent) largestIdx = i;
    }
    allocations[largestIdx].cents += leftover;
  }
  return allocations;
}
