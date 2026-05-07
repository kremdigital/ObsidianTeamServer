/**
 * Vector clock represented as a plain `Record<clientId, counter>`.
 * Stored in `OperationLog.vectorClock` as JSON.
 *
 * Ordering is partial:
 *  - `compare(a, b)` returns 'before' if every counter in `a` is ≤ the matching one in `b`
 *    AND at least one is strictly less,
 *  - 'after' for the reverse,
 *  - 'equal' if all counters match,
 *  - 'concurrent' otherwise.
 */
export type VectorClock = Record<string, number>;

export type Ordering = 'before' | 'after' | 'equal' | 'concurrent';

export function emptyClock(): VectorClock {
  return {};
}

export function getCount(clock: VectorClock, clientId: string): number {
  return clock[clientId] ?? 0;
}

export function increment(clock: VectorClock, clientId: string): VectorClock {
  return { ...clock, [clientId]: getCount(clock, clientId) + 1 };
}

export function merge(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const [client, counter] of Object.entries(b)) {
    if ((result[client] ?? 0) < counter) {
      result[client] = counter;
    }
  }
  return result;
}

export function compare(a: VectorClock, b: VectorClock): Ordering {
  const clients = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  let aLessSomewhere = false;
  let bLessSomewhere = false;

  for (const client of clients) {
    const av = getCount(a, client);
    const bv = getCount(b, client);
    if (av < bv) aLessSomewhere = true;
    else if (av > bv) bLessSomewhere = true;
  }

  if (!aLessSomewhere && !bLessSomewhere) return 'equal';
  if (aLessSomewhere && !bLessSomewhere) return 'before';
  if (!aLessSomewhere && bLessSomewhere) return 'after';
  return 'concurrent';
}

/**
 * Whether `a` happens-before `b` (a strictly precedes b).
 */
export function happensBefore(a: VectorClock, b: VectorClock): boolean {
  return compare(a, b) === 'before';
}

export function isConcurrent(a: VectorClock, b: VectorClock): boolean {
  return compare(a, b) === 'concurrent';
}

/**
 * Validate the JSON shape pulled from DB: must be an object with non-negative integer values.
 */
export function parseClock(raw: unknown): VectorClock {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  const result: VectorClock = {};
  for (const [client, value] of entries) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      result[client] = value;
    }
  }
  return result;
}
